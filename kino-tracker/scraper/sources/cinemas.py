"""Showtimes from Bulgarian cinemas.

Two kinds of scrapers:
  * "cinemacity"  – Cinema City's public Quickbook JSON API (all Bulgarian Cinema City sites).
  * "html"        – any other cinema/chain page. Extracts schema.org JSON-LD
                    (Movie / ScreeningEvent) and, if the config gives CSS selectors,
                    film titles + showtimes from the HTML.
Cinemas are configured in config/sources.json -> cinemas.
"""
from __future__ import annotations

import datetime as dt
import json
import re
from urllib.parse import urljoin

from bs4 import BeautifulSoup

from ..common import Fetcher, clean_title, title_key

TIME_RE = re.compile(r"\b([01]?\d|2[0-3])[:.]([0-5]\d)\b")


def _film(title, **kw) -> dict:
    t = clean_title(title)
    return {"title": t, "key": title_key(t), "showtimes": [], **{k: v for k, v in kw.items() if v}}


# ---------------------------------------------------------------- Cinema City

def scrape_cinemacity(src: dict, days: int, fetcher: Fetcher, log=print) -> list[dict]:
    base = src.get("api", "https://www.cinemacity.bg/bg/data-api-service/v1/quickbook")
    lang = src.get("lang", "bg_BG")
    today = dt.date.today()
    until = (today + dt.timedelta(days=365)).isoformat()
    tenants = [src["tenant"]] if src.get("tenant") else ["10106", "10108", "10105", "10107", "10101", "10102", "10103", "10104"]
    cinemas, tenant = [], None
    for t in tenants:
        try:
            j = fetcher.get(f"{base}/{t}/cinemas/with-event/until/{until}?attr=&lang={lang}").json()
            cinemas = j.get("body", {}).get("cinemas") or []
        except Exception:  # noqa: BLE001
            continue
        if cinemas:
            tenant = t
            break
    if not cinemas:
        raise RuntimeError("Cinema City API returned no cinemas")
    out = []
    for c in cinemas:
        films: dict[str, dict] = {}
        for i in range(days):
            day = (today + dt.timedelta(days=i)).isoformat()
            try:
                j = fetcher.get(f"{base}/{tenant}/film-events/in-cinema/{c['id']}/at-date/{day}?attr=&lang={lang}").json()
            except Exception as e:  # noqa: BLE001
                log(f"    cinemacity {c.get('displayName')}: {day}: {e}")
                continue
            body = j.get("body", {})
            meta = {f["id"]: f for f in body.get("films", [])}
            for ev in body.get("events", []):
                f = meta.get(ev.get("filmId"), {})
                name = f.get("name") or ev.get("filmId")
                film = films.get(ev.get("filmId"))
                if not film:
                    film = films[ev.get("filmId")] = _film(
                        name, poster=f.get("posterLink"), url=f.get("link"),
                        length=f.get("length"), release=(f.get("releaseDate") or "")[:10] or None,
                    )
                film["showtimes"].append(ev.get("eventDateTime"))
        city = (c.get("addressInfo") or {}).get("city")
        out.append({
            "id": f"cinemacity-{c['id']}",
            "name": f"Cinema City {c.get('displayName', '')}".strip(),
            "chain": "Cinema City",
            "city": city,
            "url": c.get("link"),
            "films": list(films.values()),
        })
    return out


# ---------------------------------------------------------------- generic HTML

def _jsonld_items(soup: BeautifulSoup):
    for s in soup.select('script[type="application/ld+json"]'):
        try:
            data = json.loads(s.string or s.get_text() or "")
        except (json.JSONDecodeError, TypeError):
            continue
        stack = [data]
        while stack:
            d = stack.pop()
            if isinstance(d, list):
                stack.extend(d)
            elif isinstance(d, dict):
                if "@graph" in d:
                    stack.extend(d["@graph"] if isinstance(d["@graph"], list) else [d["@graph"]])
                yield d
                for k in ("itemListElement", "item", "event", "subEvent"):
                    if isinstance(d.get(k), (list, dict)):
                        stack.append(d[k])


def _types(d: dict) -> set[str]:
    t = d.get("@type")
    return set(t if isinstance(t, list) else [t]) if t else set()


def parse_html_cinema(html: str, url: str, src: dict) -> list[dict]:
    soup = BeautifulSoup(html, "lxml")
    films: dict[str, dict] = {}

    def add(title, showtime=None, **kw):
        if not title or len(title) > 150:
            return
        f = films.get(title_key(title))
        if not f:
            f = films[title_key(title)] = _film(title, **kw)
        if showtime and showtime not in f["showtimes"]:
            f["showtimes"].append(showtime)

    for d in _jsonld_items(soup):
        ty = _types(d)
        if ty & {"ScreeningEvent", "Event"}:
            wp = d.get("workPresented")
            wp = wp[0] if isinstance(wp, list) and wp else wp
            name = (wp or {}).get("name") if isinstance(wp, dict) else None
            add(name or d.get("name"), d.get("startDate"),
                poster=(wp or {}).get("image") if isinstance(wp, dict) else None)
        elif "Movie" in ty:
            img = d.get("image")
            add(d.get("name"), poster=img if isinstance(img, str) else None, url=d.get("url"))

    sel = src.get("selectors") or {}
    if sel.get("film"):
        for node in soup.select(sel["film"]):
            tnode = node.select_one(sel.get("title", "h2, h3, .title"))
            if not tnode:
                continue
            link = tnode if tnode.name == "a" else tnode.find("a") or node.find("a")
            img = node.select_one("img")
            title = tnode.get_text(" ", strip=True)
            times = [t.get_text(" ", strip=True) for t in node.select(sel["time"])] if sel.get("time") else []
            add(title, poster=urljoin(url, img.get("data-src") or img.get("src")) if img and (img.get("data-src") or img.get("src")) else None,
                url=urljoin(url, link["href"]) if link and link.get("href") else None)
            f = films[title_key(title)]
            for t in times:
                m = TIME_RE.search(t)
                if m and f"{int(m.group(1)):02d}:{m.group(2)}" not in f["showtimes"]:
                    f["showtimes"].append(f"{int(m.group(1)):02d}:{m.group(2)}")
    return list(films.values())


def scrape_html(src: dict, fetcher: Fetcher, log=print) -> list[dict]:
    films: dict[str, dict] = {}
    for url in src.get("urls") or [src["url"]]:
        r = fetcher.get(url)
        for f in parse_html_cinema(r.text, url, src):
            if f["key"] in films:
                films[f["key"]]["showtimes"].extend(s for s in f["showtimes"] if s not in films[f["key"]]["showtimes"])
            else:
                films[f["key"]] = f
    return [{
        "id": src["id"], "name": src["name"], "chain": src.get("chain"), "city": src.get("city"),
        "url": src.get("url") or (src.get("urls") or [None])[0], "films": list(films.values()),
    }]


def scrape(cinemas_cfg: list[dict], days: int = 7, log=print) -> tuple[list[dict], list[dict]]:
    """Returns (cinemas_with_films, status_rows)."""
    fetcher = Fetcher(delay=0.7)
    result, status = [], []
    for src in cinemas_cfg:
        if src.get("disabled"):
            continue
        try:
            if src.get("type") == "cinemacity":
                rows = scrape_cinemacity(src, days, fetcher, log)
            else:
                rows = scrape_html(src, fetcher, log)
            n = sum(len(c["films"]) for c in rows)
            status.append({"id": src["id"], "name": src["name"], "ok": n > 0, "films": n, "cinemas": len(rows),
                           "note": None if n else "no films found – page layout needs selectors"})
            result.extend(rows)
            log(f"  {src['name']}: {len(rows)} venue(s), {n} film rows")
        except Exception as e:  # noqa: BLE001
            status.append({"id": src["id"], "name": src["name"], "ok": False, "films": 0, "note": str(e)[:300]})
            log(f"  {src['name']}: ERROR {e}")
    return result, status
