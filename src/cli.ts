#!/usr/bin/env bun
// src/cli.ts
import { mkdir, statfs, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { runAll } from "./cleanup.ts";
import { downloadAudio, downloadSubtitles, downloadVideo, getMetadata } from "./download.ts";
import { sanitizeTitle, which } from "./shell.ts";
import { findSubtitleFile, vttToTranscript } from "./subtitles.ts";
import { transcribeWithWhisperCli } from "./transcribe.ts";
import type { CliOptions, SubtitleSource, WhisperModelName } from "./types.ts";

const USAGE = `Usage: bun run summarize <url> [options]

Options:
  --model <name>            tiny | base | small (default) | medium | large-v3
  --language <code>         Language code or 'auto' (default: auto)
  --output <dir>            Root output dir (default: ./downloads)
  --cookies-from-browser <browser>   chrome (default) | firefox | edge | safari
  --no-cookies              Disable cookie extraction (default sends Chrome cookies)
  --skip-video              Don't download video.mp4
  --no-disk-check           Skip the pre-flight free-space warning
  --help                    Print this help
`;

const VALID_MODELS: WhisperModelName[] = ["tiny", "base", "small", "medium", "large-v3"];
const MIN_FREE_BYTES = 2 * 1024 ** 3; // 2 GB
const DEFAULT_BROWSER = "chrome";

function parseCliArgs(): CliOptions {
  const { values, positionals } = parseArgs({
    options: {
      model: { type: "string", default: "small" },
      language: { type: "string", default: "auto" },
      output: { type: "string", default: "./downloads" },
      "cookies-from-browser": { type: "string" },
      "no-cookies": { type: "boolean", default: false },
      "skip-video": { type: "boolean", default: false },
      "no-disk-check": { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
    allowPositionals: true,
    strict: true,
  });

  if (values.help) {
    process.stdout.write(USAGE);
    process.exit(0);
  }
  const url = positionals[0];
  if (!url) {
    process.stderr.write(`Error: missing <url>\n\n${USAGE}`);
    process.exit(1);
  }
  if (!VALID_MODELS.includes(values.model as WhisperModelName)) {
    process.stderr.write(`Error: --model must be one of: ${VALID_MODELS.join(", ")}\n`);
    process.exit(1);
  }
  if (values["no-cookies"] && values["cookies-from-browser"]) {
    process.stderr.write("Error: --no-cookies and --cookies-from-browser are mutually exclusive\n");
    process.exit(1);
  }

  // Resolve cookies: explicit browser > --no-cookies > default chrome.
  const cookiesFromBrowser = values["no-cookies"]
    ? undefined
    : (values["cookies-from-browser"] ?? DEFAULT_BROWSER);

  return {
    url,
    model: values.model as WhisperModelName,
    language: values.language!,
    output: values.output!,
    cookiesFromBrowser,
    skipVideo: values["skip-video"]!,
    noDiskCheck: values["no-disk-check"]!,
  };
}

async function checkDependencies(): Promise<void> {
  const missing: string[] = [];
  for (const bin of ["yt-dlp", "ffmpeg", "ffprobe"]) {
    if (!(await which(bin))) missing.push(bin);
  }
  if (missing.length > 0) {
    process.stderr.write(
      `Error: missing required binaries: ${missing.join(", ")}\nRun: bun run skills/video-summarizer/scripts/install_deps.ts\n`,
    );
    process.exit(1);
  }
}

async function checkDiskSpace(dir: string): Promise<void> {
  try {
    const s = await statfs(dir);
    const free = Number(s.bavail) * Number(s.bsize);
    if (free < MIN_FREE_BYTES) {
      process.stderr.write(
        `Warning: only ${(free / 1024 ** 3).toFixed(1)} GB free on ${dir}'s filesystem (recommend >= 2 GB). Pass --no-disk-check to silence this.\n`,
      );
    }
  } catch {
    // statfs unsupported — silently skip
  }
}

function installSignalHandlers() {
  const handle = async (sig: NodeJS.Signals) => {
    process.stderr.write(`\nReceived ${sig}, cleaning up...\n`);
    await runAll();
    process.exit(130);
  };
  process.on("SIGINT", handle);
  process.on("SIGTERM", handle);
}

export async function main(): Promise<number> {
  installSignalHandlers();
  const opts = parseCliArgs();

  await checkDependencies();
  await mkdir(opts.output, { recursive: true });
  if (!opts.noDiskCheck) await checkDiskSpace(opts.output);

  process.stderr.write(`Fetching metadata for ${opts.url}...\n`);
  const cookiesOpt =
    opts.cookiesFromBrowser !== undefined ? { cookiesFromBrowser: opts.cookiesFromBrowser } : {};
  const meta = await getMetadata(opts.url, cookiesOpt);
  const safeTitle = sanitizeTitle(meta.title);
  const outDir = join(opts.output, safeTitle);
  await mkdir(outDir, { recursive: true });
  process.stderr.write(`Output dir: ${outDir}\n`);

  if (!opts.skipVideo) {
    process.stderr.write("Downloading video...\n");
    await downloadVideo(opts.url, outDir, cookiesOpt);
  }

  process.stderr.write("Extracting audio...\n");
  await downloadAudio(opts.url, outDir, cookiesOpt);

  process.stderr.write("Trying to fetch subtitles...\n");
  let source: SubtitleSource;
  const subTier = await downloadSubtitles(opts.url, outDir, cookiesOpt);
  if (subTier) {
    source = subTier;
    const sub = await findSubtitleFile(outDir);
    if (sub) {
      const txt = await vttToTranscript(sub);
      await Bun.write(join(outDir, "transcript.txt"), txt);
    }
  } else {
    source = "whisper";
    await transcribeWithWhisperCli({
      input: join(outDir, "audio.mp3"),
      outputDir: outDir,
      model: opts.model,
      language: opts.language,
    });
  }

  await writeFile(
    join(outDir, "_metadata.json"),
    JSON.stringify(
      {
        title: meta.title,
        platform: meta.platform,
        url: meta.url,
        duration: meta.duration,
        language: meta.language,
        downloadTime: meta.downloadTime,
        subtitleSource: source,
      },
      null,
      2,
    ),
  );

  const summary: string[] = [];
  if (!opts.skipVideo) summary.push("✓ video.mp4");
  summary.push("✓ audio.mp3");
  summary.push(`✓ subtitle.vtt    (source: ${source})`);
  summary.push("✓ transcript.txt");
  summary.push("⚠ summary.md      (skill mode only — Claude generates this)");
  process.stdout.write(`${summary.join("\n")}\n`);
  return 0;
}

if (import.meta.main) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      process.stderr.write(`Fatal: ${(err as Error).stack ?? String(err)}\n`);
      process.exit(1);
    },
  );
}
