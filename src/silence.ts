// src/silence.ts
import { getAudioDuration, runSilenceDetect } from "./ffmpeg.ts";

const SILENCE_END_RE = /silence_end:\s*([\d.]+)/;
const SILENCE_START_RE = /silence_start:\s*([\d.]+)/;

/**
 * Parse ffmpeg silencedetect stderr into split-candidate timestamps.
 *
 * Returns silence_end timestamps in document order, plus an unmatched trailing
 * silence_start (silence-to-EOF case) when it falls within audioDuration.
 */
export function parseSilenceDetectStderr(stderr: string, audioDuration: number): number[] {
  const ends: number[] = [];
  let lastSilenceStart: number | null = null;
  let matched = true;

  for (const rawLine of stderr.split("\n")) {
    const startMatch = rawLine.match(SILENCE_START_RE);
    if (startMatch) {
      const v = Number.parseFloat(startMatch[1]!);
      if (Number.isFinite(v)) {
        lastSilenceStart = v;
        matched = false;
      }
      continue;
    }
    const endMatch = rawLine.match(SILENCE_END_RE);
    if (endMatch) {
      const v = Number.parseFloat(endMatch[1]!);
      if (Number.isFinite(v)) {
        ends.push(v);
        matched = true;
      }
    }
  }

  if (!matched && lastSilenceStart !== null && lastSilenceStart < audioDuration) {
    ends.push(lastSilenceStart);
  }
  return ends;
}

/**
 * Run ffmpeg silencedetect on an audio file and return split-candidate timestamps.
 */
export async function detectSilence(
  audioPath: string,
  noiseDb = -40,
  minDuration = 0.5,
): Promise<number[]> {
  const stderr = await runSilenceDetect(audioPath, noiseDb, minDuration);
  const duration = await getAudioDuration(audioPath);
  return parseSilenceDetectStderr(stderr, duration);
}
