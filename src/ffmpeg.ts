// src/ffmpeg.ts
// Thin wrappers around ffprobe. Pure-argv builders are exported so tests
// don't need a real ffmpeg binary.

import { run } from "./shell.ts";

export function buildDurationArgs(path: string): string[] {
  return [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    path,
  ];
}

export async function getAudioDuration(path: string): Promise<number> {
  const r = await run("ffprobe", buildDurationArgs(path));
  if (r.exitCode !== 0) {
    throw new Error(`ffprobe failed (${r.exitCode}): ${r.stderr.trim()}`);
  }
  const v = Number.parseFloat(r.stdout.trim());
  if (!Number.isFinite(v) || v < 0) {
    throw new Error(`ffprobe returned non-numeric duration: ${r.stdout.trim()}`);
  }
  return v;
}
