# Workspace

## Overview

Audio to SRT — a pnpm workspace monorepo using TypeScript. Upload an audio file, get a downloadable SRT subtitle file. Uses Groq Whisper for transcription and Groq LLaMA for punctuation restoration.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Transcription**: Groq Whisper (`whisper-large-v3-turbo`)
- **Punctuation LLM**: Groq LLaMA 4 (`meta-llama/llama-4-scout-17b-16e-instruct`)
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
3. Groq Whisper returns transcript with **word-level + segment-level** timestamps
4. Original words are split into ~350-word chunks and sent to Groq LLaMA in **parallel** for punctuation (avoids LLM output truncation on long transcripts)
5. Punctuated tokens are aligned back to the original word stream (with look-ahead fuzzy matching)
6. Cues are built per **sentence boundary** (`.`, `!`, `?`, `।`, `॥`) using actual word timestamps, with a 90-char cap to keep cues readable
7. SRT file returned as response

Fallback chain: word timestamps → segment timestamps → plain text proportional split.
