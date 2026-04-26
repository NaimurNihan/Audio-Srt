import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  Upload,
  FileAudio,
  Download,
  Loader2,
  Sparkles,
  X,
  CheckCircle2,
  Languages,
  AudioLines,
} from "lucide-react";

const LANGUAGES = [
  { value: "auto", label: "Auto detect" },
  { value: "en", label: "English" },
  { value: "bn", label: "Bengali (বাংলা)" },
  { value: "hi", label: "Hindi" },
  { value: "ar", label: "Arabic" },
  { value: "es", label: "Spanish" },
  { value: "fr", label: "French" },
  { value: "de", label: "German" },
  { value: "it", label: "Italian" },
  { value: "ja", label: "Japanese" },
  { value: "ko", label: "Korean" },
  { value: "pt", label: "Portuguese" },
  { value: "ru", label: "Russian" },
  { value: "tr", label: "Turkish" },
  { value: "ur", label: "Urdu" },
  { value: "zh", label: "Chinese" },
];

const MAX_BYTES = 30 * 1024 * 1024;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const API_BASE = `${import.meta.env.BASE_URL}api`.replace(/\/+/g, "/");

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [language, setLanguage] = useState<string>("auto");
  const [isDragging, setIsDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [srt, setSrt] = useState<string>("");
  const inputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  function pickFile(f: File | null | undefined) {
    if (!f) return;
    if (!f.type.startsWith("audio/") && !f.type.startsWith("video/") && !/\.(mp3|wav|m4a|ogg|webm|flac|aac|mp4|mpeg|mpga|opus)$/i.test(f.name)) {
      toast({
        title: "Unsupported file",
        description: "Please choose an audio file (mp3, wav, m4a, ogg, webm, flac, mp4).",
        variant: "destructive",
      });
      return;
    }
    if (f.size > MAX_BYTES) {
      toast({
        title: "File too large",
        description: `Max size is 30 MB. Your file is ${formatBytes(f.size)}.`,
        variant: "destructive",
      });
      return;
    }
    setFile(f);
    setSrt("");
  }

  async function handleGenerate() {
    if (!file) return;
    setLoading(true);
    setSrt("");
    try {
      const form = new FormData();
      form.append("audio", file);
      if (language && language !== "auto") {
        form.append("language", language);
      }

      const res = await fetch(`${API_BASE}/transcribe`, {
        method: "POST",
        body: form,
      });

      if (!res.ok) {
        let msg = `Request failed (${res.status})`;
        try {
          const data = await res.json();
          if (data?.error) msg = data.error;
        } catch {
          // ignore
        }
        throw new Error(msg);
      }

      const text = await res.text();
      setSrt(text);
      toast({
        title: "SRT ready",
        description: "Your subtitle file was generated successfully.",
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Something went wrong";
      toast({
        title: "Transcription failed",
        description: message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  function handleDownload() {
    if (!srt) return;
    const baseName = (file?.name ?? "transcript").replace(/\.[^/.]+$/, "");
    const blob = new Blob([srt], { type: "application/x-subrip;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${baseName}.srt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function handleCopy() {
    if (!srt) return;
    navigator.clipboard.writeText(srt).then(
      () => toast({ title: "Copied", description: "SRT copied to clipboard." }),
      () => toast({ title: "Copy failed", variant: "destructive" }),
    );
  }

  function clearFile() {
    setFile(null);
    setSrt("");
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-gradient-to-br from-background via-background to-muted">
      {/* Decorative gradient orbs */}
      <div className="pointer-events-none absolute -top-40 -left-32 h-96 w-96 rounded-full bg-primary/20 blur-3xl" />
      <div className="pointer-events-none absolute top-1/3 -right-32 h-96 w-96 rounded-full bg-accent/20 blur-3xl" />
      <div className="pointer-events-none absolute bottom-0 left-1/3 h-80 w-80 rounded-full bg-primary/10 blur-3xl" />

      <div className="relative mx-auto max-w-5xl px-4 sm:px-6 py-8 sm:py-10">
        {/* TOP HEADER CARD */}
        <Card className="mb-8 p-3 sm:p-4 border-card-border shadow-lg backdrop-blur-xl bg-card/80">
          <div className="flex flex-col lg:flex-row items-stretch lg:items-center gap-3 lg:gap-4">
            {/* Brand */}
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex-shrink-0 h-10 w-10 rounded-xl bg-gradient-to-br from-primary to-accent flex items-center justify-center shadow-md shadow-primary/30">
                <AudioLines className="h-5 w-5 text-primary-foreground" />
              </div>
              <div className="min-w-0">
                <h1 className="text-base sm:text-lg font-bold tracking-tight leading-tight">
                  AUDIO <span className="text-primary">TO</span> SRT
                </h1>
                <div className="hidden sm:flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <Sparkles className="h-3 w-3 text-primary" />
                  Powered by Whisper AI
                </div>
              </div>
            </div>

            {/* Spacer / center badge for desktop */}
            <div className="hidden lg:flex flex-1 justify-center">
              <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-4 py-1.5 text-sm text-primary">
                <Sparkles className="h-3.5 w-3.5" />
                <span className="font-medium">Powered by Whisper AI</span>
              </div>
            </div>

            {/* Controls: language + generate */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3 lg:flex-shrink-0">
              <div className="relative">
                <Languages className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground z-10" />
                <Select value={language} onValueChange={setLanguage}>
                  <SelectTrigger
                    aria-label="Language"
                    className="pl-9 min-w-[170px] bg-background/60 backdrop-blur"
                  >
                    <SelectValue placeholder="Auto detect" />
                  </SelectTrigger>
                  <SelectContent>
                    {LANGUAGES.map((l) => (
                      <SelectItem key={l.value} value={l.value}>
                        {l.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <Button
                onClick={handleGenerate}
                disabled={!file || loading}
                size="default"
                className="min-w-[160px] bg-gradient-to-r from-primary to-accent hover:opacity-95 shadow-md shadow-primary/30"
              >
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4 mr-2" />
                    Generate SRT
                  </>
                )}
              </Button>
            </div>
          </div>
        </Card>

        {/* HERO + UPLOAD CARD */}
        <Card className="overflow-hidden border-card-border shadow-xl bg-card/90 backdrop-blur-xl">
          {/* Hero strip inside the card */}
          <div className="relative px-6 sm:px-10 pt-10 pb-6 text-center bg-gradient-to-b from-primary/5 to-transparent">
            <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-medium text-primary mb-4">
              <Sparkles className="h-3 w-3" />
              <span>Fast · Accurate · Multilingual</span>
            </div>
            <h2 className="text-3xl sm:text-5xl font-bold tracking-tight bg-gradient-to-br from-foreground via-foreground to-foreground/60 bg-clip-text text-transparent">
              Audio to SRT
            </h2>
            <p className="mt-3 text-muted-foreground sm:text-lg max-w-xl mx-auto">
              Upload an audio file and get a perfectly timed subtitle file in seconds.
            </p>
          </div>

          {/* Upload area */}
          <div className="px-5 sm:px-10 pb-8 sm:pb-10">
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsDragging(false);
                pickFile(e.dataTransfer.files?.[0]);
              }}
              onClick={() => inputRef.current?.click()}
              className={`relative cursor-pointer rounded-2xl border-2 border-dashed p-8 sm:p-12 text-center transition-all ${
                isDragging
                  ? "border-primary bg-primary/10 scale-[1.01]"
                  : "border-border hover:border-primary/50 hover:bg-primary/5"
              }`}
            >
              <input
                ref={inputRef}
                type="file"
                accept="audio/*,video/mp4,.mp3,.wav,.m4a,.ogg,.webm,.flac,.aac,.mp4,.mpeg,.mpga,.opus"
                className="hidden"
                onChange={(e) => pickFile(e.target.files?.[0])}
              />
              {file ? (
                <div className="flex items-center justify-between gap-4 text-left">
                  <div className="flex items-center gap-4 min-w-0">
                    <div className="flex-shrink-0 h-14 w-14 rounded-2xl bg-gradient-to-br from-primary to-accent text-primary-foreground flex items-center justify-center shadow-md shadow-primary/30">
                      <FileAudio className="h-7 w-7" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold truncate text-base">{file.name}</p>
                      <p className="text-sm text-muted-foreground">
                        {formatBytes(file.size)} · Ready to transcribe
                      </p>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={(e) => {
                      e.stopPropagation();
                      clearFile();
                    }}
                    aria-label="Remove file"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <div>
                  <div className="relative mx-auto h-20 w-20 mb-5">
                    <div className="absolute inset-0 rounded-full bg-primary/20 blur-xl" />
                    <div className="relative h-20 w-20 rounded-full bg-gradient-to-br from-primary to-accent text-primary-foreground flex items-center justify-center shadow-lg shadow-primary/30">
                      <Upload className="h-9 w-9" />
                    </div>
                  </div>
                  <p className="text-lg font-semibold">Click to upload or drag and drop</p>
                  <p className="text-sm text-muted-foreground mt-1.5">
                    MP3, WAV, M4A, OGG, WEBM, FLAC, MP4 — up to 30 MB
                  </p>
                  <p className="text-xs text-muted-foreground mt-4">
                    Pick a language above for best accuracy, or let it auto-detect.
                  </p>
                </div>
              )}
            </div>
          </div>
        </Card>

        {srt && (
          <Card className="mt-6 p-6 sm:p-8 shadow-xl border-card-border bg-card/90 backdrop-blur-xl">
            <div className="flex items-center justify-between mb-4 gap-4 flex-wrap">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-green-500" />
                <h2 className="text-lg font-semibold">SRT preview</h2>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={handleCopy}>
                  Copy
                </Button>
                <Button
                  onClick={handleDownload}
                  className="bg-gradient-to-r from-primary to-accent hover:opacity-95 shadow-md shadow-primary/30"
                >
                  <Download className="h-4 w-4 mr-2" />
                  Download .srt
                </Button>
              </div>
            </div>
            <pre className="bg-muted text-foreground/90 p-4 rounded-lg overflow-auto max-h-[480px] text-sm font-mono whitespace-pre-wrap">
              {srt}
            </pre>
          </Card>
        )}

        <footer className="mt-10 text-center text-sm text-muted-foreground">
          Subtitles are generated using OpenAI Whisper for accurate timing.
        </footer>
      </div>
    </div>
  );
}
