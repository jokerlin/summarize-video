// src/splitter.ts
// (cutSegment / getAudioDuration imports added in Task 8 alongside splitAudio)

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
