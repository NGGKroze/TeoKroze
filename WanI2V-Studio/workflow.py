"""Builds ComfyUI API-format graphs for Wan 2.2 A14B image-to-video.

Long clips are produced by chaining segments: every segment after the first
starts from the last decoded frame of the previous one, and the duplicated
start frame is dropped before the segments are concatenated.
"""

from dataclasses import dataclass, field

MODELS = {
    "unet_high": "wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors",
    "unet_low": "wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors",
    "lightning_high": "wan2.2_i2v_lightx2v_4steps_lora_v1_high_noise.safetensors",
    "lightning_low": "wan2.2_i2v_lightx2v_4steps_lora_v1_low_noise.safetensors",
    "text_encoder": "umt5_xxl_fp8_e4m3fn_scaled.safetensors",
    "vae": "wan_2.1_vae.safetensors",
    "interpolation": "film_net_fp16.safetensors",
}

# Wan's own recommended negative prompt (Chinese), plus a short English tail.
DEFAULT_NEGATIVE = (
    "色调艳丽，过曝，静态，细节模糊不清，字幕，风格，作品，画作，画面，静止，整体发灰，最差质量，低质量，"
    "JPEG压缩残留，丑陋的，残缺的，多余的手指，画得不好的手部，画得不好的脸部，畸形的，毁容的，形态畸形的肢体，"
    "手指融合，静止不动的画面，杂乱的背景，三条腿，背景人很多，倒着走, "
    "blurry, low quality, static, watermark, text, deformed, extra limbs"
)

BASE_FPS = 16  # Wan 2.2 A14B native frame rate


@dataclass
class UserLora:
    high: str | None  # applied to the high-noise expert
    low: str | None   # applied to the low-noise expert
    strength: float = 1.0


@dataclass
class Job:
    image_name: str           # file name inside ComfyUI's input folder
    prompt: str
    width: int
    height: int
    segment_lengths: list[int]  # frames per segment, each 4k+1
    seed: int
    negative: str = DEFAULT_NEGATIVE
    extend_prompt: str = ""   # prompt for segments 2+, falls back to prompt
    fast: bool = True         # Lightning 4-step LoRAs
    steps: int = 4
    cfg: float = 1.0
    shift: float = 5.0
    loras: list[UserLora] = field(default_factory=list)
    interpolate: bool = True  # FILM x2 -> 32 fps
    filename_prefix: str = "wan_i2v/clip"


def plan_segments(seconds: float, max_segment_frames: int = 81) -> list[int]:
    """Split a duration into Wan-friendly segment lengths (each 4k+1 frames).

    The first segment contributes all its frames; later segments repeat the
    previous last frame, so they contribute length-1 new frames.
    """
    max_segment_frames = max(17, ((max_segment_frames - 1) // 4) * 4 + 1)
    new_frames = max(16, round(seconds * BASE_FPS))  # frames after the first one
    per_seg = max_segment_frames - 1
    n = -(-new_frames // per_seg)  # ceil
    each = -(-new_frames // n)
    each = -(-each // 4) * 4  # round up to a multiple of 4
    return [each + 1] * n


def output_seconds(segment_lengths: list[int]) -> float:
    frames = segment_lengths[0] + sum(l - 1 for l in segment_lengths[1:])
    return (frames - 1) / BASE_FPS


def fit_resolution(img_w: int, img_h: int, target_area: int = 832 * 480) -> tuple[int, int]:
    """Keep the image aspect ratio at roughly 480p area, multiples of 16."""
    aspect = img_w / img_h
    h = (target_area / aspect) ** 0.5
    w = h * aspect
    w = max(256, min(1280, int(round(w / 16)) * 16))
    h = max(256, min(1280, int(round(h / 16)) * 16))
    return w, h


def build(job: Job) -> dict:
    g: dict[str, dict] = {}
    counter = [0]

    def node(class_type: str, **inputs) -> str:
        counter[0] += 1
        nid = str(counter[0])
        g[nid] = {"class_type": class_type, "inputs": inputs}
        return nid

    # --- models -----------------------------------------------------------
    high = [node("UNETLoader", unet_name=MODELS["unet_high"], weight_dtype="default"), 0]
    low = [node("UNETLoader", unet_name=MODELS["unet_low"], weight_dtype="default"), 0]

    for lora in job.loras:
        if lora.high:
            high = [node("LoraLoaderModelOnly", model=high, lora_name=lora.high,
                         strength_model=lora.strength), 0]
        if lora.low:
            low = [node("LoraLoaderModelOnly", model=low, lora_name=lora.low,
                        strength_model=lora.strength), 0]

    if job.fast:
        high = [node("LoraLoaderModelOnly", model=high, lora_name=MODELS["lightning_high"],
                     strength_model=1.0), 0]
        low = [node("LoraLoaderModelOnly", model=low, lora_name=MODELS["lightning_low"],
                    strength_model=1.0), 0]

    high = [node("ModelSamplingSD3", model=high, shift=job.shift), 0]
    low = [node("ModelSamplingSD3", model=low, shift=job.shift), 0]

    clip = [node("CLIPLoader", clip_name=MODELS["text_encoder"], type="wan", device="default"), 0]
    vae = [node("VAELoader", vae_name=MODELS["vae"]), 0]

    pos_first = [node("CLIPTextEncode", clip=clip, text=job.prompt), 0]
    extend_text = job.extend_prompt.strip()
    pos_extend = [node("CLIPTextEncode", clip=clip, text=extend_text), 0] if extend_text else pos_first
    neg = [node("CLIPTextEncode", clip=clip, text=job.negative), 0]

    image = [node("LoadImage", image=job.image_name), 0]

    # --- segments -----------------------------------------------------------
    split = max(1, job.steps // 2)  # high-noise expert does the first half
    frames = None
    prev_decoded = None
    for i, length in enumerate(job.segment_lengths):
        if i == 0:
            start = image
        else:
            start = [node("ImageFromBatch", image=prev_decoded, batch_index=-1, length=1), 0]

        i2v = node("WanImageToVideo",
                   positive=pos_first if i == 0 else pos_extend, negative=neg, vae=vae,
                   width=job.width, height=job.height, length=length, batch_size=1,
                   start_image=start)
        seed = (job.seed + i * 1000003) % (2**63)
        latent = [node("KSamplerAdvanced", model=high, add_noise="enable", noise_seed=seed,
                       steps=job.steps, cfg=job.cfg, sampler_name="euler", scheduler="simple",
                       positive=[i2v, 0], negative=[i2v, 1], latent_image=[i2v, 2],
                       start_at_step=0, end_at_step=split,
                       return_with_leftover_noise="enable"), 0]
        latent = [node("KSamplerAdvanced", model=low, add_noise="disable", noise_seed=seed,
                       steps=job.steps, cfg=job.cfg, sampler_name="euler", scheduler="simple",
                       positive=[i2v, 0], negative=[i2v, 1], latent_image=latent,
                       start_at_step=split, end_at_step=10000,
                       return_with_leftover_noise="disable"), 0]
        decoded = [node("VAEDecode", samples=latent, vae=vae), 0]
        prev_decoded = decoded

        if frames is None:
            frames = decoded
        else:
            new = [node("ImageFromBatch", image=decoded, batch_index=1, length=4096), 0]
            frames = [node("ImageBatch", image1=frames, image2=new), 0]

    fps = BASE_FPS
    if job.interpolate:
        interp = [node("FrameInterpolationModelLoader", model_name=MODELS["interpolation"]), 0]
        frames = [node("FrameInterpolate", interp_model=interp, images=frames, multiplier=2), 0]
        fps = BASE_FPS * 2

    video = [node("CreateVideo", images=frames, fps=float(fps)), 0]
    node("SaveVideo", video=video, filename_prefix=job.filename_prefix,
         format="mp4", **{"format.codec": "h264"})
    return g
