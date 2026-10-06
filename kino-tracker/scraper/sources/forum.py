"""Crawl the BoxOfficeTheory "Bulgaria box office" thread from page 1 and extract charts.

The forum runs Invision Community; posts are <article id="elComment_N"> elements whose
body lives in [data-role=commentContent]. Raw posts are cached in data/forum_posts.json so
that parsing can be improved later without re-crawling (use --reparse).
"""
from __future__ import annotations

import datetime as dt
import re

from bs4 import BeautifulSoup, Tag

from ..charts import parse_table_rows, parse_text_chart
from ..common import DATA_DIR, Fetcher, default_currency, load_json, now_iso, save_json, weekend_end_for

THREAD_URL = (
    "https://forums.boxofficetheory.com/topic/"
    "30981-bulgaria-box-office-thread-verity-breaks-out-heart-of-the-beast-going-strong-doomsday-with-astonishing-presales/"
)
POSTS_FILE = DATA_DIR / "forum_posts.json"


def page_url(n: int) -> str:
    base = re.sub(r"page/\d+/?.*$", "", THREAD_URL)
    return base if n == 1 else f"{base}page/{n}/"


def _post_text(node: Tag) -> str:
    node = BeautifulSoup(str(node), "lxml")
    for q in node.select("blockquote, .ipsQuote, script, style"):
        q.decompose()  # skip quoted posts so charts aren't duplicated
    for br in node.find_all("br"):
        br.replace_with("\n")
    for blk in node.find_all(["p", "div", "li", "tr", "h1", "h2", "h3", "h4"]):
        blk.insert_after("\n")
    for cell in node.find_all(["td", "th"]):
        cell.insert_after("\t")
    text = node.get_text()
    text = re.sub(r"[  ]+\n", "\n", text)
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def _post_tables(node: Tag) -> list[list[list[str]]]:
    tables = []
    for t in node.select("table"):
        if t.find_parent("blockquote"):
            continue
        rows = [[c.get_text(" ", strip=True) for c in tr.find_all(["td", "th"])] for tr in t.find_all("tr")]
        if len(rows) >= 3:
            tables.append(rows)
    return tables


def parse_page(html: str, page: int) -> tuple[list[dict], int | None]:
    soup = BeautifulSoup(html, "lxml")
    posts = []
    articles = soup.select("article[id^=elComment_]") or soup.select("article[data-commentid], [data-role=comment]")
    for art in articles:
        pid = art.get("data-commentid") or re.sub(r"\D", "", art.get("id", "")) or None
        content = art.select_one("[data-role=commentContent]") or art.select_one(".ipsComment_content, .cPost_contentWrap, .ipsRichText")
        if not content or not pid:
            continue
        t = art.select_one("time[datetime]")
        author = art.select_one(".cAuthorPane_author, [data-role=author], .ipsEntry__author-name, a[href*='/profile/']")
        posts.append({
            "id": str(pid),
            "page": page,
            "date": t["datetime"] if t else None,
            "author": author.get_text(" ", strip=True) if author else None,
            "url": f"{page_url(page)}#comment-{pid}",
            "text": _post_text(content),
            "tables": _post_tables(content),
        })
    last = None
    pag = soup.select_one("[data-pages]")
    if pag and str(pag.get("data-pages", "")).isdigit():
        last = int(pag["data-pages"])
    else:
        nums = [int(a.get("data-page")) for a in soup.select("a[data-page]") if str(a.get("data-page", "")).isdigit()]
        last = max(nums) if nums else None
    return posts, last


def crawl(full: bool = False, max_pages: int | None = None, log=print) -> dict:
    store = load_json(POSTS_FILE, {"thread": THREAD_URL, "pages_crawled": 0, "posts": []})
    by_id = {p["id"]: p for p in store["posts"]}
    fetcher = Fetcher(delay=1.5)
    # always re-read the last known page: it may have gained posts since the last run
    start = 1 if full or not store.get("pages_crawled") else max(1, store["pages_crawled"])
    page, last, prev_ids = start, None, None
    while True:
        r = fetcher.get(page_url(page))
        posts, last_seen = parse_page(r.text, page)
        last = last_seen or last
        ids = [p["id"] for p in posts]
        if not posts or ids == prev_ids:
            break  # past the end (Invision serves the last page again)
        for p in posts:
            by_id[p["id"]] = p
        log(f"  forum page {page}{'/' + str(last) if last else ''}: {len(posts)} posts")
        store["pages_crawled"] = max(store.get("pages_crawled", 0), page)
        prev_ids = ids
        if (last and page >= last) or (max_pages and page - start + 1 >= max_pages):
            break
        page += 1
    store["posts"] = sorted(by_id.values(), key=lambda p: (p.get("date") or "", int(p["id"]) if p["id"].isdigit() else 0))
    store["last_page"] = last
    store["crawled_at"] = now_iso()
    save_json(POSTS_FILE, store)
    return store


def _post_date(p: dict) -> dt.date | None:
    if not p.get("date"):
        return None
    try:
        return dt.datetime.fromisoformat(p["date"].replace("Z", "+00:00")).date()
    except ValueError:
        return None


DATE_RANGE_RE = re.compile(
    r"\b(\d{1,2})\s*[-–]\s*(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?\b"
    r"|\b(\d{1,2})[./](\d{1,2})\s*[-–]\s*(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?\b"
)
MONTHS = {m: i + 1 for i, m in enumerate(
    ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"])}
MONTH_RANGE_RE = re.compile(
    r"\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})\s*[-–]\s*(?:(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+)?(\d{1,2})\b"
    r"|\b(\d{1,2})\s*[-–]\s*(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b",
    re.I,
)


def _explicit_period_end(text: str, posted: dt.date) -> dt.date | None:
    """Find 'Jan 9-11', '9-11 January', '09-11.01', '09.01-11.01.2026' in the first lines."""
    head = "\n".join(text.splitlines()[:6])
    year = posted.year
    try:
        m = MONTH_RANGE_RE.search(head)
        if m:
            if m.group(1):
                mon = MONTHS[(m.group(3) or m.group(1))[:3].lower()]
                d = int(m.group(4))
            else:
                mon, d = MONTHS[m.group(7)[:3].lower()], int(m.group(6))
            end = dt.date(year, mon, d)
        else:
            m = DATE_RANGE_RE.search(head)
            if not m:
                return None
            if m.group(1):
                d, mon, y = int(m.group(2)), int(m.group(3)), m.group(4)
            else:
                d, mon, y = int(m.group(7)), int(m.group(8)), m.group(9)
            if y:
                year = int(y) + (2000 if len(y) == 2 else 0)
            end = dt.date(year, mon, d)
        if end > posted + dt.timedelta(days=3):  # Dec chart posted in Jan
            end = end.replace(year=end.year - 1)
        if (posted - end).days > 60:
            return None
        return end
    except (ValueError, KeyError):
        return None


ESTIMATE_RE = re.compile(r"\b(estimates?|est\.|presales?|projection|predict|прогноз|предварител)", re.I)


def extract_charts(store: dict) -> list[dict]:
    charts = []
    for p in store.get("posts", []):
        posted = _post_date(p)
        if not posted:
            continue
        cur = default_currency(posted)
        entries = []
        for tbl in p.get("tables") or []:
            entries = parse_table_rows(tbl, cur)
            if len(entries) >= 3:
                break
        if len(entries) < 3:
            entries = parse_text_chart(p.get("text", ""), cur)
        if len(entries) < 3:
            continue
        end = _explicit_period_end(p.get("text", ""), posted) or weekend_end_for(posted)
        charts.append({
            "source": "forum",
            "period": "weekend",
            "period_end": end.isoformat(),
            "period_start": (end - dt.timedelta(days=2)).isoformat(),
            "posted_at": p.get("date"),
            "author": p.get("author"),
            "url": p.get("url"),
            "estimate": bool(ESTIMATE_RE.search(p.get("text", "")[:300])),
            "entries": entries,
        })
    return charts
