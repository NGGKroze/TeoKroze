"""Shared helpers: HTTP session, JSON I/O, title normalisation, money/number parsing."""
from __future__ import annotations

import datetime as dt
import json
import os
import re
import time
import unicodedata
from pathlib import Path
from typing import Any

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
CONFIG_DIR = ROOT / "config"

# Bulgaria joined the euro on 2026-01-01 at the fixed rate below.
BGN_PER_EUR = 1.95583
EURO_SWITCH = dt.date(2026, 1, 1)

USER_AGENT = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/126.0 Safari/537.36 kino-tracker/1.0"
)


def make_session() -> requests.Session:
    s = requests.Session()
    retry = Retry(total=4, backoff_factor=2, status_forcelist=(429, 500, 502, 503, 504))
    s.mount("https://", HTTPAdapter(max_retries=retry))
    s.mount("http://", HTTPAdapter(max_retries=retry))
    s.headers.update({"User-Agent": USER_AGENT, "Accept-Language": "bg,en;q=0.8"})
    return s


class Fetcher:
    """Polite HTTP fetcher with a per-request delay."""

    def __init__(self, delay: float | None = None):
        self.session = make_session()
        self.delay = float(os.environ.get("KINO_DELAY", delay if delay is not None else 1.0))
        self._last = 0.0

    def get(self, url: str, **kw) -> requests.Response:
        wait = self.delay - (time.time() - self._last)
        if wait > 0:
            time.sleep(wait)
        kw.setdefault("timeout", 40)
        r = self.session.get(url, **kw)
        self._last = time.time()
        r.raise_for_status()
        return r


def load_json(path: Path, default: Any) -> Any:
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def save_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1, sort_keys=False)
        f.write("\n")
    tmp.replace(path)


def now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()


# ---------------------------------------------------------------- titles

_CYR = dict(zip(
    "абвгдежзийклмнопрстуфхцчшщъьюя",
    ["a", "b", "v", "g", "d", "e", "zh", "z", "i", "y", "k", "l", "m", "n", "o", "p", "r",
     "s", "t", "u", "f", "h", "ts", "ch", "sh", "sht", "a", "", "yu", "ya"],
))

_NOISE = re.compile(
    r"\b(bg\s*audio|бг\s*аудио|бг\s*дублаж|бг\s*субтитри|2d|3d|4dx|imax|screenx|dolby|atmos|vip|"
    r"dubbed|dub|subs?|субтитри|дублаж|аудио|бг|предпремиера|премиера|premiere|preview|re-?release)\b",
    re.I,
)


def translit(s: str) -> str:
    return "".join(_CYR.get(ch, ch) for ch in s.lower())


def title_key(title: str) -> str:
    """Language-agnostic-ish key used to match the same film across sources."""
    t = unicodedata.normalize("NFKC", title or "").lower()
    t = re.sub(r"\(([^)]*)\)", lambda m: "" if re.search(r"\d{4}|2d|3d|imax|дубл|субт|dub|sub", m.group(1), re.I) else m.group(0), t)
    t = _NOISE.sub(" ", t)
    t = t.replace("&", " and ")
    t = translit(t)
    t = unicodedata.normalize("NFKD", t)
    t = "".join(ch for ch in t if not unicodedata.combining(ch))
    t = re.sub(r"[^a-z0-9]+", " ", t)
    t = re.sub(r"^(the|a|an)\s+", "", t.strip())
    return re.sub(r"\s+", "-", t).strip("-")


def clean_title(title: str) -> str:
    t = re.sub(r"\s+", " ", title or "").strip(" -–—|:*•\t")
    return t


# ---------------------------------------------------------------- numbers

_NUM = re.compile(r"(?<![\w.])(\d{1,3}(?:[ ,.  ]\d{3})+|\d+(?:[.,]\d+)?)\s*([kmкмхил]{0,3}\.?)", re.I)


def parse_number(raw: str) -> float | None:
    """Parse '1,234,567', '1 234 567', '1.2M', '850K', '12,5 хил.', '3.4 млн'."""
    if raw is None:
        return None
    s = str(raw).strip().lower().replace(" ", " ").replace(" ", " ")
    s = re.sub(r"[€$£]|лв\.?|bgn|eur|usd", "", s).strip()
    mult = 1.0
    m = re.search(r"(m|mil|млн\.?|million)$", s)
    if m:
        mult, s = 1e6, s[: m.start()].strip()
    else:
        m = re.search(r"(k|хил\.?|thousand)$", s)
        if m:
            mult, s = 1e3, s[: m.start()].strip()
    s = s.strip(" +")
    if not s or not re.search(r"\d", s):
        return None
    if re.fullmatch(r"\d{1,3}([ ,.]\d{3})+", s):
        s = re.sub(r"[ ,.]", "", s)
    elif re.fullmatch(r"\d+[.,]\d+", s):
        s = s.replace(",", ".")
    else:
        s = re.sub(r"[ ,]", "", s)
    try:
        return float(s) * mult
    except ValueError:
        return None


def to_eur(amount: float | None, currency: str | None) -> float | None:
    if amount is None:
        return None
    c = (currency or "").upper()
    if c == "BGN":
        return round(amount / BGN_PER_EUR, 2)
    if c == "EUR":
        return round(amount, 2)
    return None


def default_currency(day: dt.date | None) -> str:
    return "EUR" if day and day >= EURO_SWITCH else "BGN"


def weekend_end_for(day: dt.date) -> dt.date:
    """The Sunday of the most recent weekend at or before `day`.

    Posts written Mon-Thu refer to the previous weekend; posts on Fri-Sun
    usually carry estimates for the current one.
    """
    wd = day.weekday()  # Mon=0 .. Sun=6
    if wd >= 4:
        return day + dt.timedelta(days=6 - wd)
    return day - dt.timedelta(days=wd + 1)
