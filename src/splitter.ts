// src/splitter.ts
import { join } from "node:path";
import { cutSegment, getAudioDuration } from "./ffmpeg.ts";

/**
 * Decide where to split an audio file given silence candidates.
 *
 * Two-phase algorithm:
 *
 * Phase 1 — silence-driven (mirrors Python parallel_transcribe.py heuristic):
 *   - Prefer silences spaced ~target apart, within [min, max] segment length
 *   - Force a split when current segment exceeds 80% of max
 *
 * Phase 2 — bound oversized chunks (P2 fix for sparse-silence audio):
 *   - Walk the picked silences; whenever a chunk would exceed `max`, insert
 *     equal-target cuts inside it. Also bounds the leading section (before
 *     the first silence) and the trailing section (after the last).
 *   - This subsumes the old "no silence at all" fallback as the trivial case
 *     where Phase 1 produces zero points.
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

  // Phase 1: silence-driven picking.
  const phase1: number[] = [];
  let lastSplit = 0;
  for (const s of silencePoints) {
    const segLen = s - lastSplit;
    if (segLen >= target) {
      if (segLen <= max || phase1.length === 0) {
        phase1.push(s);
        lastSplit = s;
      }
    } else if (segLen >= min && s - lastSplit > max * 0.8) {
      phase1.push(s);
      lastSplit = s;
    }
  }

  // Phase 2: subdivide any chunk that still exceeds max.
  // Step is clamped to `max` so cursor never overshoots the next silence point
  // (or `duration`) when a caller supplies the degenerate `target > max`.
  // While the CLI always uses target=30/max=45, the helper is publicly exposed
  // and a non-monotonic result would make splitAudio ask ffmpeg for a
  // negative-length segment.
  const step = Math.min(target, max);
  const splitPoints: number[] = [];
  let cursor = 0;
  for (const sp of phase1) {
    while (sp - cursor > max) {
      cursor = cursor + step;
      splitPoints.push(cursor);
    }
    splitPoints.push(sp);
    cursor = sp;
  }
  while (duration - cursor > max) {
    cursor = cursor + step;
    splitPoints.push(cursor);
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
