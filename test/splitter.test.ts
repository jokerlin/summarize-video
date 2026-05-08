// test/splitter.test.ts
import { describe, expect, test } from "bun:test";
import { findSplitPoints } from "../src/splitter.ts";

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
});
