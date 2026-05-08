// test/splitter.test.ts
import { describe, expect, test } from "bun:test";
import { filterValidSplitPoints, findSplitPoints } from "../src/splitter.ts";

describe("findSplitPoints", () => {
  test("returns [] when duration <= max", () => {
    expect(findSplitPoints(40, [10, 20, 30])).toEqual([]);
    expect(findSplitPoints(45, [])).toEqual([]);
  });

  test("picks silences spaced about target apart", () => {
    expect(findSplitPoints(120, [30, 60, 90, 110])).toEqual([30, 60, 90]);
  });

  test("falls back to equal cuts when no silence at all", () => {
    expect(findSplitPoints(120, [])).toEqual([30, 60, 90]);
  });

  test("forces a split when current segment exceeds 80% of max", () => {
    expect(findSplitPoints(60, [37])).toEqual([37]);
    expect(findSplitPoints(60, [11])).toEqual([30]);
  });

  test("trims trailing point when tail < min (Refinement A)", () => {
    expect(findSplitPoints(120, [30, 60, 90, 119.8])).toEqual([30, 60, 90]);
  });

  test("does not trim when tail >= min", () => {
    expect(findSplitPoints(120, [30, 60, 100])).toEqual([30, 60, 100]);
  });

  test("respects custom target/min/max", () => {
    expect(findSplitPoints(200, [50, 100, 150], 50, 20, 70)).toEqual([50, 100, 150]);
  });

  test("subdivides leading oversized section before first silence (P2)", () => {
    // Silence at 600s; 0..600 must be cut into ~target-sized pieces.
    const result = findSplitPoints(700, [600]);
    // Phase 1 picks 600. Phase 2 inserts 30,60,...,570,600 then nothing tail-side
    // (700-600=100 > 45 → 630, 660, 690; 700-690=10, no further cut).
    expect(result[0]).toBe(30);
    expect(result.includes(600)).toBe(true);
    // No chunk exceeds max=45.
    const all = [0, ...result, 700];
    for (let i = 1; i < all.length; i++) {
      expect(all[i]! - all[i - 1]!).toBeLessThanOrEqual(45);
    }
  });

  test("subdivides oversized tail when last silence is far from end (P2)", () => {
    const result = findSplitPoints(200, [40]);
    // Phase 1 picks 40 (segLen=40, <=max). Phase 2 must cut the 40..200 tail.
    expect(result.includes(40)).toBe(true);
    const all = [0, ...result, 200];
    for (let i = 1; i < all.length; i++) {
      expect(all[i]! - all[i - 1]!).toBeLessThanOrEqual(45);
    }
  });

  test("subdivides oversized gap between sparse silences (P2)", () => {
    // 1200s audio with only two far-apart silences — the bilibili case.
    const result = findSplitPoints(1200, [400, 800]);
    expect(result.length).toBeGreaterThan(20);
    const all = [0, ...result, 1200];
    for (let i = 1; i < all.length; i++) {
      expect(all[i]! - all[i - 1]!).toBeLessThanOrEqual(45);
    }
  });

  test("stays monotonic with degenerate target > max (Codex regression)", () => {
    // Phase 2 step must be clamped so cursor never overshoots the silence.
    const result = findSplitPoints(130, [100], 120, 10, 45);
    for (let i = 1; i < result.length; i++) {
      expect(result[i]!).toBeGreaterThan(result[i - 1]!);
    }
    expect(result[result.length - 1]!).toBeLessThan(130);
    const all = [0, ...result, 130];
    for (let i = 1; i < all.length; i++) {
      expect(all[i]! - all[i - 1]!).toBeLessThanOrEqual(45);
    }
  });
});

describe("filterValidSplitPoints (v1.1.1 fix)", () => {
  test("drops points within 0.5s of duration", () => {
    expect(filterValidSplitPoints([10, 30, 119.8, 120.1], 120)).toEqual([10, 30]);
  });

  test("keeps all points when none exceed duration - 0.5", () => {
    expect(filterValidSplitPoints([10, 30, 60], 120)).toEqual([10, 30, 60]);
  });

  test("returns [] when duration is shorter than all points", () => {
    expect(filterValidSplitPoints([10, 30], 5)).toEqual([]);
  });
});
