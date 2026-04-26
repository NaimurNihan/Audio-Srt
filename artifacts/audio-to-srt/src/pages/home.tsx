import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
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
    <div className="min-h-screen w-full bg-gradient-to-br from-background via-background to-muted">
      <div className="mx-auto max-w-4xl px-6 py-12">
        <header className="mb-10 text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-4 py-1.5 text-sm text-primary mb-4">
            <Sparkles className="h-3.5 w-3.5" />
            <span>Powered by Whisper AI</span>
          </div>
          <h1 className="text-4xl sm:text-5xl font-bold tracking-tight bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text">
            Audio to SRT
          </h1>
          <p className="mt-3 text-muted-foreground text-lg">
            Upload an audio file and get a perfectly timed subtitle file.
          </p>
        </header>

        <Card className="p-6 sm:p-8 shadow-lg border-card-border">
          <div className="space-y-6">
            <div>
              <Label className="text-sm font-medium mb-3 block">
                Audio file
              </Label>
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
                className={`relative cursor-pointer rounded-xl border-2 border-dashed p-8 text-center transition-all ${
                  isDragging
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/50 hover:bg-muted/40"
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
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="flex-shrink-0 h-12 w-12 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
                        <FileAudio className="h-6 w-6" />
                      </div>
                      <div className="min-w-0">
                        <p className="font-medium truncate">{file.name}</p>
                        <p className="text-sm text-muted-foreground">
                          {formatBytes(file.size)}
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
                    <div className="mx-auto h-14 w-14 rounded-full bg-primary/10 text-primary flex items-center justify-center mb-3">
                      <Upload className="h-7 w-7" />
                    </div>
                    <p className="font-medium">Click to upload or drag and drop</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      MP3, WAV, M4A, OGG, WEBM, FLAC, MP4 — up to 30 MB
                    </p>
                  </div>
                )}
              </div>
            </div>

            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <Label className="text-sm font-medium mb-2 block">
                  Language
                </Label>
                <Select value={language} onValueChange={setLanguage}>
                  <SelectTrigger>
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
                <p className="text-xs text-muted-foreground mt-1.5">
                  Choose a language for best accuracy, or let it auto-detect.
                </p>
              </div>

              <div className="flex items-end">
                <Button
                  onClick={handleGenerate}
                  disabled={!file || loading}
                  size="lg"
                  className="w-full"
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
          </div>
        </Card>

        {srt && (
          <Card className="mt-6 p-6 sm:p-8 shadow-lg border-card-border">
            <div className="flex items-center justify-between mb-4 gap-4 flex-wrap">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-green-500" />
                <h2 className="text-lg font-semibold">SRT preview</h2>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={handleCopy}>
                  Copy
                </Button>
                <Button onClick={handleDownload}>
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
