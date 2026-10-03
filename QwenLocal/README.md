# Qwen Local — Qwen3.8-Flash-Next for local coding (Windows)

One-click installer + control panel that sets up **Qwen3.8-Flash-Next** (Unsloth GGUF)
on **llama.cpp** and exposes it as a local OpenAI/Anthropic-compatible API for coding tools.
Default install location: **`S:\QwenLocal`**.

## Install

1. Download `dist/QwenLocal-Setup.zip`, right-click → *Extract All* (anywhere).
2. Double-click **`QwenLocal.bat`** → the *Qwen Local* window opens.
3. Check the install folder (`S:\QwenLocal`), pick a quant (the window recommends one for your RAM),
   click **Install / Update**. A console window shows download progress.
   Downloads resume — close it any time and click *Install / Update* again.
4. Click **Start server**. When the status turns green, click **Open web chat** to test.
5. Click **Coding tools** to get ready-made configs.

After install, a **Qwen Local** shortcut is added to the Desktop and Start menu
(it runs `S:\QwenLocal\QwenLocal.bat`).

## Requirements

| Quant         | Download | RAM + VRAM needed |
|---------------|---------:|------------------:|
| UD-IQ1_M      | ~75 GB   | ~85 GB            |
| UD-Q2_K_XL    | ~79 GB   | ~90 GB  (96 GB PC) |
| UD-Q3_K_XL    | ~95 GB*  | ~110 GB           |
| UD-Q4_K_XL    | ~111 GB  | ~125–140 GB       |

\* estimate. Click **Check Hugging Face** for the real list and sizes.

- Windows 10 (1803+) / 11, free space on S: ≥ model size + a few GB.
- GPU optional. NVIDIA → CUDA build, AMD/Intel Arc → Vulkan, otherwise CPU. The model is MoE
  (6B active), so it runs on CPU+RAM; `--fit on` puts as much as fits on your GPU automatically.

## What goes where

```
S:\QwenLocal\
  QwenLocal.bat / .ps1   control panel
  config.json            your settings
  llama.cpp\             latest llama.cpp Windows build (llama-server.exe)
  models\<quant>\        GGUF files from unsloth/Qwen3.8-Flash-Next-GGUF
  start-server.bat       starts the server with the recommended settings
  tool-configs\          OpenCode / Continue / Aider / Claude Code / Cline setup
  install.log
```

## Using it for coding

Endpoint (while the server runs): `http://127.0.0.1:8080/v1`, model `qwen3.8-flash-next`, any API key.

- **Cline / Roo Code** (VS Code): provider *OpenAI Compatible*, base URL above, model id `qwen3.8-flash-next`.
- **Continue**: merge `tool-configs\continue-config.yaml` into `%USERPROFILE%\.continue\config.yaml`.
- **OpenCode**: copy `tool-configs\opencode.json` into your project root.
- **Aider**: run `tool-configs\aider-local.bat` inside your project.
- **Claude Code**: run `tool-configs\claude-code-local.bat` inside your project (uses llama-server's Anthropic-compatible endpoint).

## Server settings

Uses Qwen/Unsloth's recommended sampling (`--temp 1.0 --top-p 0.95 --top-k 20 --min-p 0`),
`--jinja`, flash attention and `--fit on`. Context size (32K–262K) and port are set in the window;
anything else can go in *Extra server args* (e.g. `--threads 16`).

## Command line

```
QwenLocal.bat -Action Install    # install / resume download
QwenLocal.bat -Action Start      # start server
QwenLocal.bat -Action Stop       # stop server
QwenLocal.bat -Action Tools      # regenerate tool-configs
```

## Troubleshooting

- **"Drive not found"** — S: doesn't exist on this PC; pick another folder with *Browse...*.
- **Download fails / 401 / rate limited** — paste a Hugging Face token into *HF token*.
- **Very slow (< 2 tok/s)** — model doesn't fit in RAM and is paging from disk; use a smaller quant or a smaller context.
- **CUDA errors** — update your NVIDIA driver, or set backend to *Vulkan*/*CPU* and click *Install / Update*.

Rebuild the zip: `./build-zip.sh`
