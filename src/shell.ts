// src/shell.ts
// biome-ignore lint/suspicious/noControlCharactersInRegex: intentionally matching control chars 0x00-0x1f
const RESERVED_CHARS = /[\\/:*?"<>|\x00-\x1f]/g;

export function sanitizeTitle(s: string, max = 80): string {
  const cleaned = s.replace(RESERVED_CHARS, "_");
  // Slice by code points, not UTF-16 units, so emoji aren't split mid-surrogate.
  const codePoints = [...cleaned];
  const truncated = codePoints.slice(0, max).join("");
  return truncated.replace(/\s+$/u, "");
}
