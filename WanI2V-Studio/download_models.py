"""Download the model files (~37 GB) into ComfyUI/models. Resumable; re-run if interrupted.

Also downloads any LoRAs listed in loras.txt (Civitai or Hugging Face links).
"""

import os
import re
import sys
import time
from pathlib import Path
from urllib.parse import unquote, urlparse

import requests

APP_DIR = Path(__file__).resolve().parent
MODELS_DIR = APP_DIR / "ComfyUI" / "models"
LORA_DIR = MODELS_DIR / "loras"
LORA_LIST = APP_DIR / "loras.txt"
CIVITAI_TOKEN_FILE = APP_DIR / "civitai_token.txt"

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


def civitai_token() -> str:
    token = os.environ.get("CIVITAI_TOKEN", "").strip()
    if not token and CIVITAI_TOKEN_FILE.exists():
        token = CIVITAI_TOKEN_FILE.read_text(encoding="utf-8").strip()
    return token


def auth_headers(url: str) -> dict:
    """Only send each site its own token (requests drops it on cross-host redirects)."""
    host = urlparse(url).hostname or ""
    if host.endswith("huggingface.co") and os.environ.get("HF_TOKEN"):
        return {"Authorization": f"Bearer {os.environ['HF_TOKEN']}"}
    if host.endswith("civitai.com") and civitai_token():
        return {"Authorization": f"Bearer {civitai_token()}"}
    return {}


def normalize_url(url: str) -> str:
    """Turn a Civitai model page link into its API download link."""
    m = re.match(r"https?://(?:www\.)?civitai\.com/models/\d+[^?]*\?modelVersionId=(\d+)", url)
    if m:
        return f"https://civitai.com/api/download/models/{m.group(1)}"
    if re.match(r"https?://(?:www\.)?civitai\.com/models/\d+", url):
        raise ValueError("Civitai page link has no ?modelVersionId=... - open the exact version "
                         "(the high or low noise file) and copy its download link instead.")
    return url.replace("/blob/", "/resolve/") if "huggingface.co" in url else url


def remote_filename(url: str) -> str:
    """Ask the server for the file name (Content-Disposition), falling back to the URL path."""
    with requests.get(url, headers=auth_headers(url), stream=True, timeout=60, allow_redirects=True) as r:
        if r.status_code in (401, 403):
            raise PermissionError(f"{url} needs a login token (Civitai: put your API key in "
                                  f"{CIVITAI_TOKEN_FILE.name}; Hugging Face: set HF_TOKEN)")
        r.raise_for_status()
        cd = r.headers.get("Content-Disposition", "")
    m = re.search(r"filename\*=(?:UTF-8'')?([^;]+)", cd) or re.search(r'filename="?([^";]+)"?', cd)
    name = unquote(m.group(1).strip()) if m else unquote(urlparse(url).path.rsplit("/", 1)[-1])
    return Path(name).name  # never allow paths from the server


def download_lora(url: str, filename: str | None = None) -> Path:
    url = normalize_url(url.strip())
    name = Path(filename).name if filename else remote_filename(url)
    if not name.lower().endswith((".safetensors", ".pt", ".ckpt")):
        name += ".safetensors"
    dest = LORA_DIR / name
    download(url, dest)
    return dest


def read_lora_list() -> list[tuple[str, str | None]]:
    if not LORA_LIST.exists():
        return []
    items = []
    for line in LORA_LIST.read_text(encoding="utf-8").splitlines():
        line = line.split("#", 1)[0].strip()
        if not line:
            continue
        parts = line.split(maxsplit=1)
        items.append((parts[0], parts[1].strip() if len(parts) > 1 else None))
    return items


def download(url: str, dest: Path) -> None:
    headers = auth_headers(url)

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
        except requests.HTTPError as e:
            if e.response is not None and e.response.status_code in (401, 403, 404):
                raise RuntimeError(f"{url}: HTTP {e.response.status_code} (bad link or missing token)") from e
            print(f"\n  retry {attempt}/10 for {dest.name}: {e}")
            time.sleep(min(60, 2 ** attempt))
        except (requests.RequestException, IOError) as e:
            print(f"\n  retry {attempt}/10 for {dest.name}: {e}")
            time.sleep(min(60, 2 ** attempt))
    else:
        raise RuntimeError(f"Failed to download {url}")

    part.replace(dest)
    print(f"  done {dest.name}")


def main() -> None:
    print(f"Downloading models into {MODELS_DIR} (about 37 GB total)\n")
    for url, folder in FILES:
        try:
            download(url, MODELS_DIR / folder / url.rsplit("/", 1)[1])
        except RuntimeError as e:
            sys.exit(str(e))
    LORA_DIR.mkdir(parents=True, exist_ok=True)
    print("\nAll base models present.")

    loras = read_lora_list()
    if loras:
        print(f"\nDownloading {len(loras)} LoRA(s) from {LORA_LIST.name}")
    failed = []
    for url, name in loras:
        try:
            download_lora(url, name)
        except Exception as e:  # one bad link shouldn't stop the rest
            print(f"  FAILED {url}: {e}")
            failed.append(url)
    if failed:
        sys.exit(f"\n{len(failed)} LoRA download(s) failed - fix loras.txt and run again.")


if __name__ == "__main__":
    main()
