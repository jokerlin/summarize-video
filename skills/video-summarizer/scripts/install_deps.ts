#!/usr/bin/env bun
// skills/video-summarizer/scripts/install_deps.ts
// Check + install required system tools for the video-summarizer skill.

import { run, which } from "../../../src/shell.ts";

const log = (s: string) => process.stdout.write(`${s}\n`);
const err = (s: string) => process.stderr.write(`${s}\n`);

async function ensureFfmpeg(): Promise<void> {
  if (await which("ffmpeg")) {
    log("  ffmpeg: OK");
    return;
  }
  if (process.platform === "darwin") {
    if (!(await which("brew"))) {
      err("  Error: Homebrew not found. Install ffmpeg manually.");
      process.exit(1);
    }
    log("  Installing ffmpeg via brew...");
    const r = await run("brew", ["install", "ffmpeg"]);
    if (r.exitCode !== 0) {
      err(r.stderr);
      process.exit(1);
    }
    log("  ffmpeg installed.");
    return;
  }
  if (await Bun.file("/etc/debian_version").exists()) {
    log("  Installing ffmpeg via apt-get...");
    await run("sudo", ["apt-get", "update"]);
    const r = await run("sudo", ["apt-get", "install", "-y", "ffmpeg"]);
    if (r.exitCode !== 0) {
      err(r.stderr);
      process.exit(1);
    }
    return;
  }
  if (await Bun.file("/etc/redhat-release").exists()) {
    log("  Installing ffmpeg via dnf...");
    const r = await run("sudo", ["dnf", "install", "-y", "ffmpeg"]);
    if (r.exitCode !== 0) {
      err(r.stderr);
      process.exit(1);
    }
    return;
  }
  err("  Error: please install ffmpeg manually.");
  process.exit(1);
}

async function ensureYtDlp(): Promise<void> {
  if (await which("yt-dlp")) {
    log("  yt-dlp: OK");
    return;
  }
  if (process.platform === "darwin" && (await which("brew"))) {
    log("  Installing yt-dlp via brew...");
    await run("brew", ["install", "yt-dlp"]);
    return;
  }
  if (await which("pipx")) {
    log("  Installing yt-dlp via pipx...");
    await run("pipx", ["install", "yt-dlp"]);
    return;
  }
  err("  Error: install yt-dlp manually (e.g. brew install yt-dlp).");
  process.exit(1);
}

async function ensureWhisperCli(): Promise<void> {
  if (await which("whisper-cli")) {
    log("  whisper-cli: OK");
    return;
  }
  if (process.platform === "darwin") {
    if (!(await which("brew"))) {
      err("  Error: Homebrew not found. Install whisper-cpp manually:");
      err("    https://github.com/ggml-org/whisper.cpp");
      process.exit(1);
    }
    log("  Installing whisper-cpp via brew...");
    const r = await run("brew", ["install", "whisper-cpp"]);
    if (r.exitCode !== 0) {
      err(r.stderr);
      process.exit(1);
    }
    return;
  }
  err("  Error: please install whisper-cpp manually (provides `whisper-cli`):");
  err("    https://github.com/ggml-org/whisper.cpp");
  process.exit(1);
}

async function main(): Promise<void> {
  log("==========================================");
  log("Video Summarizer (TS) - Dependency Check");
  log("==========================================");
  log("");
  log("[1/3] ffmpeg / ffprobe");
  await ensureFfmpeg();
  if (!(await which("ffprobe"))) {
    err("  Error: ffprobe missing (should ship with ffmpeg).");
    process.exit(1);
  }
  log("  ffprobe: OK");
  log("");
  log("[2/3] yt-dlp");
  await ensureYtDlp();
  log("");
  log("[3/3] whisper-cli (whisper.cpp)");
  await ensureWhisperCli();
  log("");
  log("All dependencies present.");
  log("");
  log("Versions:");
  for (const [name, args] of [
    ["bun", ["--version"]] as const,
    ["ffmpeg", ["-version"]] as const,
    ["yt-dlp", ["--version"]] as const,
    ["whisper-cli", ["--help"]] as const,
  ]) {
    const r = await run(name, [...args]);
    const firstLine = r.stdout.trim().split("\n")[0] || r.stderr.trim().split("\n")[0] || "";
    log(`  ${name}: ${firstLine}`);
  }
}

if (import.meta.main) {
  main().catch((e) => {
    err(`Fatal: ${(e as Error).message}`);
    process.exit(1);
  });
}
