# Flux.1 Dev – генератор + Kontext редактор (ComfyUI), оптимизиран за RTX 5070 Ti 16GB

## Инсталация (Windows)
1. Разархивирай на диск с ~45 GB свободно място (пътят без кирилица/интервали).
2. Двоен клик на `install.bat` (или `install.bat -Gguf` за допълнителни Q8 GGUF модели, +25 GB).
   Сваля: uv + Python 3.12, ComfyUI, ComfyUI-GGUF, ComfyUI-Manager, PyTorch cu128, модели.
   Прекъснато сваляне се възобновява при повторно пускане.
3. `run.bat` -> http://127.0.0.1:8188
4. Workflow > Browse Templates > Flux: **Flux Dev** (генерация), **Flux Kontext Dev** (редакция на изображения).
   Файловите имена съвпадат с шаблоните.

Linux: `./install.sh` и `./run.sh`.

## Оптимизации за 5070 Ti
- **PyTorch cu128** – задължително за Blackwell (sm_120); по-стари билдове не работят.
- **fp8 модели** (~12 GB) + fp8 T5 (~5 GB): ComfyUI държи T5 в RAM и го разтоварва, моделът се побира в 16 GB. Препоръчани 32 GB RAM.
- `--fast fp16_accumulation fp8_matrix_mult`: по-бързи fp16/fp8 матрични операции на RTX 40/50. Ако даде артефакти/грешки, махни флаговете в `run.bat`.
- Q8_0 GGUF (`-Gguf`) – качество най-близо до fp16, малко по-бавно; в шаблона смени Load Diffusion Model с **Unet Loader (GGUF)**.
- Типични настройки: 1024x1024, 20–28 стъпки, euler/simple, guidance 3.5. Kontext: ~28 стъпки, guidance 2.5.
- Още ускорение (ръчно, по желание): **Nunchaku** (SVDQuant FP4 за Blackwell, ~2–3x по-бързо) и SageAttention – инсталират се през ComfyUI-Manager, зависят от версията на PyTorch.

## Лиценз
FLUX.1 [dev] и Kontext [dev] – non-commercial лиценз на Black Forest Labs. Файловете са от публични (не-gated) HF репота, не се иска токен.
