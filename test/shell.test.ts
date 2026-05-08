// test/shell.test.ts
import { describe, expect, test } from "bun:test";
import { run, sanitizeTitle, which } from "../src/shell.ts";

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

describe("which", () => {
  test("finds an existing binary", async () => {
    const path = await which("sh");
    expect(path).not.toBeNull();
    expect(path).toMatch(/\/sh$/);
  });

  test("returns null for a missing binary", async () => {
    const path = await which("definitely-not-a-real-binary-xyz123");
    expect(path).toBeNull();
  });
});

describe("run", () => {
  test("captures stdout and exit code", async () => {
    const r = await run("echo", ["hello"]);
    expect(r.stdout.trim()).toBe("hello");
    expect(r.exitCode).toBe(0);
  });

  test("captures stderr separately", async () => {
    const r = await run("sh", ["-c", "echo out; echo err 1>&2"]);
    expect(r.stdout.trim()).toBe("out");
    expect(r.stderr.trim()).toBe("err");
  });

  test("non-zero exit code is preserved", async () => {
    const r = await run("sh", ["-c", "exit 7"]);
    expect(r.exitCode).toBe(7);
  });
});
