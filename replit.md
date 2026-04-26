# Workspace

## Overview

Audio to SRT — a pnpm workspace monorepo using TypeScript. Upload an audio file, get a downloadable SRT subtitle file. Uses Groq Whisper for transcription and Groq LLaMA for punctuation restoration.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Transcription**: Groq Whisper (`whisper-large-v3`)
- **Punctuation LLM**: Groq LLaMA (`llama-3.1-8b-instant`)
- **Audio processing**: ffmpeg
- **Build**: esbuild (CJS bundle)

## Artifacts

- **audio-to-srt** (`/`) — React + Vite frontend. Upload audio, choose language, get SRT.
- **api-server** (`/api`) — Express server. Routes: `GET /api/healthz`, `POST /api/transcribe` (multipart, field `audio`, optional `language`).

## Required Environment Variables

- `GROQ_API_KEY` — **Required for full functionality**
  - Used for Whisper transcription (`whisper-large-v3`)
  - Used for LLaMA punctuation restoration (`llama-3.1-8b-instant`)
  - Get from: https://console.groq.com → API Keys
  - Fallback: if not set, uses Replit's OpenAI integration (transcription only, no punctuation)

## Key Commands

- `pnpm install` — install all dependencies
- `pnpm --filter @workspace/api-server run dev` — run API server locally
- `pnpm --filter @workspace/audio-to-srt run dev` — run frontend locally
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages

## Transcription Flow

1. Audio uploaded via `POST /api/transcribe`
2. ffmpeg transcodes to mono 16kHz MP3
3. Groq Whisper returns transcript with timestamps (segments)
4. Full transcript text sent to Groq LLaMA for punctuation restoration
5. Punctuated tokens mapped back to original segments (timestamps preserved)
6. SRT file returned as response
