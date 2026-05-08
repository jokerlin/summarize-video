// src/subtitles.ts
import { readdir } from "node:fs/promises";
import { extname, join } from "node:path";

const VTT_TIMESTAMP_RE = /-->/;
const VTT_HEADER_RE = /^(WEBVTT|Kind:|Language:|NOTE)/;
const SRT_INDEX_RE = /^\d+$/;
const SRT_TIMESTAMP_RE = /-->/;

export async function vttToTranscript(path: string): Promise<string> {
  const text = await Bun.file(path).text();
  const lines = text.split(/\r?\n/);
  const out: string[] = [];

  let inNoteBlock = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (line.length === 0) {
      inNoteBlock = false;
      continue;
    }
    if (VTT_HEADER_RE.test(line)) {
      if (line.startsWith("NOTE")) inNoteBlock = true;
      continue;
    }
    if (inNoteBlock) continue;
    if (VTT_TIMESTAMP_RE.test(line)) continue;
    if (/^\d+$/.test(line)) continue;
    out.push(line);
  }

  return out.join("\n") + (out.length > 0 ? "\n" : "");
}

export async function srtToTranscript(path: string): Promise<string> {
  const text = await Bun.file(path).text();
  const lines = text.split(/\r?\n/);
  const out: string[] = [];

  for (const raw of lines) {
    const line = raw.trim();
    if (line.length === 0) continue;
    if (SRT_INDEX_RE.test(line)) continue;
    if (SRT_TIMESTAMP_RE.test(line)) continue;
    out.push(line);
  }
  return out.join("\n") + (out.length > 0 ? "\n" : "");
}

/**
 * Find the first .vtt or .srt file in `dir`. Returns null if none found.
 */
export async function findSubtitleFile(dir: string): Promise<string | null> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return null;
  }
  for (const name of entries) {
    const ext = extname(name).toLowerCase();
    if (ext === ".vtt" || ext === ".srt") return join(dir, name);
  }
  return null;
}
