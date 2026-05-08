// test/shell.test.ts
import { describe, expect, test } from "bun:test";
import { sanitizeTitle } from "../src/shell.ts";

describe("sanitizeTitle", () => {
  test("replaces filesystem-reserved chars with underscore", () => {
    expect(sanitizeTitle('a/b\\c:d*e?f"g<h>i|j')).toBe("a_b_c_d_e_f_g_h_i_j");
  });

  test("strips ASCII control characters", () => {
    expect(sanitizeTitle("hello\x00\x07\x1fworld")).toBe("hello___world");
  });

  test("preserves CJK characters verbatim", () => {
    expect(sanitizeTitle("视频标题:测试")).toBe("视频标题_测试");
  });

  test("preserves emoji verbatim", () => {
    expect(sanitizeTitle("video 🎬 demo")).toBe("video 🎬 demo");
  });

  test("truncates to 80 code points by default", () => {
    const long = "a".repeat(100);
    expect(sanitizeTitle(long).length).toBe(80);
  });

  test("truncation counts code points, not bytes — CJK is not split", () => {
    const cjk = "中".repeat(100);
    const out = sanitizeTitle(cjk);
    expect([...out].length).toBe(80);
    expect(out).toBe("中".repeat(80));
  });

  test("truncates to caller-provided max", () => {
    expect(sanitizeTitle("abcdef", 3)).toBe("abc");
  });

  test("trims trailing whitespace after truncation", () => {
    expect(sanitizeTitle("hello world ", 12)).toBe("hello world");
  });
});
