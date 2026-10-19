"""LPS Engine - общи услуги за всички модули (PDF текст с координати, OCR).

Идея: един OCR/PDF слой за цялата програма. Python модулите го ползват като библиотека (import lps_engine),
а HTML модулите - през локалния HTTP сървис (runtime/engine), който обвивката пуска при нужда.
"""
from .ocr import ocr_available, ocr_image_bytes, tesseract_info
from .pdf import extract_pdf

__all__ = ["ocr_available", "ocr_image_bytes", "tesseract_info", "extract_pdf"]
__version__ = "1.0"
