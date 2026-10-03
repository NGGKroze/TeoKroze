"""Download the model files (~37 GB) into ComfyUI/models. Resumable; re-run if interrupted."""

import os
import sys
import time
from pathlib import Path

import requests

MODELS_DIR = Path(__file__).resolve().parent / "ComfyUI" / "models"

WAN = "https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files"
FILES = [
    (f"{WAN}/diffusion_models/wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors", "diffusion_models"),
    (f"{WAN}/diffusion_models/wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors", "diffusion_models"),
    (f"{WAN}/loras/wan2.2_i2v_lightx2v_4steps_lora_v1_high_noise.safetensors", "loras"),
    (f"{WAN}/loras/wan2.2_i2v_lightx2v_4steps_lora_v1_low_noise.safetensors", "loras"),
    ("https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/"
     "text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors", "text_encoders"),
    (f"{WAN}/vae/wan_2.1_vae.safetensors", "vae"),
    ("https://huggingface.co/Comfy-Org/frame_interpolation/resolve/main/frame_interpolation/"
     "film_net_fp16.safetensors", "frame_interpolation"),
]


def human(n: float) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024:
            return f"{n:.1f} {unit}"
        n /= 1024
    return f"{n:.1f} TB"


def download(url: str, dest: Path) -> None:
    headers = {}
    if os.environ.get("HF_TOKEN"):
        headers["Authorization"] = f"Bearer {os.environ['HF_TOKEN']}"

    if dest.exists():
        print(f"  ok   {dest.name}")
        return
    part = dest.with_suffix(dest.suffix + ".part")
    dest.parent.mkdir(parents=True, exist_ok=True)

    for attempt in range(1, 11):
        have = part.stat().st_size if part.exists() else 0
        h = dict(headers)
        if have:
            h["Range"] = f"bytes={have}-"
        try:
            with requests.get(url, headers=h, stream=True, timeout=60, allow_redirects=True) as r:
                if r.status_code == 416:  # already complete
                    break
                r.raise_for_status()
                if have and r.status_code != 206:  # server ignored the range
                    have = 0
                total = have + int(r.headers.get("Content-Length", 0))
                mode = "ab" if have else "wb"
                done, t0, last = have, time.time(), 0.0
                with open(part, mode) as f:
                    for chunk in r.iter_content(chunk_size=8 * 1024 * 1024):
                        f.write(chunk)
                        done += len(chunk)
                        now = time.time()
                        if now - last > 1:
                            speed = (done - have) / max(now - t0, 1e-6)
                            pct = f"{100 * done / total:5.1f}%" if total else ""
                            print(f"\r  get  {dest.name}  {pct} {human(done)} / {human(total)}"
                                  f"  {human(speed)}/s     ", end="", flush=True)
                            last = now
            print()
            if total and part.stat().st_size < total:
                raise IOError("incomplete download")
            break
        except (requests.RequestException, IOError) as e:
            print(f"\n  retry {attempt}/10 for {dest.name}: {e}")
            time.sleep(min(60, 2 ** attempt))
    else:
        sys.exit(f"Failed to download {url}")

    part.replace(dest)
    print(f"  done {dest.name}")


def main() -> None:
    print(f"Downloading models into {MODELS_DIR} (about 37 GB total)\n")
    for url, folder in FILES:
        download(url, MODELS_DIR / folder / url.rsplit("/", 1)[1])
    (MODELS_DIR / "loras").mkdir(parents=True, exist_ok=True)
    print("\nAll models present.")


if __name__ == "__main__":
    main()
