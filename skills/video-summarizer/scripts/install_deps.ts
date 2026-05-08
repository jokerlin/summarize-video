#!/usr/bin/env bun
// skills/video-summarizer/scripts/install_deps.ts
// Check + install required system tools for the video-summarizer skill.

import { run, which } from "../../../src/shell.ts";

const log = (s: string) => process.stdout.write(`${s}\n`);
const err = (s: string) => process.stderr.write(`${s}\n`);

async function ensureXcodeCli(): Promise<void> {
  if (process.platform !== "darwin") return;
  const r = await run("xcode-select", ["-p"]);
  if (r.exitCode !== 0) {
    err("  Xcode Command Line Tools not found.");
    err("  Install with: xcode-select --install");
    err("  (Required so `bun install` can build smart-whisper's N-API addon.)");
    process.exit(1);
  }
  log("  Xcode CLI Tools: OK");
}

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

async function ensureBunDeps(): Promise<void> {
  log("  Running `bun install` to make sure smart-whisper is fetched...");
  const r = await run("bun", ["install"], { cwd: process.cwd() });
  if (r.exitCode !== 0) {
    err(r.stderr);
    process.exit(1);
  }
  // Bun skips lifecycle scripts of untrusted deps. We declared smart-whisper
  // in `trustedDependencies` (package.json), so `bun install` should run its
  // node-gyp rebuild — but verify the .node file exists and rebuild if not.
  const pkgRoot = `${process.cwd()}/node_modules/smart-whisper`;
  const nodeAddon = `${pkgRoot}/build/Release/smart-whisper.node`;
  if (await Bun.file(nodeAddon).exists()) {
    log("  smart-whisper native addon: OK");
    return;
  }
  log("  Building smart-whisper native addon (node-gyp rebuild)...");
  const env: Record<string, string> = {};
  if (process.platform === "darwin") env.WHISPER_COREML = "1";
  const build = await run("npx", ["node-gyp", "rebuild"], { cwd: pkgRoot, env });
  if (build.exitCode !== 0) {
    err(`  node-gyp rebuild failed:\n${build.stderr.slice(-1500)}`);
    process.exit(1);
  }
  if (!(await Bun.file(nodeAddon).exists())) {
    err("  Error: build succeeded but smart-whisper.node still missing.");
    process.exit(1);
  }
  log("  smart-whisper native addon built.");
}

async function main(): Promise<void> {
  log("==========================================");
  log("Video Summarizer (TS) - Dependency Check");
  log("==========================================");
  log("");
  log("[1/5] Xcode Command Line Tools (macOS only)");
  await ensureXcodeCli();
  log("");
  log("[2/5] ffmpeg / ffprobe");
  await ensureFfmpeg();
  if (!(await which("ffprobe"))) {
    err("  Error: ffprobe missing (should ship with ffmpeg).");
    process.exit(1);
  }
  log("  ffprobe: OK");
  log("");
  log("[3/5] yt-dlp");
  await ensureYtDlp();
  log("");
  log("[4/5] Bun JS deps (smart-whisper)");
  await ensureBunDeps();
  log("");
  log("[5/5] All dependencies present.");
  log("");
  log("Versions:");
  for (const [name, args] of [
    ["bun", ["--version"]] as const,
    ["ffmpeg", ["-version"]] as const,
    ["yt-dlp", ["--version"]] as const,
  ]) {
    const r = await run(name, [...args]);
    log(`  ${name}: ${r.stdout.trim().split("\n")[0]}`);
  }
}

if (import.meta.main) {
  main().catch((e) => {
    err(`Fatal: ${(e as Error).message}`);
    process.exit(1);
  });
}
