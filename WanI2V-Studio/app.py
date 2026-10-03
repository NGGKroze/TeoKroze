"""Wan I2V Studio - upload an image, describe the motion, get a video.

Runs a headless ComfyUI backend (Wan 2.2 A14B image-to-video) and serves a
simple Gradio front end on top of it.
"""

import argparse
import json
import os
import random
import shlex
import shutil
import subprocess
import sys
import threading
import time
import uuid
from pathlib import Path

import gradio as gr
import requests
import websocket
from PIL import Image, ImageOps

import workflow as wf

APP_DIR = Path(__file__).resolve().parent
COMFY_DIR = APP_DIR / "ComfyUI"
INPUT_DIR = COMFY_DIR / "input"
OUTPUT_DIR = COMFY_DIR / "output"
LORA_DIR = COMFY_DIR / "models" / "loras"

COMFY_HOST = "127.0.0.1"
COMFY_PORT = int(os.environ.get("COMFY_PORT", "8188"))
COMFY_URL = f"http://{COMFY_HOST}:{COMFY_PORT}"

RESOLUTIONS = {
    "Auto (480p, keep image aspect)": None,
    "832 x 480 (landscape)": (832, 480),
    "480 x 832 (portrait)": (480, 832),
    "624 x 624 (square)": (624, 624),
    "960 x 544 (~540p, slower)": (960, 544),
    "544 x 960 (~540p portrait, slower)": (544, 960),
}

MODES = {
    # name: (steps, cfg, shift, use lightning loras)
    "Fast (4-step Lightning)": (4, 1.0, 5.0, True),
    "Quality (20 steps, more motion, ~5x slower)": (20, 3.5, 8.0, False),
}

_comfy_proc: subprocess.Popen | None = None


# --------------------------------------------------------------------------
# ComfyUI backend
# --------------------------------------------------------------------------

def comfy_alive() -> bool:
    try:
        return requests.get(f"{COMFY_URL}/system_stats", timeout=2).ok
    except requests.RequestException:
        return False


def start_comfy(extra_args: list[str]) -> None:
    global _comfy_proc
    if comfy_alive():
        print(f"[studio] Using already running ComfyUI at {COMFY_URL}")
        return
    if not (COMFY_DIR / "main.py").exists():
        sys.exit("[studio] ComfyUI not found. Run install.bat / install.sh first.")

    cmd = [sys.executable, "main.py", "--listen", COMFY_HOST, "--port", str(COMFY_PORT),
           "--disable-auto-launch", *extra_args]
    print("[studio] Starting ComfyUI:", " ".join(cmd))
    log = open(APP_DIR / "comfyui.log", "w", encoding="utf-8", errors="replace")
    _comfy_proc = subprocess.Popen(cmd, cwd=COMFY_DIR, stdout=log, stderr=subprocess.STDOUT)

    for _ in range(300):
        if _comfy_proc.poll() is not None:
            sys.exit(f"[studio] ComfyUI exited early, see {APP_DIR / 'comfyui.log'}")
        if comfy_alive():
            print("[studio] ComfyUI is ready.")
            return
        time.sleep(1)
    sys.exit("[studio] ComfyUI did not start within 5 minutes, see comfyui.log")


def stop_comfy() -> None:
    if _comfy_proc and _comfy_proc.poll() is None:
        _comfy_proc.terminate()
        try:
            _comfy_proc.wait(15)
        except subprocess.TimeoutExpired:
            _comfy_proc.kill()


def missing_models() -> list[str]:
    folders = {
        "unet_high": "diffusion_models", "unet_low": "diffusion_models",
        "lightning_high": "loras", "lightning_low": "loras",
        "text_encoder": "text_encoders", "vae": "vae",
        "interpolation": "frame_interpolation",
    }
    out = []
    for key, name in wf.MODELS.items():
        if not (COMFY_DIR / "models" / folders[key] / name).is_file():
            out.append(f"{folders[key]}/{name}")
    return out


def list_user_loras() -> list[str]:
    builtin = {wf.MODELS["lightning_high"], wf.MODELS["lightning_low"]}
    if not LORA_DIR.exists():
        return []
    files = []
    for p in LORA_DIR.rglob("*"):
        if p.suffix.lower() in (".safetensors", ".pt", ".ckpt") and p.name not in builtin:
            files.append(p.relative_to(LORA_DIR).as_posix())
    return sorted(files, key=str.lower)


# --------------------------------------------------------------------------
# Generation
# --------------------------------------------------------------------------

def prepare_image(path: str) -> tuple[str, int, int]:
    img = ImageOps.exif_transpose(Image.open(path)).convert("RGB")
    name = f"studio_{uuid.uuid4().hex[:12]}.png"
    INPUT_DIR.mkdir(parents=True, exist_ok=True)
    img.save(INPUT_DIR / name)
    return name, img.width, img.height


def fmt_time(s: float) -> str:
    m, s = divmod(int(s), 60)
    return f"{m}m {s:02d}s" if m else f"{s}s"


def run_job(graph: dict, on_status) -> dict:
    """Queue a graph and block until done. Returns the history entry."""
    client_id = uuid.uuid4().hex
    ws = websocket.WebSocket()
    ws.connect(f"ws://{COMFY_HOST}:{COMFY_PORT}/ws?clientId={client_id}", timeout=30)
    ws.settimeout(5)
    try:
        r = requests.post(f"{COMFY_URL}/prompt", json={"prompt": graph, "client_id": client_id}, timeout=30)
        if not r.ok:
            raise gr.Error(f"ComfyUI rejected the job: {r.text[:800]}")
        prompt_id = r.json()["prompt_id"]

        node_types = {k: v["class_type"] for k, v in graph.items()}
        sampler_ids = [k for k, t in node_types.items() if t == "KSamplerAdvanced"]
        current = None
        while True:
            try:
                raw = ws.recv()
            except websocket.WebSocketTimeoutException:
                raw = None
            if raw is None or isinstance(raw, bytes):
                # binary frames are latent previews; also poll history as a fallback
                hist = requests.get(f"{COMFY_URL}/history/{prompt_id}", timeout=10).json()
                if prompt_id in hist and hist[prompt_id].get("status", {}).get("completed") is not None:
                    return hist[prompt_id]
                continue

            msg = json.loads(raw)
            data = msg.get("data", {})
            if data.get("prompt_id") not in (None, prompt_id):
                continue
            kind = msg.get("type")
            if kind == "executing":
                current = data.get("node")
                if current is None:
                    break
                on_status(describe_node(node_types.get(current, ""), current, sampler_ids))
            elif kind == "progress" and current is not None:
                on_status(describe_node(node_types.get(current, ""), current, sampler_ids)
                          + f" - step {data.get('value')}/{data.get('max')}")
            elif kind == "execution_error":
                raise gr.Error(f"{data.get('node_type')}: {data.get('exception_message', '')[:600]}")
            elif kind == "execution_interrupted":
                raise gr.Error("Generation cancelled.")
            elif kind == "execution_success":
                break
    finally:
        ws.close()

    for _ in range(30):
        hist = requests.get(f"{COMFY_URL}/history/{prompt_id}", timeout=10).json()
        if prompt_id in hist:
            return hist[prompt_id]
        time.sleep(1)
    raise gr.Error("Job finished but no result was recorded.")


def describe_node(class_type: str, node_id: str, sampler_ids: list[str]) -> str:
    if class_type == "KSamplerAdvanced":
        idx = sampler_ids.index(node_id)
        seg, expert = divmod(idx, 2)
        return f"Segment {seg + 1}/{len(sampler_ids) // 2}: {'high' if expert == 0 else 'low'}-noise pass"
    return {
        "UNETLoader": "Loading video model",
        "CLIPLoader": "Loading text encoder",
        "CLIPTextEncode": "Encoding prompt",
        "LoraLoaderModelOnly": "Applying LoRAs",
        "WanImageToVideo": "Encoding start frame",
        "VAEDecode": "Decoding frames",
        "FrameInterpolate": "Interpolating to 32 fps",
        "SaveVideo": "Saving video",
    }.get(class_type, "Working")


def generate(image, prompt, extend_prompt, seconds, resolution, mode, smooth, seed,
             negative, steps, cfg, shift, max_seg,
             l1h, l1l, l1s, l2h, l2l, l2s, l3h, l3l, l3s):
    if not image:
        raise gr.Error("Upload an image first.")
    if not prompt or not prompt.strip():
        raise gr.Error("Write a prompt describing what should happen.")
    missing = missing_models()
    if missing:
        raise gr.Error("Missing model files (run download_models): " + ", ".join(missing))

    image_name, iw, ih = prepare_image(image)
    width, height = RESOLUTIONS.get(resolution) or wf.fit_resolution(iw, ih)
    seed = int(seed)
    if seed < 0:
        seed = random.randint(0, 2**32 - 1)

    loras = []
    for h, l, s in ((l1h, l1l, l1s), (l2h, l2l, l2s), (l3h, l3l, l3s)):
        h = h if h and h != "None" else None
        l = l if l and l != "None" else None
        if h or l:
            loras.append(wf.UserLora(high=h, low=l, strength=float(s)))

    use_fast = MODES[mode][3]
    segments = wf.plan_segments(float(seconds), int(max_seg))
    job = wf.Job(
        image_name=image_name, prompt=prompt.strip(), extend_prompt=extend_prompt or "",
        negative=negative or wf.DEFAULT_NEGATIVE, width=width, height=height,
        segment_lengths=segments, seed=seed, fast=use_fast, steps=int(steps), cfg=float(cfg),
        shift=float(shift), loras=loras, interpolate=bool(smooth),
        filename_prefix=f"wan_i2v/{time.strftime('%Y%m%d_%H%M%S')}",
    )
    graph = wf.build(job)

    started = time.time()
    status = {"text": "Queued"}
    result: dict = {}

    def worker():
        try:
            result["hist"] = run_job(graph, lambda s: status.__setitem__("text", s))
        except Exception as e:  # surfaced in the UI below
            result["error"] = e

    t = threading.Thread(target=worker, daemon=True)
    t.start()
    header = (f"{width}x{height}, {len(segments)} segment(s) x {segments[0]} frames, "
              f"~{wf.output_seconds(segments):.1f}s, seed {seed}")
    while t.is_alive():
        yield None, f"**{status['text']}** · {fmt_time(time.time() - started)}\n\n{header}"
        time.sleep(1)

    if "error" in result:
        err = result["error"]
        raise err if isinstance(err, gr.Error) else gr.Error(str(err))

    video = None
    for out in result["hist"].get("outputs", {}).values():
        for item in out.get("images", []) + out.get("videos", []) + out.get("gifs", []):
            if item.get("filename", "").endswith((".mp4", ".webm", ".mkv")):
                video = OUTPUT_DIR / item.get("subfolder", "") / item["filename"]
    if video is None or not video.exists():
        raise gr.Error("Finished, but no video file was produced. Check comfyui.log.")

    meta = {"prompt": job.prompt, "extend_prompt": job.extend_prompt, "seed": seed,
            "width": width, "height": height, "segments": segments, "mode": mode,
            "loras": [vars(l) for l in loras], "smooth": job.interpolate}
    video.with_suffix(".json").write_text(json.dumps(meta, indent=2, ensure_ascii=False), encoding="utf-8")

    yield str(video), (f"**Done in {fmt_time(time.time() - started)}** · {header}\n\n"
                       f"Saved to `{video}`")


def cancel():
    try:
        requests.post(f"{COMFY_URL}/interrupt", timeout=5)
        requests.post(f"{COMFY_URL}/queue", json={"clear": True}, timeout=5)
    except requests.RequestException:
        pass
    return "Cancel requested."


def open_outputs():
    folder = OUTPUT_DIR / "wan_i2v"
    folder.mkdir(parents=True, exist_ok=True)
    if sys.platform == "win32":
        os.startfile(folder)  # noqa: S606
    elif sys.platform == "darwin":
        subprocess.Popen(["open", folder])
    elif shutil.which("xdg-open"):
        subprocess.Popen(["xdg-open", folder])
    return f"Outputs: `{folder}`"


def on_mode_change(mode):
    steps, cfg, shift, _ = MODES[mode]
    return steps, cfg, shift


# --------------------------------------------------------------------------
# UI
# --------------------------------------------------------------------------

def build_ui() -> gr.Blocks:
    loras = ["None"] + list_user_loras()
    first_mode = next(iter(MODES))

    with gr.Blocks(title="Wan I2V Studio") as ui:
        gr.Markdown("# Wan I2V Studio\nUpload an image, describe the motion, get a 480p video. "
                    "Runs fully local on Wan 2.2 A14B.")
        missing = missing_models()
        if missing:
            gr.Markdown("**Missing models:** " + ", ".join(missing)
                        + " — run `download_models.bat` / `download_models.sh`.")

        with gr.Row():
            with gr.Column(scale=1):
                image = gr.Image(label="Start image", type="filepath", height=360)
                prompt = gr.Textbox(label="Prompt - what should happen", lines=4,
                                    placeholder="She turns toward the camera and smiles, hair moving in the wind, "
                                                "slow cinematic dolly-in.")
                with gr.Row():
                    seconds = gr.Slider(2, 10, value=6, step=1, label="Length (seconds)")
                    resolution = gr.Dropdown(list(RESOLUTIONS), value=next(iter(RESOLUTIONS)),
                                             label="Resolution")
                with gr.Row():
                    mode = gr.Radio(list(MODES), value=first_mode, label="Mode")
                with gr.Row():
                    smooth = gr.Checkbox(value=True, label="Smooth 32 fps (FILM interpolation)")
                    seed = gr.Number(value=-1, precision=0, label="Seed (-1 = random)")

                with gr.Accordion("Continuation prompt (clips longer than one segment)", open=False):
                    extend_prompt = gr.Textbox(
                        label="Prompt for segments 2+ (empty = same prompt)", lines=3,
                        info="Clips over ~5 s are generated in segments, each continuing from the last frame.")

                with gr.Accordion("LoRAs (put files in ComfyUI/models/loras)", open=False):
                    gr.Markdown("Wan 2.2 LoRAs usually come as a **high-noise** + **low-noise** pair. "
                                "For a single-file (Wan 2.1 style) LoRA, pick it for both or only for low.")
                    lora_inputs = []
                    lora_dds = []
                    for i in range(3):
                        with gr.Row():
                            h = gr.Dropdown(loras, value="None", label=f"LoRA {i + 1} - high noise")
                            l = gr.Dropdown(loras, value="None", label=f"LoRA {i + 1} - low noise")
                            s = gr.Slider(0, 2, value=1.0, step=0.05, label="Strength")
                        lora_inputs += [h, l, s]
                        lora_dds += [h, l]
                    refresh = gr.Button("Refresh LoRA list", size="sm")

                with gr.Accordion("Advanced", open=False):
                    negative = gr.Textbox(value=wf.DEFAULT_NEGATIVE, label="Negative prompt", lines=3)
                    with gr.Row():
                        steps = gr.Slider(2, 40, value=MODES[first_mode][0], step=1, label="Steps")
                        cfg = gr.Slider(1, 8, value=MODES[first_mode][1], step=0.1, label="CFG")
                        shift = gr.Slider(1, 15, value=MODES[first_mode][2], step=0.5, label="Shift")
                    max_seg = gr.Slider(33, 121, value=81, step=4, label="Max frames per segment",
                                        info="81 (5 s) is what Wan was trained on. Higher = fewer seams "
                                             "but may loop/degrade and uses more VRAM.")

            with gr.Column(scale=1):
                video = gr.Video(label="Result", height=480, autoplay=True, loop=True)
                status = gr.Markdown("Idle.")
                with gr.Row():
                    go = gr.Button("Generate", variant="primary")
                    stop = gr.Button("Cancel")
                    folder = gr.Button("Open outputs folder")

        mode.change(on_mode_change, mode, [steps, cfg, shift])

        def refresh_loras():
            choices = ["None"] + list_user_loras()
            return [gr.update(choices=choices) for _ in lora_dds]

        refresh.click(refresh_loras, None, lora_dds)

        go.click(generate,
                 [image, prompt, extend_prompt, seconds, resolution, mode, smooth, seed,
                  negative, steps, cfg, shift, max_seg, *lora_inputs],
                 [video, status], concurrency_limit=1)
        stop.click(cancel, None, status)
        folder.click(open_outputs, None, status)
    return ui


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=int(os.environ.get("STUDIO_PORT", "7860")))
    ap.add_argument("--share", action="store_true", help="Create a public Gradio link")
    ap.add_argument("--no-browser", action="store_true")
    ap.add_argument("--comfy-args", default=os.environ.get("COMFY_ARGS", ""),
                    help='Extra ComfyUI flags, e.g. "--fast fp8_matrix_mult"')
    args = ap.parse_args()

    start_comfy(shlex.split(args.comfy_args, posix=(os.name != "nt")))
    try:
        build_ui().queue().launch(
            server_name="127.0.0.1", server_port=args.port, share=args.share,
            inbrowser=not args.no_browser, allowed_paths=[str(OUTPUT_DIR)],
            theme=gr.themes.Soft(),
        )
    finally:
        stop_comfy()


if __name__ == "__main__":
    main()
