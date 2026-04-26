import { Router, type IRouter } from "express";
import multer from "multer";
import OpenAI from "openai";
import { spawn } from "node:child_process";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 30 * 1024 * 1024,
  },
});

const groqApiKey = process.env["GROQ_API_KEY"];
const fallbackBaseURL = process.env["AI_INTEGRATIONS_OPENAI_BASE_URL"];
const fallbackApiKey = process.env["AI_INTEGRATIONS_OPENAI_API_KEY"];

if (!groqApiKey && (!fallbackBaseURL || !fallbackApiKey)) {
  throw new Error(
    "GROQ_API_KEY (preferred) or AI_INTEGRATIONS_OPENAI_BASE_URL + AI_INTEGRATIONS_OPENAI_API_KEY must be set",
  );
}

const useGroq = Boolean(groqApiKey);

const transcriptionClient = useGroq
  ? new OpenAI({
      baseURL: "https://api.groq.com/openai/v1",
      apiKey: groqApiKey!,
    })
  : new OpenAI({ baseURL: fallbackBaseURL!, apiKey: fallbackApiKey! });

// NOTE: whisper-large-v3-turbo does NOT support word-level timestamps on Groq.
// We use whisper-large-v3 specifically because it returns per-word timing, which
// is required to build accurate sentence-aligned subtitle cues.
const transcriptionModel = useGroq ? "whisper-large-v3" : "gpt-4o-transcribe";

const llmClient = groqApiKey
  ? new OpenAI({
      baseURL: "https://api.groq.com/openai/v1",
      apiKey: groqApiKey,
    })
  : null;

const PUNCT_CHARS = /[.,!?।॥،؟۔、。！？，：；]/g;
const SENTENCE_END = /[.!?।॥؟。！？]/;
const MAX_CHARS_PER_CUE = 90;
const PUNCT_CHUNK_WORDS = 350;

type WhisperWord = { word: string; start: number; end: number };
type WhisperSegment = { start: number; end: number; text: string };
type WhisperResponse = {
  text?: string;
  segments?: WhisperSegment[];
  words?: WhisperWord[];
};

function stripPunct(s: string): string {
  return s.replace(PUNCT_CHARS, "").trim().toLowerCase();
}

async function addPunctuation(text: string): Promise<string> {
  if (!llmClient || !text.trim()) return text;
  try {
    const completion = await llmClient.chat.completions.create({
      model: "meta-llama/llama-4-scout-17b-16e-instruct",
      messages: [
        {
          role: "system",
          content: `You are a punctuation restoration expert. Your only job is to insert punctuation into the given transcript text.

RULES:
- Only INSERT punctuation marks — do NOT remove, replace, translate, or reorder any word.
- For Hindi/Devanagari text: use । (danda) to end a complete sentence. Use , for internal pauses.
- For English text: use . to end a complete sentence. Use , for internal pauses.
- For questions: always end with ?
- For exclamations: always end with !
- A comma must NEVER appear at the end of a complete sentence — only . or । or ? or ! ends a sentence.
- Names, brand names, English words already in Latin script must stay exactly as they are.
- Output the full text as one continuous paragraph with no line breaks, no numbering, no explanation.
- You MUST return every single word from the input. Never truncate, summarize, or omit any portion of the text.`,
        },
        {
          role: "user",
          content: text,
        },
      ],
      temperature: 0.1,
      max_tokens: 8192,
    });
    return completion.choices[0]?.message?.content?.trim() ?? text;
  } catch (err) {
    logger.warn({ err }, "Punctuation LLM call failed; using original text");
    return text;
  }
}

async function punctuateInChunks(words: string[]): Promise<string[]> {
  if (words.length === 0) return [];
  const chunks: string[][] = [];
  for (let i = 0; i < words.length; i += PUNCT_CHUNK_WORDS) {
    chunks.push(words.slice(i, i + PUNCT_CHUNK_WORDS));
  }
  const results = await Promise.all(
    chunks.map((chunk) => addPunctuation(chunk.join(" "))),
  );
  return results.flatMap((r) => r.split(/\s+/).filter(Boolean));
}

function alignPunctuatedToWords(
  originalWords: string[],
  punctuatedTokens: string[],
): string[] {
  const aligned: string[] = new Array(originalWords.length);
  let pi = 0;

  for (let oi = 0; oi < originalWords.length; oi++) {
    const origClean = stripPunct(originalWords[oi]);

    while (pi < punctuatedTokens.length && stripPunct(punctuatedTokens[pi]) === "") {
      if (oi > 0 && aligned[oi - 1] !== undefined) {
        aligned[oi - 1] = aligned[oi - 1] + punctuatedTokens[pi].trim();
      }
      pi++;
    }

    if (pi >= punctuatedTokens.length) {
      aligned[oi] = originalWords[oi];
      continue;
    }

    const punctClean = stripPunct(punctuatedTokens[pi]);

    const isMatch =
      origClean === punctClean ||
      (origClean.length > 1 && punctClean.includes(origClean)) ||
      (punctClean.length > 1 && origClean.includes(punctClean));

    if (isMatch) {
      aligned[oi] = punctuatedTokens[pi];
      pi++;
    } else {
      // Look ahead a few tokens; LLM may have inserted/altered a word
      let found = -1;
      for (let look = pi + 1; look < Math.min(pi + 4, punctuatedTokens.length); look++) {
        if (stripPunct(punctuatedTokens[look]) === origClean) {
          found = look;
          break;
        }
      }
      if (found !== -1) {
        if (oi > 0 && aligned[oi - 1] !== undefined) {
          for (let k = pi; k < found; k++) {
            aligned[oi - 1] = aligned[oi - 1] + punctuatedTokens[k].trim();
          }
        }
        aligned[oi] = punctuatedTokens[found];
        pi = found + 1;
      } else {
        aligned[oi] = originalWords[oi];
      }
    }
  }

  while (pi < punctuatedTokens.length) {
    if (stripPunct(punctuatedTokens[pi]) === "" && aligned.length > 0) {
      aligned[aligned.length - 1] = aligned[aligned.length - 1] + punctuatedTokens[pi].trim();
    }
    pi++;
  }

  return aligned;
}

type Cue = { start: number; end: number; text: string };
type SilenceRegion = { start: number; end: number };

const SILENCE_NOISE_DB = -30;
const SILENCE_MIN_DURATION = 0.15;
const SNAP_TOLERANCE_SECONDS = 0.35;
const MIN_CUE_DURATION = 0.4;

function detectSilences(buffer: Buffer): Promise<SilenceRegion[]> {
  return new Promise((resolve) => {
    const proc = spawn("ffmpeg", [
      "-hide_banner",
      "-nostats",
      "-i",
      "pipe:0",
      "-af",
      `silencedetect=noise=${SILENCE_NOISE_DB}dB:d=${SILENCE_MIN_DURATION}`,
      "-f",
      "null",
      "-",
    ]);
    let stderr = "";
    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    proc.on("error", () => resolve([]));
    proc.on("close", () => {
      try {
        const starts: number[] = [];
        const ends: number[] = [];
        const startRegex = /silence_start:\s*([\d.]+)/g;
        const endRegex = /silence_end:\s*([\d.]+)/g;
        let m: RegExpExecArray | null;
        while ((m = startRegex.exec(stderr)) !== null) starts.push(parseFloat(m[1]));
        while ((m = endRegex.exec(stderr)) !== null) ends.push(parseFloat(m[1]));
        const regions: SilenceRegion[] = [];
        const len = Math.min(starts.length, ends.length);
        for (let i = 0; i < len; i++) {
          if (Number.isFinite(starts[i]) && Number.isFinite(ends[i]) && ends[i] > starts[i]) {
            regions.push({ start: starts[i], end: ends[i] });
          }
        }
        regions.sort((a, b) => a.start - b.start);
        resolve(regions);
      } catch {
        resolve([]);
      }
    });
    proc.stdin.on("error", () => {});
    proc.stdin.end(buffer);
  });
}

function snapCuesToSilence(cues: Cue[], silences: SilenceRegion[]): Cue[] {
  if (cues.length === 0 || silences.length === 0) return cues;

  const silenceStarts = silences.map((s) => s.start);
  const silenceEnds = silences.map((s) => s.end);

  const nearest = (target: number, sorted: number[]): number | null => {
    if (sorted.length === 0) return null;
    let lo = 0;
    let hi = sorted.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sorted[mid] < target) lo = mid + 1;
      else hi = mid;
    }
    const candidates: number[] = [];
    if (lo < sorted.length) candidates.push(sorted[lo]);
    if (lo > 0) candidates.push(sorted[lo - 1]);
    let best: number | null = null;
    let bestDist = SNAP_TOLERANCE_SECONDS;
    for (const c of candidates) {
      const d = Math.abs(c - target);
      if (d <= bestDist) {
        bestDist = d;
        best = c;
      }
    }
    return best;
  };

  const out: Cue[] = cues.map((c) => ({ ...c }));

  for (let i = 0; i < out.length; i++) {
    const cur = out[i];

    // Snap end of cue to nearest silence_start (silence begins right after speech)
    const snapEnd = nearest(cur.end, silenceStarts);
    if (snapEnd !== null && snapEnd > cur.start + MIN_CUE_DURATION * 0.5) {
      cur.end = snapEnd;
    }

    // Snap start (except first cue) to nearest silence_end (speech resumes after silence)
    if (i > 0) {
      const prev = out[i - 1];
      const snapStart = nearest(cur.start, silenceEnds);
      if (
        snapStart !== null &&
        snapStart >= prev.end &&
        snapStart < cur.end - MIN_CUE_DURATION * 0.5
      ) {
        cur.start = snapStart;
      }
    }
  }

  // Repair: enforce ordering, no overlap, minimum duration
  for (let i = 0; i < out.length; i++) {
    if (i > 0 && out[i].start < out[i - 1].end) {
      out[i].start = out[i - 1].end;
    }
    if (out[i].end < out[i].start + MIN_CUE_DURATION) {
      out[i].end = out[i].start + MIN_CUE_DURATION;
    }
    // If next cue would now be pushed forward, allow it (next iteration handles it)
  }

  return out;
}

function buildCuesFromWords(
  words: WhisperWord[],
  punctuatedWords: string[],
): Cue[] {
  if (words.length === 0) return [];

  const cues: Cue[] = [];
  let bufStart = words[0].start;
  let bufEnd = words[0].end;
  let bufText = "";
  let bufCharCount = 0;

  const flush = () => {
    const text = bufText.trim();
    if (text) {
      cues.push({ start: bufStart, end: bufEnd, text });
    }
    bufText = "";
    bufCharCount = 0;
  };

  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const display = punctuatedWords[i] ?? w.word.trim();

    if (bufText === "") {
      bufStart = w.start;
    }
    bufEnd = w.end;
    bufText = bufText ? `${bufText} ${display}` : display;
    bufCharCount = bufText.length;

    const endsSentence = SENTENCE_END.test(display.slice(-1));
    const tooLong = bufCharCount >= MAX_CHARS_PER_CUE;
    const isLast = i === words.length - 1;

    if (endsSentence || tooLong || isLast) {
      flush();
    }
  }

  return cues;
}

router.post("/transcribe", upload.single("audio"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No audio file uploaded" });
    }

    const language = typeof req.body?.language === "string" && req.body.language.trim().length > 0
      ? req.body.language.trim()
      : undefined;

    const originalName = req.file.originalname || "audio.mp3";

    let audioBuffer: Buffer;
    let uploadName: string;
    let uploadType: string;
    try {
      audioBuffer = await transcodeToMp3(req.file.buffer);
      uploadName = originalName.replace(/\.[^/.]+$/, "") + ".mp3";
      uploadType = "audio/mpeg";
    } catch (transcodeErr) {
      logger.warn({ err: transcodeErr }, "ffmpeg transcode failed; sending original file");
      audioBuffer = req.file.buffer;
      const extMatch = originalName.match(/\.([^/.]+)$/);
      const lowerExt = extMatch ? extMatch[1].toLowerCase() : "mp3";
      const baseName = originalName.replace(/\.[^/.]+$/, "") || "audio";
      uploadName = `${baseName}.${lowerExt}`;
      uploadType = req.file.mimetype || "application/octet-stream";
    }

    const file = new File([new Uint8Array(audioBuffer)], uploadName, {
      type: uploadType,
    });

    const [response, durationSeconds, silences] = await Promise.all([
      transcriptionClient.audio.transcriptions.create({
        file,
        model: transcriptionModel,
        response_format: useGroq ? "verbose_json" : "json",
        ...(useGroq ? { timestamp_granularities: ["word", "segment"] } : {}),
        ...(language ? { language } : {}),
      } as Parameters<typeof transcriptionClient.audio.transcriptions.create>[0]) as Promise<WhisperResponse>,
      probeAudioDuration(audioBuffer).catch(() => 0),
      detectSilences(audioBuffer).catch(() => [] as SilenceRegion[]),
    ]);

    logger.info({ silenceCount: silences.length, durationSeconds }, "Silence detection complete");

    const srt = await buildSrtFromResponse(response, durationSeconds, silences);

    const safeBase = originalName.replace(/\.[^/.]+$/, "").replace(/[^a-zA-Z0-9_-]/g, "_") || "transcript";
    res.setHeader("Content-Type", "application/x-subrip; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${safeBase}.srt"`);
    return res.status(200).send(srt);
  } catch (err) {
    logger.error({ err }, "Transcription failed");
    const message = err instanceof Error ? err.message : "Transcription failed";
    return res.status(500).json({ error: message });
  }
});

async function buildSrtFromResponse(
  response: WhisperResponse,
  durationSeconds: number,
  silences: SilenceRegion[] = [],
): Promise<string> {
  // Best path: word-level timestamps + chunked punctuation → real sentence cues
  if (response.words && response.words.length > 0) {
    const originalWords = response.words.map((w) => w.word.trim()).filter(Boolean);
    const punctuatedTokens = await punctuateInChunks(originalWords);
    const aligned = alignPunctuatedToWords(originalWords, punctuatedTokens);
    const cues = buildCuesFromWords(response.words, aligned);
    if (cues.length > 0) {
      const snapped = snapCuesToSilence(cues, silences);
      return formatCuesAsSrt(snapped);
    }
  }

  // Fallback: segment-level (older/no-word case)
  if (response.segments && response.segments.length > 0) {
    const segWords = response.segments.map((seg) => seg.text.trim().split(/\s+/).filter(Boolean));
    const allWords = segWords.flat();
    const punctuatedTokens = await punctuateInChunks(allWords);
    const aligned = alignPunctuatedToWords(allWords, punctuatedTokens);

    let wordIdx = 0;
    const cues: Cue[] = response.segments.map((seg, i) => {
      const count = segWords[i].length;
      const text = aligned.slice(wordIdx, wordIdx + count).join(" ").trim() || seg.text.trim();
      wordIdx += count;
      return { start: seg.start, end: seg.end, text };
    });
    const snapped = snapCuesToSilence(cues, silences);
    return formatCuesAsSrt(snapped);
  }

  // Last resort: only plain text — distribute time proportionally
  const text = (response.text ?? "").trim();
  if (!text) {
    return "1\n00:00:00,000 --> 00:00:01,000\n[no speech detected]\n";
  }
  const punctuated = await addPunctuation(text);
  const chunks = chunkSentences(punctuated);
  const totalChars = chunks.reduce((sum, c) => sum + c.length, 0) || 1;
  const total = durationSeconds && durationSeconds > 0 ? durationSeconds : Math.max(2, chunks.length * 2.5);
  let cursor = 0;
  const cues: Cue[] = chunks.map((c) => {
    const share = (c.length / totalChars) * total;
    const start = cursor;
    const end = Math.min(total, cursor + share);
    cursor = end;
    return { start, end, text: c };
  });
  return formatCuesAsSrt(cues);
}

function formatCuesAsSrt(cues: Cue[]): string {
  const lines: string[] = [];
  cues.forEach((cue, idx) => {
    lines.push(String(idx + 1));
    lines.push(`${formatTimestamp(cue.start)} --> ${formatTimestamp(cue.end)}`);
    lines.push(cue.text.trim());
    lines.push("");
  });
  return lines.join("\n");
}

function transcodeToMp3(buffer: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", [
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      "pipe:0",
      "-vn",
      "-ac",
      "1",
      "-ar",
      "16000",
      "-b:a",
      "64k",
      "-f",
      "mp3",
      "pipe:1",
    ]);

    const chunks: Buffer[] = [];
    let stderr = "";

    proc.stdout.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });
    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code !== 0) {
        return reject(new Error(`ffmpeg exited ${code}: ${stderr}`));
      }
      const out = Buffer.concat(chunks);
      if (out.length === 0) {
        return reject(new Error("ffmpeg produced empty output"));
      }
      resolve(out);
    });
    proc.stdin.on("error", () => {
      // ignore EPIPE; ffmpeg may close stdin early
    });
    proc.stdin.end(buffer);
  });
}

function probeAudioDuration(buffer: Buffer): Promise<number> {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      "-i",
      "pipe:0",
    ]);
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code !== 0) {
        return reject(new Error(`ffprobe exited ${code}: ${stderr}`));
      }
      const seconds = parseFloat(stdout.trim());
      resolve(Number.isFinite(seconds) ? seconds : 0);
    });
    proc.stdin.on("error", () => {
      // ignore EPIPE; ffprobe may close stdin early
    });
    proc.stdin.end(buffer);
  });
}

function formatTimestamp(totalSeconds: number): string {
  const clamped = Math.max(0, totalSeconds);
  const hours = Math.floor(clamped / 3600);
  const minutes = Math.floor((clamped % 3600) / 60);
  const seconds = Math.floor(clamped % 60);
  const millis = Math.round((clamped - Math.floor(clamped)) * 1000);
  const pad = (n: number, width = 2) => n.toString().padStart(width, "0");
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)},${pad(millis, 3)}`;
}

function chunkSentences(text: string, maxCharsPerCue = MAX_CHARS_PER_CUE): string[] {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return [];

  const sentenceRegex = /[^.!?\u0964\u0965]+[.!?\u0964\u0965]+|\S+[\s\S]*?$/g;
  const sentences = cleaned.match(sentenceRegex)?.map((s) => s.trim()).filter(Boolean) ?? [cleaned];

  const cues: string[] = [];
  for (const sentence of sentences) {
    if (sentence.length <= maxCharsPerCue) {
      cues.push(sentence);
      continue;
    }
    const words = sentence.split(" ");
    let buffer = "";
    for (const word of words) {
      const candidate = buffer ? `${buffer} ${word}` : word;
      if (candidate.length > maxCharsPerCue && buffer) {
        cues.push(buffer);
        buffer = word;
      } else {
        buffer = candidate;
      }
    }
    if (buffer) cues.push(buffer);
  }
  return cues;
}

export default router;
