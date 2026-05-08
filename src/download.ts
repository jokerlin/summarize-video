// src/download.ts
import { mkdir, readdir, rename, stat } from "node:fs/promises";
import { extname, join } from "node:path";
import { type LineHandler, run, runStreaming } from "./shell.ts";
import type { Metadata } from "./types.ts";

export interface DownloadOptions {
  cookiesFromBrowser?: string | undefined;
}

const cookieArgs = (opts: DownloadOptions): string[] =>
  opts.cookiesFromBrowser ? ["--cookies-from-browser", opts.cookiesFromBrowser] : [];

const PRINT_TEMPLATE = "%(title)s\t%(duration)s\t%(uploader)s\t%(extractor)s\t%(language)s";

export async function getMetadata(url: string, opts: DownloadOptions = {}): Promise<Metadata> {
  const r = await run("yt-dlp", [
    ...cookieArgs(opts),
    "--no-warnings",
    "--print",
    PRINT_TEMPLATE,
    url,
  ]);
  if (r.exitCode !== 0) {
    throw new Error(
      `yt-dlp metadata fetch failed (${r.exitCode}): ${r.stderr.trim().slice(0, 800)}`,
    );
  }
  const line = r.stdout.split("\n").find((l) => l.includes("\t")) ?? r.stdout.trim();
  const [title, duration, uploader, extractor, language] = line.split("\t");
  return {
    title: title ?? "untitled",
    duration: Number.parseFloat(duration ?? "0") || 0,
    uploader: uploader ?? "",
    platform: extractor ?? "",
    language: language && language !== "NA" ? language : "",
    url,
    downloadTime: new Date().toISOString(),
  };
}

const onStderrPassthrough: LineHandler = (line) => process.stderr.write(`${line}\n`);

export async function downloadVideo(
  url: string,
  outDir: string,
  opts: DownloadOptions = {},
): Promise<string> {
  await mkdir(outDir, { recursive: true });
  const args = [
    ...cookieArgs(opts),
    "-f",
    "bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[height<=1080][ext=mp4]/best",
    "--merge-output-format",
    "mp4",
    "-o",
    join(outDir, "video.%(ext)s"),
    url,
  ];
  const exit = await runStreaming("yt-dlp", args, onStderrPassthrough, onStderrPassthrough);
  if (exit !== 0) throw new Error(`yt-dlp video download failed (${exit})`);
  return join(outDir, "video.mp4");
}

export async function downloadAudio(
  url: string,
  outDir: string,
  opts: DownloadOptions = {},
): Promise<string> {
  await mkdir(outDir, { recursive: true });
  const args = [
    ...cookieArgs(opts),
    "-x",
    "--audio-format",
    "mp3",
    "-o",
    join(outDir, "audio.%(ext)s"),
    url,
  ];
  const exit = await runStreaming("yt-dlp", args, onStderrPassthrough, onStderrPassthrough);
  if (exit !== 0) throw new Error(`yt-dlp audio download failed (${exit})`);
  return join(outDir, "audio.mp3");
}

async function nonEmptyVttPresent(dir: string, prefix = "subtitle"): Promise<string | null> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return null;
  }
  for (const n of names) {
    if (!n.startsWith(prefix)) continue;
    if (extname(n).toLowerCase() !== ".vtt") continue;
    const full = join(dir, n);
    const s = await stat(full);
    if (s.size > 0) return full;
  }
  return null;
}

/**
 * Try manual subtitles first, then auto. Renames a winning file to
 * `<outDir>/subtitle.vtt`. Returns "manual" / "auto" / null.
 */
export async function downloadSubtitles(
  url: string,
  outDir: string,
  opts: DownloadOptions = {},
): Promise<"manual" | "auto" | null> {
  await mkdir(outDir, { recursive: true });
  const baseOut = join(outDir, "subtitle");

  // Tier 1: manual
  await run("yt-dlp", [
    ...cookieArgs(opts),
    "--write-subs",
    "--sub-lang",
    "zh,en,zh-Hans,zh-Hant",
    "--skip-download",
    "-o",
    baseOut,
    url,
  ]);
  const manual = await nonEmptyVttPresent(outDir);
  if (manual) {
    if (manual !== join(outDir, "subtitle.vtt")) {
      await rename(manual, join(outDir, "subtitle.vtt"));
    }
    return "manual";
  }

  // Tier 2: auto
  await run("yt-dlp", [
    ...cookieArgs(opts),
    "--write-auto-subs",
    "--sub-lang",
    "zh,en",
    "--skip-download",
    "-o",
    baseOut,
    url,
  ]);
  const auto = await nonEmptyVttPresent(outDir);
  if (auto) {
    if (auto !== join(outDir, "subtitle.vtt")) {
      await rename(auto, join(outDir, "subtitle.vtt"));
    }
    return "auto";
  }

  return null;
}
