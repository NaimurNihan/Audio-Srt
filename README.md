# Audio to SRT

Upload an audio or video file and get a perfectly timed `.srt` subtitle file — powered by Groq Whisper for transcription and Groq LLaMA for punctuation restoration.

---

## Features

- Upload audio/video files (MP3, WAV, M4A, OGG, WEBM, FLAC, MP4 — up to 30 MB)
- Choose language or let it auto-detect (supports Bengali, Hindi, English, Arabic, and 12 more)
- Accurate timestamps using Whisper `whisper-large-v3`
- Automatic punctuation restoration using LLaMA `llama-3.3-70b-versatile`
- Download `.srt` file or copy to clipboard

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React + Vite + Tailwind CSS + shadcn/ui |
| Backend | Express 5 + TypeScript |
| Transcription | Groq Whisper (`whisper-large-v3`) |
| Punctuation | Groq LLaMA (`llama-3.3-70b-versatile`) |
| Audio processing | ffmpeg (transcode to MP3 before sending) |
| Package manager | pnpm workspaces |

---

## Environment Variables / API Keys Required

### `GROQ_API_KEY` — **Required**

This single key is used for **two things**:

1. **Audio transcription** — Groq Whisper (`whisper-large-v3`) converts your audio to text with accurate timestamps
2. **Punctuation restoration** — Groq LLaMA (`llama-3.3-70b-versatile`) adds proper punctuation (`.`, `।`, `,`, `?`, `!`) to the transcript naturally at sentence boundaries

**How to get a Groq API key:**

1. Go to [https://console.groq.com](https://console.groq.com)
2. Sign up or log in
3. Navigate to **API Keys** → **Create API Key**
4. Copy the key

**How to add it in Replit:**

1. Open the **Secrets** tab in your Replit project (lock icon on the left sidebar)
2. Add a new secret:
   - Key: `GROQ_API_KEY`
   - Value: your Groq API key
3. Restart the API server workflow

> **Note:** If `GROQ_API_KEY` is not set, the app will automatically fall back to Replit's built-in OpenAI integration (`AI_INTEGRATIONS_OPENAI_BASE_URL` + `AI_INTEGRATIONS_OPENAI_API_KEY`). In that case, transcription uses `gpt-4o-transcribe` and **punctuation restoration is disabled** (Groq LLaMA is not available without a Groq key).

---

## Local Setup

### Prerequisites

- Node.js 24+
- pnpm
- ffmpeg installed on the system

### Install dependencies

```bash
pnpm install
```

### Set environment variables

Create a `.env` file or add to your environment:

```env
GROQ_API_KEY=your_groq_api_key_here
```

### Run development server

```bash
# Start the API server
pnpm --filter @workspace/api-server run dev

# Start the frontend (in a separate terminal)
pnpm --filter @workspace/audio-to-srt run dev
```

The frontend runs on port `22919` and the API server on port `8080`.

---

## API

### `POST /api/transcribe`

Transcribes an audio file and returns an `.srt` subtitle file.

**Request:** `multipart/form-data`

| Field | Type | Required | Description |
|---|---|---|---|
| `audio` | File | Yes | Audio/video file (max 30 MB) |
| `language` | string | No | Language code (e.g. `en`, `bn`, `hi`). Omit for auto-detect. |

**Response:** `text/plain` — raw SRT file content

**Error response:** `application/json` — `{ "error": "message" }`

### `GET /api/healthz`

Health check endpoint. Returns `{ "status": "ok" }`.

---

## Project Structure

```
artifacts/
  audio-to-srt/     # React + Vite frontend
  api-server/       # Express API server
lib/
  api-spec/         # OpenAPI spec
  api-client-react/ # Generated React Query hooks
  api-zod/          # Generated Zod schemas
  db/               # Database schema (Drizzle ORM)
```

---

## Notes

- The app uses ffmpeg to transcode audio to mono 16kHz MP3 before sending to Whisper. This improves accuracy and reduces file size.
- If ffmpeg is not available, the original file is sent as-is.
- Punctuation is added to the full transcript at once (not per segment), so punctuation only appears at natural sentence boundaries — not at the end of every subtitle line.
