# Wan I2V Studio

Local image-to-video app. You upload an image, write what should happen, and get a 480p video between 2 and 10 seconds long. Everything runs on your own GPU, with no cloud and no content filter.

Tuned for an **RTX 5070 Ti (16 GB VRAM) with 64 GB RAM**. It should also run on other RTX 30/40/50 cards with 16 GB or more.

## Model

| | |
|---|---|
| Model | **Wan 2.2 I2V A14B** (Alibaba). Uses two 14B "experts" for high and low noise, stored as fp8 |
| License | **Apache 2.0**. Open weights, no safety filter or classifier anywhere in the pipeline |
| Speed-up | lightx2v **Lightning 4-step LoRAs** (Fast mode) |
| Smoothing | **FILM** frame interpolation, 16 fps to 32 fps |
| Backend | Headless [ComfyUI](https://github.com/comfyanonymous/ComfyUI), pinned to a tested revision |

Wan 2.2 is the most capable *fully open* video model for this purpose, and it has the largest community LoRA ecosystem (Civitai and similar sites), including NSFW LoRAs. The base model has no filter, but it has limited knowledge of explicit content. For that, add LoRAs (see below).

## Install (Windows)

1. Install the latest NVIDIA driver (RTX 50xx needs version 570 or newer).
2. Unzip this folder somewhere with **at least 60 GB free**, ideally on an NVMe SSD. Use a short path such as `D:\WanI2V`.
3. Double-click **`install.bat`**. It downloads:
   - a private Python 3.12 (through `uv`), so you don't need to install Python yourself
   - ComfyUI plus PyTorch built for CUDA 13.0, which supports Blackwell / sm_120
   - the models, about 37 GB. The download can resume: if it gets interrupted, run `install.bat` again.
4. Double-click **`run.bat`**. Your browser opens at http://127.0.0.1:7860.

On Linux, run `./install.sh` and then `./run.sh`.

## Usage

1. Drop in a start image.
2. Write a prompt describing **motion and camera**, not the scene. The image already sets the scene.
   Example: *"She slowly turns her head toward the camera and smiles, wind moving her hair, gentle handheld camera."*
3. Pick the length (2–10 s), the mode and the resolution, then click **Generate**.

Results are saved to `ComfyUI/output/wan_i2v/` as an `.mp4`, with a `.json` file next to it that records the prompt and seed. Use the same seed with the same settings to reproduce a clip.

### Modes

- **Fast (4-step Lightning)**: the default. Expect a few minutes for each 5 s segment on a 5070 Ti (this is an estimate, not a measurement). The first run is slower because the models have to load.
- **Quality (20 steps)**: stronger motion and better prompt following, but about 5× slower.

### Long clips (over 5 s)

Wan was trained on 81-frame clips (5 s at 16 fps). Longer videos are made in **segments**. Each new segment starts from the last frame of the previous one, and the segments are joined automatically. For example, 10 s is 2 × 81 frames. You can give later segments their own prompt under *Continuation prompt*, which lets you write a story such as "she stands up", then "she walks out of frame".

*Max frames per segment* (in Advanced) can go up to 121. That gives fewer seams, but motion is more likely to loop or degrade.

### LoRAs (styles, motions, NSFW concepts)

1. Download Wan 2.2 **I2V** LoRAs (for example from Civitai) and put them in `ComfyUI/models/loras/`. Subfolders are fine.
2. Wan 2.2 LoRAs usually come as a pair, `..._high_noise` and `..._low_noise`. Choose each file in the matching dropdown.
3. For a single-file LoRA (Wan 2.1 I2V style), select it for both slots, or only for *low noise*.
4. Click **Refresh LoRA list** after adding files. You can stack up to 3 LoRAs.

Many LoRAs need a trigger word in the prompt. Check the LoRA's model page.

## Performance notes (5070 Ti / 64 GB)

- Each 14B expert is about 14 GB in fp8. ComfyUI streams weights between RAM and VRAM as needed, and 64 GB of RAM keeps both experts plus the text encoder cached, so the second and later runs are much faster than the first.
- Keep the Windows page file on "System managed". Model loading can spike RAM briefly.
- Optional speed-up: edit `run.bat` and set `COMFY_ARGS=--fast fp8_matrix_mult`. This uses Blackwell's fp8 tensor cores and is often noticeably faster, with a slight change in output.
- If you run out of VRAM, close other GPU-heavy apps (browser hardware acceleration, games), lower *Max frames per segment*, or use 832×480 instead of the ~540p presets.
- The ComfyUI log is written to `comfyui.log` next to `app.py`.

## Files

```
install.bat / install.ps1 / install.sh   one-time setup
run.bat / run.sh                         start the app
download_models.(py|bat|sh)              (re)download or resume models
app.py                                   Gradio UI + ComfyUI process manager
workflow.py                              builds the Wan 2.2 graph (segments, LoRAs, interpolation)
```

Advanced users can also open ComfyUI's own UI at http://127.0.0.1:8188 while the app is running.

## Responsible use

This tool has no content filter, so **you** are responsible for what you make with it. Only animate images you have the rights to use. Never create sexual or intimate content of real people without their explicit consent, and never create any sexual content involving minors. Both are illegal in most countries.
