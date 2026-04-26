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

const transcriptionModel = useGroq ? "whisper-large-v3-turbo" : "gpt-4o-transcribe";

const llmClient = groqApiKey
  ? new OpenAI({
      baseURL: "https://api.groq.com/openai/v1",
      apiKey: groqApiKey,
    })
  : null;

const PUNCT_CHARS = /[.,!?।॥،؟۔、。！？，：；]/g;

function stripPunct(s: string): string {
  return s.replace(PUNCT_CHARS, "").trim().toLowerCase();
}

function fuzzyRemap(originalWords: string[], punctuatedTokens: string[]): string[] {
  const result: string[] = new Array(originalWords.length);
  let pi = 0;

  for (let oi = 0; oi < originalWords.length; oi++) {
    const origClean = stripPunct(originalWords[oi]);

    // Absorb leading standalone punctuation tokens into the previous result word
    while (pi < punctuatedTokens.length && stripPunct(punctuatedTokens[pi]) === "") {
      if (oi > 0 && result[oi - 1] !== undefined) {
        result[oi - 1] = result[oi - 1] + punctuatedTokens[pi].trim();
      }
      pi++;
    }

    if (pi >= punctuatedTokens.length) {
      result[oi] = originalWords[oi];
      continue;
    }

    const punctClean = stripPunct(punctuatedTokens[pi]);

    if (origClean === punctClean || (origClean.length > 1 && punctClean.includes(origClean)) || (punctClean.length > 1 && origClean.includes(punctClean))) {
      result[oi] = punctuatedTokens[pi];
      pi++;
    } else {
      // No clean match — skip one punctuated token and try next
      const nextPi = pi + 1;
      if (nextPi < punctuatedTokens.length && stripPunct(punctuatedTokens[nextPi]) === origClean) {
        if (result.length > 0 && result[oi - 1] !== undefined) {
          result[oi - 1] = result[oi - 1] + punctuatedTokens[pi].trim();
        }
        result[oi] = punctuatedTokens[nextPi];
        pi = nextPi + 1;
      } else {
        result[oi] = originalWords[oi];
      }
    }
  }

  // Absorb any trailing standalone punctuation into last word
  while (pi < punctuatedTokens.length) {
    if (stripPunct(punctuatedTokens[pi]) === "" && result.length > 0) {
      result[result.length - 1] = result[result.length - 1] + punctuatedTokens[pi].trim();
    }
    pi++;
  }

  return result;
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
- Output the full text as one continuous paragraph with no line breaks, no numbering, no explanation.`,
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
      uploadName = originalName;
      uploadType = req.file.mimetype || "application/octet-stream";
    }

    const file = new File([new Uint8Array(audioBuffer)], uploadName, {
      type: uploadType,
    });

    const [response, durationSeconds] = await Promise.all([
      transcriptionClient.audio.transcriptions.create({
        file,
        model: transcriptionModel,
        response_format: useGroq ? "verbose_json" : "json",
        ...(useGroq ? { timestamp_granularities: ["segment"] } : {}),
        ...(language ? { language } : {}),
      } as Parameters<typeof transcriptionClient.audio.transcriptions.create>[0]) as Promise<{
        text?: string;
        segments?: Array<{ start: number; end: number; text: string }>;
      }>,
      probeAudioDuration(audioBuffer).catch(() => 0),
    ]);

    let punctuatedResponse = response;
    if (response.segments && response.segments.length > 0) {
      const segWords = response.segments.map((seg) => seg.text.trim().split(/\s+/).filter(Boolean));
      const allOriginalWords = segWords.flat();
      const fullText = allOriginalWords.join(" ");
      const punctuated = await addPunctuation(fullText);
      const punctuatedTokens = punctuated.split(/\s+/).filter(Boolean);
      const remapped = fuzzyRemap(allOriginalWords, punctuatedTokens);

      let wordIdx = 0;
      const newSegments = response.segments.map((seg, i) => {
        const count = segWords[i].length;
        const taken = remapped.slice(wordIdx, wordIdx + count).join(" ");
        wordIdx += count;
        return { ...seg, text: taken || seg.text };
      });
      punctuatedResponse = { ...response, segments: newSegments };
    } else if (response.text) {
      const punctuated = await addPunctuation(response.text);
      punctuatedResponse = { ...response, text: punctuated };
    }

    const srt = buildSrt(punctuatedResponse, durationSeconds);

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

function chunkSentences(text: string, maxCharsPerCue = 90): string[] {
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

function buildSrt(
  response: {
    text?: string;
    segments?: Array<{ start: number; end: number; text: string }>;
  },
  durationSeconds: number,
): string {
  const lines: string[] = [];

  if (response.segments && response.segments.length > 0) {
    response.segments.forEach((seg, idx) => {
      lines.push(String(idx + 1));
      lines.push(`${formatTimestamp(seg.start)} --> ${formatTimestamp(seg.end)}`);
      lines.push(seg.text.trim());
      lines.push("");
    });
    return lines.join("\n");
  }

  const text = (response.text ?? "").trim();
  if (!text) {
    return "1\n00:00:00,000 --> 00:00:01,000\n[no speech detected]\n";
  }

  const cues = chunkSentences(text);
  const totalChars = cues.reduce((sum, cue) => sum + cue.length, 0) || 1;
  const total =
    durationSeconds && Number.isFinite(durationSeconds) && durationSeconds > 0
      ? durationSeconds
      : Math.max(2, cues.length * 2.5);

  let cursor = 0;
  cues.forEach((cue, idx) => {
    const share = (cue.length / totalChars) * total;
    const start = cursor;
    const end = Math.min(total, cursor + share);
    cursor = end;
    lines.push(String(idx + 1));
    lines.push(`${formatTimestamp(start)} --> ${formatTimestamp(end)}`);
    lines.push(cue);
    lines.push("");
  });

  return lines.join("\n");
}

export default router;
