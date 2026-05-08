// src/types.ts
// Shared types and discriminated unions used across modules.

export interface Segment {
  start: number;
  end: number;
  text: string;
}

export interface ChunkTask {
  chunkIdx: number;
  chunkPath: string;
  startTime: number;
  language: string;
}

export interface ChunkResult {
  chunkIdx: number;
  segments: Segment[];
  startTime: number;
  error?: string;
}

export interface Metadata {
  title: string;
  duration: number;
  uploader: string;
  platform: string;
  language: string;
  url: string;
  downloadTime: string;
}

export type SubtitleSource = "manual" | "auto" | "whisper";

// Worker IPC — discriminated unions
export type WorkerMessage =
  | { type: "LOAD"; model: string }
  | { type: "TRANSCRIBE"; task: ChunkTask }
  | { type: "SHUTDOWN" };

export type WorkerReply =
  | { type: "READY" }
  | { type: "RESULT"; result: ChunkResult }
  | { type: "ERROR"; chunkIdx: number; message: string }
  | { type: "SHUTDOWN_DONE" };

export type WhisperModelName = "tiny" | "base" | "small" | "medium" | "large-v3";

export interface CliOptions {
  url: string;
  model: WhisperModelName;
  language: string;
  workers: number | undefined;
  minSegment: number;
  output: string;
  cookiesFromBrowser: string | undefined;
  skipVideo: boolean;
  noDiskCheck: boolean;
}
