"""Turn free-form box office charts (forum posts, NFC tables) into structured entries."""
from __future__ import annotations

import re
from typing import Iterable

from .common import clean_title, parse_number, title_key

NUM_RE = r"(?:\d{1,3}(?:[ ,.  ]\d{3})+|\d+(?:[.,]\d+)?)(?:\s*(?:[kmкм]\b|mil\b|млн\.?|хил\.?))?"
CUR_BEFORE = r"(?P<cb>€|\$|eur\b|bgn\b|лв\.?|usd\b)"
CUR_AFTER = r"(?P<ca>€|\$|eur\b|bgn\b|лв\.?|лева|евро|usd\b)"
ADM_WORDS = r"(?:adm(?:issions?|its?)?\.?|admits|зрители|зр\.|зрит\.|viewers|tickets|билета|посещения)"

MONEY_RE = re.compile(
    rf"{CUR_BEFORE}\s*(?P<n1>{NUM_RE})|(?P<n2>{NUM_RE})\s*{CUR_AFTER}", re.I
)
ADM_RE = re.compile(
    rf"(?P<n1>{NUM_RE})\s*{ADM_WORDS}|{ADM_WORDS}\s*[:=]?\s*(?P<n2>{NUM_RE})", re.I
)
PCT_RE = re.compile(r"\(?\s*([+\-−–]?\s*\d+(?:[.,]\d+)?)\s*%\s*\)?")
WEEK_RE = re.compile(
    r"\b(?:w|wk|week|wknd|седм\.?|седмица)\s*#?\s*(\d{1,2})\b|\b(\d{1,2})(?:st|nd|rd|th|-?(?:ва|ра|ма|та))\s*(?:week|weekend|седмица|уикенд)",
    re.I,
)
TOTAL_SPLIT = re.compile(
    r"\b(?:total|tot\.?|cume|cumulative|running|overall|общо|всичко|до момента|от премиерата)\b|\(\s*(?=[€$]?\s*\d[\d ,.]*\s*(?:[kmкм]|млн|хил)?\s*[€$]?\s*(?:total|cume|общо))",
    re.I,
)
RANK_RE = re.compile(r"^\s*(?:#\s*)?(\d{1,2})\s*(?:[.)\]:\-–]\s*|\s+)(?=\S)(.*)$")
TITLE_END = re.compile(
    rf"\s+[-–—|/]\s+|\s*\||\t|\s{{2,}}|\s*[€$]\s*\d|\s+\(?[+\-−]?\d+(?:[.,]\d+)?\s*%|\s+\(?(?:{NUM_RE})\s*(?:[€$]|eur\b|bgn\b|лв|{ADM_WORDS})|\s*:\s+(?=[€$]?\s*\d)|\s+\(?(?:\d{{1,3}}(?:[ ,.]\d{{3}})+)\b",
    re.I,
)
NEW_RE = re.compile(r"\b(new|нов|премиера|debut|opening)\b", re.I)


def _num(m: re.Match) -> float | None:
    return parse_number(m.group("n1") or m.group("n2"))


def _currency(m: re.Match, fallback: str) -> str:
    c = (m.groupdict().get("cb") or m.groupdict().get("ca") or "").lower()
    if c in ("€", "eur", "евро"):
        return "EUR"
    if c in ("$", "usd"):
        return "USD"
    if c.startswith("лв") or c in ("bgn", "лева"):
        return "BGN"
    return fallback


def _segment_values(seg: str, currency: str, hint: str | None) -> dict:
    out: dict = {}
    taken: list[tuple[int, int]] = []
    for m in MONEY_RE.finditer(seg):
        v = _num(m)
        if v is not None and "gross" not in out:
            out["gross"], out["currency"] = v, _currency(m, currency)
        taken.append(m.span())
    for m in ADM_RE.finditer(seg):
        if any(a <= m.start() < b for a, b in taken):
            continue
        v = _num(m)
        if v is not None and "adm" not in out:
            out["adm"] = v
        taken.append(m.span())
    if hint and hint not in out:
        # unlabelled numbers: use the post-level hint (e.g. "Admissions:" charts)
        scrub = PCT_RE.sub(" ", WEEK_RE.sub(" ", seg))
        for a, b in sorted(taken, reverse=True):
            scrub = scrub[:a] + " " * (b - a) + scrub[b:]
        for m in re.finditer(NUM_RE, scrub, re.I):
            v = parse_number(m.group(0))
            if v is not None and v >= 10:
                out[hint] = v
                if hint == "gross":
                    out.setdefault("currency", currency)
                break
    return out


def chart_hint(text: str) -> str | None:
    has_adm = bool(re.search(ADM_WORDS, text, re.I))
    has_money = bool(re.search(r"[€$]|\b(?:eur|bgn|usd)\b|лв|лева|евро|gross|приходи", text, re.I))
    if has_adm and not has_money:
        return "adm"
    if has_money and not has_adm:
        return "gross"
    return None


def parse_line(line: str, currency: str, hint: str | None = None) -> dict | None:
    m = RANK_RE.match(line)
    if not m:
        return None
    rank, rest = int(m.group(1)), m.group(2).strip()
    if rank == 0 or rank > 40:
        return None
    rest = re.sub(r"^[*_~]+|[*_~]+$", "", rest)
    tm = TITLE_END.search(rest)
    title = rest[: tm.start()] if tm else rest
    tail = rest[tm.start():] if tm else ""
    title = re.sub(r"\(\s*(?:new|нов)\s*\)", "", title, flags=re.I)
    title = re.sub(r"\b(?:NEW|НОВ)\b", "", title)
    title = clean_title(title)
    if not title or not re.search(r"[A-Za-zА-Яа-я]", title) or len(title) > 120:
        return None
    entry: dict = {"rank": rank, "title": title, "key": title_key(title)}
    if NEW_RE.search(tail) or re.search(r"\(\s*new\s*\)|\bNEW\b", rest):
        entry["new"] = True
    wk = WEEK_RE.search(tail)
    if wk:
        entry["week"] = int(wk.group(1) or wk.group(2))
    pc = PCT_RE.search(tail)
    if pc:
        try:
            entry["change_pct"] = float(pc.group(1).replace(" ", "").replace("−", "-").replace("–", "-").replace(",", "."))
        except ValueError:
            pass
    parts = TOTAL_SPLIT.split(tail, maxsplit=1)
    wkd = _segment_values(parts[0], currency, hint)
    tot = _segment_values(parts[1], currency, hint) if len(parts) > 1 else {}
    if "gross" in wkd:
        entry["weekend_gross"] = wkd["gross"]
    if "adm" in wkd:
        entry["weekend_adm"] = wkd["adm"]
    if "gross" in tot:
        entry["total_gross"] = tot["gross"]
    if "adm" in tot:
        entry["total_adm"] = tot["adm"]
    entry["currency"] = wkd.get("currency") or tot.get("currency") or currency
    return entry


def parse_text_chart(text: str, currency: str) -> list[dict]:
    """Extract ranked lines (1. Title ... numbers) from a block of text."""
    hint = chart_hint(text)
    entries: list[dict] = []
    seen_ranks: set[int] = set()
    for raw in text.splitlines():
        line = raw.strip()
        if not line:
            continue
        e = parse_line(line, currency, hint)
        if not e:
            continue
        # a new "1." after we already have a chart means a second chart (e.g. last year's) – stop
        if e["rank"] in seen_ranks:
            if len(entries) >= 3:
                break
            entries, seen_ranks = [], set()
        seen_ranks.add(e["rank"])
        entries.append(e)
    return entries if len(entries) >= 3 else []


# ---------------------------------------------------------------- tables

HEADER_MAP: list[tuple[str, re.Pattern]] = [
    ("rank", re.compile(r"^(№|no\.?|#|място|rank|поз|pos)", re.I)),
    ("original_title", re.compile(r"оригинал|original", re.I)),
    ("title", re.compile(r"филм|заглавие|title|movie|наименование", re.I)),
    ("distributor", re.compile(r"разпростр|дистриб|distrib", re.I)),
    ("country", re.compile(r"държава|страна|country|произх", re.I)),
    ("release", re.compile(r"премиера|release|дата", re.I)),
    ("weeks", re.compile(r"седмиц|седм\.|weeks?|wks", re.I)),
    ("screens", re.compile(r"екран|кина|screens|cinemas|копия", re.I)),
]


def _classify_metric(h: str) -> str | None:
    hl = h.lower()
    is_total = bool(re.search(r"общ|total|cume|от премиерата|натрупан|кумулат|до момента", hl))
    is_money = bool(re.search(r"приход|бокс|gross|box|сума|лв|bgn|eur|€|евро|revenue", hl))
    is_adm = bool(re.search(r"зрител|посещ|adm|билет|viewers|tickets", hl))
    if is_money:
        return "total_gross" if is_total else "weekend_gross"
    if is_adm:
        return "total_adm" if is_total else "weekend_adm"
    return None


def map_headers(header: list[str]) -> dict[int, str]:
    mapping: dict[int, str] = {}
    for i, h in enumerate(header):
        h = (h or "").strip()
        if not h:
            continue
        metric = _classify_metric(h)
        field = metric
        if not field:
            for name, rx in HEADER_MAP:
                if rx.search(h) and name not in mapping.values():
                    field = name
                    break
        if field and field not in mapping.values():
            mapping[i] = field
    return mapping


def header_currency(header: Iterable[str], fallback: str) -> str:
    joined = " ".join(h or "" for h in header).lower()
    if re.search(r"€|eur|евро", joined):
        return "EUR"
    if re.search(r"лв|bgn|лева", joined):
        return "BGN"
    return fallback


def parse_table_rows(rows: list[list[str]], currency: str) -> list[dict]:
    """Parse a 2D table (first row that looks like a header wins)."""
    rows = [[(c or "").strip() if isinstance(c, str) else ("" if c is None else str(c)) for c in r] for r in rows]
    hdr_idx, mapping = None, {}
    for i, r in enumerate(rows[:8]):
        m = map_headers(r)
        if "title" in m.values() and any(v in m.values() for v in ("weekend_gross", "total_gross", "weekend_adm", "total_adm")):
            hdr_idx, mapping = i, m
            break
    if hdr_idx is None:
        return []
    cur = header_currency(rows[hdr_idx], currency)
    entries = []
    for r in rows[hdr_idx + 1:]:
        rec: dict = {}
        for i, field in mapping.items():
            if i >= len(r):
                continue
            val = r[i]
            if field in ("title", "original_title", "distributor", "country", "release"):
                if val:
                    rec[field] = clean_title(val)
            elif field in ("rank", "weeks", "screens"):
                n = parse_number(val)
                if n is not None:
                    rec["week" if field == "weeks" else field] = int(n)
            else:
                n = parse_number(val)
                if n is not None:
                    rec[field] = n
        title = rec.get("title") or rec.get("original_title")
        if not title or re.fullmatch(r"(общо|total|всичко).*", title, re.I):
            continue
        rec["title"] = title
        rec["key"] = title_key(rec.get("original_title") or title)
        rec["currency"] = cur
        entries.append(rec)
    if entries and not any("rank" in e for e in entries):
        for i, e in enumerate(entries, 1):
            e["rank"] = i
    return entries
