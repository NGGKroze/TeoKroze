"""Национален филмов център (nfc.bg) – official weekly box office.

NFC publishes weekly box office tables (HTML tables and/or attached XLS(X)/PDF files).
Because the site layout changes over time, this module discovers report pages by
following links whose text or URL mentions box office ("бокс офис", "box office",
"разпространение", "статистика"), then parses every table/file it finds.
Seed URLs live in config/sources.json -> nfc.seed_urls.
"""
from __future__ import annotations

import datetime as dt
import io
import re
from urllib.parse import urljoin, urlparse

from bs4 import BeautifulSoup

from ..charts import parse_table_rows
from ..common import DATA_DIR, Fetcher, default_currency, load_json, save_json

LINK_RE = re.compile(r"бокс|box.?office|boxoffice|разпространени|статистик|зрители|приходи", re.I)
FILE_RE = re.compile(r"\.(xlsx?|pdf|csv)(\?|$)", re.I)
SEEN_FILE = DATA_DIR / "nfc_seen.json"

PERIOD_RES = [
    # 09.01.2026 - 15.01.2026  /  09.01 – 15.01.2026
    re.compile(r"(\d{1,2})[./](\d{1,2})(?:[./](\d{4}))?\s*(?:г\.)?\s*[-–—до]+\s*(\d{1,2})[./](\d{1,2})[./](\d{4})"),
    # 09 – 15.01.2026
    re.compile(r"(\d{1,2})\s*[-–—]\s*(\d{1,2})[./](\d{1,2})[./](\d{4})"),
]


def find_period(text: str) -> tuple[dt.date, dt.date] | None:
    for i, rx in enumerate(PERIOD_RES):
        m = rx.search(text or "")
        if not m:
            continue
        try:
            if i == 0:
                d1, m1, y1, d2, m2, y2 = m.groups()
                end = dt.date(int(y2), int(m2), int(d2))
                start = dt.date(int(y1 or y2), int(m1), int(d1))
                if start > end:
                    start = start.replace(year=start.year - 1)
            else:
                d1, d2, mo, y = m.groups()
                end = dt.date(int(y), int(mo), int(d2))
                start = dt.date(int(y), int(mo), int(d1))
            if 0 <= (end - start).days <= 31:
                return start, end
        except ValueError:
            continue
    return None


def _html_tables(soup: BeautifulSoup) -> list[list[list[str]]]:
    out = []
    for t in soup.select("table"):
        rows = [[c.get_text(" ", strip=True) for c in tr.find_all(["td", "th"])] for tr in t.find_all("tr")]
        if len(rows) >= 3:
            out.append(rows)
    return out


def _file_tables(content: bytes, url: str) -> list[list[list[str]]]:
    ext = FILE_RE.search(url).group(1).lower()
    tables = []
    if ext == "xlsx":
        import openpyxl
        wb = openpyxl.load_workbook(io.BytesIO(content), read_only=True, data_only=True)
        for ws in wb.worksheets:
            tables.append([["" if v is None else str(v) for v in row] for row in ws.iter_rows(values_only=True)])
    elif ext == "xls":
        import xlrd
        wb = xlrd.open_workbook(file_contents=content)
        for sh in wb.sheets():
            tables.append([[str(sh.cell_value(r, c)) for c in range(sh.ncols)] for r in range(sh.nrows)])
    elif ext == "csv":
        import csv
        text = content.decode("utf-8-sig", errors="replace")
        tables.append(list(csv.reader(io.StringIO(text), delimiter=";" if text.count(";") > text.count(",") else ",")))
    elif ext == "pdf":
        import pdfplumber
        with pdfplumber.open(io.BytesIO(content)) as pdf:
            for page in pdf.pages:
                for t in page.extract_tables() or []:
                    tables.append([[c or "" for c in row] for row in t])
                tables.append([[page.extract_text() or ""]])  # keeps period text for find_period
    return tables


def _chart(entries, period, url, label):
    start, end = period
    return {
        "source": "nfc",
        "period": "week" if (end - start).days >= 4 else "weekend",
        "period_start": start.isoformat(),
        "period_end": end.isoformat(),
        "url": url,
        "label": label,
        "entries": entries,
    }


def scrape(cfg: dict, log=print) -> list[dict]:
    fetcher = Fetcher(delay=1.0)
    seeds = cfg.get("seed_urls") or ["https://www.nfc.bg/"]
    allowed = {urlparse(u).netloc for u in seeds}
    max_pages = int(cfg.get("max_pages", 60))
    seen = load_json(SEEN_FILE, {"files": {}})
    queue = [(u, 0) for u in seeds]
    visited: set[str] = set()
    charts: list[dict] = []

    while queue and len(visited) < max_pages:
        url, depth = queue.pop(0)
        if url in visited:
            continue
        visited.add(url)
        try:
            r = fetcher.get(url)
        except Exception as e:  # noqa: BLE001
            log(f"  nfc: {url} -> {e}")
            continue
        if FILE_RE.search(url):
            if url in seen["files"]:
                charts.extend(seen["files"][url])
                continue
            found = []
            try:
                tables = _file_tables(r.content, url)
                ptxt = " ".join(" ".join(" ".join(row) for row in t[:6]) for t in tables)
                period = find_period(url + " " + ptxt)
                for t in tables:
                    entries = parse_table_rows(t, default_currency(period[1] if period else None))
                    if len(entries) >= 3 and period:
                        found.append(_chart(entries, period, url, urlparse(url).path.rsplit("/", 1)[-1]))
            except Exception as e:  # noqa: BLE001
                log(f"  nfc: cannot parse {url}: {e}")
            seen["files"][url] = found
            charts.extend(found)
            continue
        soup = BeautifulSoup(r.text, "lxml")
        title = (soup.title.get_text(strip=True) if soup.title else "")
        text = soup.get_text(" ", strip=True)
        for tbl in _html_tables(soup):
            # look for the period right above the table, then in the page title/body
            prev = tbl and " ".join(" ".join(r) for r in tbl[:2])
            period = find_period(prev) or find_period(title) or find_period(text[:3000])
            entries = parse_table_rows(tbl, default_currency(period[1] if period else None))
            if len(entries) >= 3 and period:
                charts.append(_chart(entries, period, url, title))
        if depth >= int(cfg.get("max_depth", 2)):
            continue
        for a in soup.select("a[href]"):
            href = urljoin(url, a["href"]).split("#")[0]
            if urlparse(href).netloc not in allowed:
                continue
            label = a.get_text(" ", strip=True) + " " + href
            if FILE_RE.search(href) and (LINK_RE.search(label) or find_period(label)):
                queue.append((href, depth + 1))
            elif LINK_RE.search(label) and href not in visited:
                queue.append((href, depth + 1))
    save_json(SEEN_FILE, seen)
    log(f"  nfc: visited {len(visited)} pages, {len(charts)} charts")
    return charts
