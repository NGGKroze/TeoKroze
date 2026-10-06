"""Entry point:  python -m scraper.run [--full-forum] [--skip forum,nfc,cinemas] [--reparse]

--full-forum   re-crawl the forum thread from page 1 (first run does this automatically)
--reparse      don't fetch anything, just rebuild JSON from cached posts/charts
"""
from __future__ import annotations

import argparse
import sys
import traceback

from .build import build
from .common import CONFIG_DIR, DATA_DIR, load_json, now_iso
from .sources import cinemas as cinemas_src
from .sources import forum, nfc


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--full-forum", action="store_true")
    ap.add_argument("--forum-max-pages", type=int, default=None)
    ap.add_argument("--skip", default="")
    ap.add_argument("--reparse", action="store_true")
    args = ap.parse_args(argv)
    skip = set(filter(None, args.skip.split(","))) | ({"forum", "nfc", "cinemas"} if args.reparse else set())

    cfg = load_json(CONFIG_DIR / "sources.json", {})
    prev_status = load_json(DATA_DIR / "status.json", {})
    prev_charts = load_json(DATA_DIR / "charts.json", {}).get("charts", [])
    status: dict = {"sources": prev_status.get("sources", {})}

    def mark(name, ok, note=None, **kw):
        status["sources"][name] = {"ok": ok, "note": note, "at": now_iso(), **kw}

    # ---- forum (historical + weekly charts)
    fcfg = cfg.get("forum", {})
    if fcfg.get("thread_url"):
        forum.THREAD_URL = fcfg["thread_url"]
    if fcfg.get("enabled", True) and "forum" not in skip:
        print("forum: crawling", forum.THREAD_URL)
        try:
            store = forum.crawl(full=args.full_forum, max_pages=args.forum_max_pages)
            mark("forum", True, posts=len(store["posts"]), pages=store.get("pages_crawled"))
        except Exception as e:  # noqa: BLE001
            traceback.print_exc()
            mark("forum", False, str(e)[:300])
    forum_charts = forum.extract_charts(load_json(forum.POSTS_FILE, {"posts": []}))
    print(f"forum: {len(forum_charts)} charts parsed")

    # ---- NFC
    nfc_charts = [c for c in prev_charts if c["source"] == "nfc"]
    ncfg = cfg.get("nfc", {})
    if ncfg.get("enabled", True) and "nfc" not in skip:
        print("nfc: crawling")
        try:
            fresh = nfc.scrape(ncfg)
            known = {(c["period"], c["period_end"]) for c in fresh}
            nfc_charts = fresh + [c for c in nfc_charts if (c["period"], c["period_end"]) not in known]
            mark("nfc", bool(fresh), None if fresh else "no box office tables found – check seed_urls", charts=len(fresh))
        except Exception as e:  # noqa: BLE001
            traceback.print_exc()
            mark("nfc", False, str(e)[:300])

    # ---- cinemas
    venues = load_json(DATA_DIR / "showtimes.json", {}).get("cinemas", [])
    if "cinemas" not in skip:
        print("cinemas: scraping")
        venues, rows = cinemas_src.scrape(cfg.get("cinemas", []), days=int(cfg.get("showtime_days", 7)))
        status["cinemas"] = rows

    counts = build(forum_charts + nfc_charts, venues, status)
    print("built:", counts)
    return 0


if __name__ == "__main__":
    sys.exit(main())
