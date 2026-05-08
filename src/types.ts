// src/types.ts
// Shared types used across modules.

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

export type WhisperModelName = "tiny" | "base" | "small" | "medium" | "large-v3";

export interface CliOptions {
  url: string;
  model: WhisperModelName;
  language: string;
  output: string;
  /** Browser to extract cookies from. Defaults to "chrome". `undefined` means --no-cookies. */
  cookiesFromBrowser: string | undefined;
  skipVideo: boolean;
  noDiskCheck: boolean;
}
