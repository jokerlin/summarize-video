// src/ffmpeg.ts
// Thin wrappers around ffmpeg/ffprobe. Pure-argv builders are exported so tests
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

export function buildSilenceDetectArgs(path: string, noiseDb = -40, minDuration = 0.5): string[] {
  return [
    "-i",
    path,
    "-af",
    `silencedetect=noise=${noiseDb}dB:d=${minDuration}`,
    "-f",
    "null",
    "-",
  ];
}

export async function runSilenceDetect(
  path: string,
  noiseDb = -40,
  minDuration = 0.5,
): Promise<string> {
  const r = await run("ffmpeg", buildSilenceDetectArgs(path, noiseDb, minDuration));
  // ffmpeg writes silencedetect output to stderr regardless of exit code.
  return r.stderr;
}

export function buildCutSegmentArgs(
  input: string,
  start: number,
  end: number,
  output: string,
): string[] {
  return ["-y", "-i", input, "-ss", String(start), "-to", String(end), "-c", "copy", output];
}

export async function cutSegment(
  input: string,
  start: number,
  end: number,
  output: string,
): Promise<void> {
  const r = await run("ffmpeg", buildCutSegmentArgs(input, start, end, output));
  if (r.exitCode !== 0) {
    throw new Error(`ffmpeg cut failed (${r.exitCode}): ${r.stderr.trim().slice(-500)}`);
  }
}
