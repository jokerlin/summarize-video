// src/splitter.ts
import { join } from "node:path";
import { cutSegment, getAudioDuration } from "./ffmpeg.ts";

/**
 * Decide where to split an audio file given silence candidates.
 *
 * Mirrors the Python parallel_transcribe.py heuristic:
 * - Prefer silences spaced ~target apart, within [min, max] segment length
 * - Force a split when current segment exceeds 80% of max
 * - Fall back to equal target-length cuts when no silence at all
 *
 * Refinement A: trim trailing split points whose tail-segment would be < min.
 */
export function findSplitPoints(
  duration: number,
  silencePoints: number[],
  target = 30,
  min = 10,
  max = 45,
): number[] {
  if (duration <= max) return [];

  const splitPoints: number[] = [];
  let lastSplit = 0;

  for (const s of silencePoints) {
    const segLen = s - lastSplit;
    if (segLen >= target) {
      if (segLen <= max || splitPoints.length === 0) {
        splitPoints.push(s);
        lastSplit = s;
      }
    } else if (segLen >= min && s - lastSplit > max * 0.8) {
      splitPoints.push(s);
      lastSplit = s;
    }
  }

  if (splitPoints.length === 0 && duration > max) {
    const n = Math.floor(duration / target) + 1;
    for (let i = 1; i < n; i++) {
      splitPoints.push(i * target);
    }
  }

  // Refinement A: drop trailing splits that produce a too-short tail chunk.
  while (splitPoints.length > 0 && duration - splitPoints[splitPoints.length - 1]! < min) {
    splitPoints.pop();
  }

  return splitPoints;
}

export function filterValidSplitPoints(splitPoints: number[], duration: number): number[] {
  return splitPoints.filter((sp) => sp < duration - 0.5);
}

export interface AudioChunk {
  path: string;
  startOffset: number;
}

/**
 * Split an audio file at the given timestamps, writing chunk_NNN.mp3 files
 * into outDir. Stream-copies (no re-encode). Returns chunk descriptors with
 * their global start offsets.
 *
 * Applies the v1.1.1 safety filter (drops points within 0.5s of duration).
 */
export async function splitAudio(
  audioPath: string,
  splitPoints: number[],
  outDir: string,
): Promise<AudioChunk[]> {
  const duration = await getAudioDuration(audioPath);
  const valid = filterValidSplitPoints(splitPoints, duration);
  const allPoints = [0, ...valid, duration];

  const chunks: AudioChunk[] = [];
  for (let i = 0; i < allPoints.length - 1; i++) {
    const start = allPoints[i]!;
    const end = allPoints[i + 1]!;
    const chunkPath = join(outDir, `chunk_${String(i).padStart(3, "0")}.mp3`);
    await cutSegment(audioPath, start, end, chunkPath);
    chunks.push({ path: chunkPath, startOffset: start });
  }
  return chunks;
}
