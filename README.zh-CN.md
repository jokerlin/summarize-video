<div align="center">

# 🎬 Video Summarizer

**下载任意视频，得到干净的字幕，把 Claude 写总结要的材料一次备齐。**

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Bun](https://img.shields.io/badge/Bun-≥1.1-fbf0df?logo=bun&logoColor=000)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-3178c6?logo=typescript&logoColor=fff)](https://www.typescriptlang.org/)
[![yt-dlp](https://img.shields.io/badge/yt--dlp-1800%2B%20sites-red)](https://github.com/yt-dlp/yt-dlp)
[![whisper.cpp](https://img.shields.io/badge/whisper.cpp-Metal-4b8bbe)](https://github.com/ggml-org/whisper.cpp)

[English](./README.md) · **简体中文**

</div>

---

一个小巧的命令行工具：从 1800+ 视频平台抓取音频，本地用 whisper.cpp 转写，把 Claude 写总结需要的材料打包好。它是一个 Claude Code skill，但单独跑 CLI 也完全够用。

## ✨ 特性

- **🌐 平台通吃** —— 凡是 `yt-dlp` 支持的都行：YouTube、Bilibili、Twitter / X、TikTok、Vimeo、Instagram、Twitch……
- **🔇 默认只下音频** —— 默认输出 `audio.mp3`；要 mp4 时再加 `--with-video`
- **📝 三级字幕策略** —— 官方字幕 → 自动字幕 → 本地 Whisper，依次回退
- **⚡ Apple Silicon 上很快** —— `whisper-cli` 跑在 Metal 上，相同模型下比 Python whisper CLI 快约 5–10 倍
- **🍪 自带 Cookie** —— 默认用 Chrome 的 cookie，YouTube 的人机校验不再挡路
- **📦 零胶水代码** —— 只有 Bun + TypeScript，没有构建步骤，也不用 Python venv

## 📦 安装

```bash
git clone https://github.com/jokerlin/summarize-video
cd summarize-video
bun install
bun run skills/video-summarizer/scripts/install_deps.ts
```

安装脚本会检查并安装 `ffmpeg`、`ffprobe`、`yt-dlp` 和 `whisper-cpp`（macOS 上走 Homebrew）。

## 🚀 使用

```bash
bun run summarize "https://www.youtube.com/watch?v=..."
```

### 常用参数

```bash
# 同时保留 mp4（默认只下音频）
bun run summarize "<URL>" --with-video

# 换一个 Whisper 模型（默认：base）
bun run summarize "<URL>" --model small

# 用 Firefox 的 cookie 而不是 Chrome
bun run summarize "<URL>" --cookies-from-browser firefox

# 完全禁用 cookie
bun run summarize "<URL>" --no-cookies
```

完整参数列表见 `bun run summarize --help`。

### 输出

```
./downloads/
└── <视频标题>/
    ├── audio.mp3         # 提取后的音频
    ├── subtitle.vtt      # 带时间戳的字幕
    ├── transcript.txt    # 纯文本转录
    ├── _metadata.json    # 标题 / 平台 / URL / 时长 / 字幕来源
    ├── summary.md        # skill 模式下由 Claude 生成
    └── video.mp4         # 仅当传了 --with-video
```

## 🎯 工作原理

1. **元数据** —— `yt-dlp --print` 拿到标题、时长、平台、语言
2. **音频** —— `yt-dlp -x --audio-format mp3` 提取出 `audio.mp3`
3. **视频**（可选）—— 传 `--with-video` 时下载 `bestvideo[≤1080p]+bestaudio` 并合成 `video.mp4`
4. **字幕** —— 三级回退：
   1. `yt-dlp --write-subs` —— 官方字幕（zh / en / zh-Hans / zh-Hant）
   2. `yt-dlp --write-auto-subs` —— 自动生成字幕（zh / en）
   3. `whisper-cli` —— 本地转写
5. **转录文本** —— `subtitle.vtt` 解析成不带时间戳的 `transcript.txt`
6. **总结** —— 作为 Claude Code skill 调用时由 Claude 写出；纯 CLI 只做 1–5 步

## 🤖 Whisper 模型

| 模型         | 大小     | 速度    | 质量        |
| ------------ | -------- | ------- | ----------- |
| tiny         | 39 MB    | 最快    | 基础        |
| **base**     | 74 MB    | 快      | **默认**    |
| small        | 244 MB   | 中等    | 较好        |
| medium       | 769 MB   | 慢      | 更好        |
| large-v3     | 1.5 GB   | 最慢    | 最好        |

首次使用时 GGML 模型会从 HuggingFace（`ggerganov/whisper.cpp`）自动下载到 `~/.cache/whisper-cpp/`。

## 🛠 技术栈

| 模块            | 选型                                         |
| --------------- | -------------------------------------------- |
| 运行时          | Bun ≥ 1.1（TypeScript，无需编译）            |
| 下载            | yt-dlp                                       |
| 解复用 / 探测   | ffmpeg / ffprobe                             |
| 语音识别        | `whisper-cli`（whisper.cpp + Metal / CUDA）  |
| Lint / 格式化   | Biome                                        |

ASR 选型变迁：项目早期用过 `smart-whisper`（whisper.cpp 的 N-API 封装）做进程内并行推理，之后切到 `openai-whisper`（Python CLI）求稳定。最后两者都被 `whisper-cli` 取代 —— 它原生接受 mp3，开箱即用 Metal，相同模型下比 Python whisper CLI 快约 5–10 倍。

## 🧪 开发

```bash
bun test           # 单元测试
bun run typecheck  # tsc --noEmit
bun run lint       # biome check
bun run format     # biome format --write
```

端到端冒烟测试（YouTube / Bilibili / Twitter）的步骤见 [`test/MANUAL.md`](./test/MANUAL.md)。

## 📄 许可

[MIT](./LICENSE) © [jokerlin](https://github.com/jokerlin)

> 与 Anthropic 无关联。

## 🙏 致谢

- [yt-dlp](https://github.com/yt-dlp/yt-dlp) —— 通用视频下载器
- [ffmpeg](https://ffmpeg.org/) —— 音频提取与探测
- [whisper.cpp](https://github.com/ggml-org/whisper.cpp) —— 高速本地语音转写
