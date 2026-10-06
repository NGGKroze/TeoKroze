"""Merge all sources into the JSON files the web app reads."""
from __future__ import annotations

import datetime as dt
import difflib
from collections import defaultdict

from .common import CONFIG_DIR, DATA_DIR, load_json, now_iso, save_json, title_key, to_eur


class KeyResolver:
    """Maps any title key to a canonical film key (aliases, NFC bg->original, fuzzy)."""

    def __init__(self, charts: list[dict]):
        self.alias: dict[str, str] = {}
        cfg = load_json(CONFIG_DIR / "aliases.json", {}).get("aliases", {})
        for a, b in cfg.items():
            self.alias[title_key(a)] = title_key(b)
        for ch in charts:
            for e in ch["entries"]:
                if e.get("original_title") and e.get("title"):
                    bg, orig = title_key(e["title"]), title_key(e["original_title"])
                    if bg != orig:
                        self.alias.setdefault(bg, orig)
        self.known: list[str] = []

    def __call__(self, key: str) -> str:
        seen = set()
        while key in self.alias and key not in seen:
            seen.add(key)
            key = self.alias[key]
        if key not in self.known and self.known and len(key) > 5:
            m = difflib.get_close_matches(key, self.known, n=1, cutoff=0.9)
            if m:
                self.alias[key] = m[0]
                return m[0]
        if key not in self.known:
            self.known.append(key)
        return key


def pick_charts(charts: list[dict]) -> list[dict]:
    """One chart per (source, period, period_end): actuals over estimates, then most rows, then latest."""
    best: dict[tuple, dict] = {}
    for c in charts:
        k = (c["source"], c.get("period"), c["period_end"])
        score = (not c.get("estimate"), len(c["entries"]), c.get("posted_at") or "")
        if k not in best or score > best[k][0]:
            best[k] = (score, c)
    return sorted((v[1] for v in best.values()), key=lambda c: (c["period_end"], c["source"]), reverse=True)


def build(charts: list[dict], cinemas: list[dict], status: dict) -> dict:
    charts = pick_charts(charts)
    resolve = KeyResolver(charts)
    # NFC first so its (original) titles become the canonical keys
    for c in sorted(charts, key=lambda c: c["source"] != "nfc"):
        for e in c["entries"]:
            e["key"] = resolve(e["key"])
            for f in ("weekend_gross", "total_gross"):
                if e.get(f) is not None and e.get("currency") in ("BGN", "EUR"):
                    e[f + "_eur"] = to_eur(e[f], e["currency"])

    films: dict[str, dict] = {}

    def film(key: str, title: str) -> dict:
        f = films.get(key)
        if not f:
            f = films[key] = {"key": key, "title": title, "titles": [], "runs": [], "sources": [],
                              "now_showing": False, "venues": 0, "screenings": 0, "cities": []}
        if title and title not in f["titles"]:
            f["titles"].append(title)
        return f

    for c in sorted(charts, key=lambda c: c["period_end"]):
        for e in c["entries"]:
            f = film(e["key"], e.get("original_title") or e["title"])
            if e.get("original_title"):
                f["title"] = e["original_title"]
                if e["title"] not in f["titles"]:
                    f["titles"].append(e["title"])
                f["title_bg"] = e["title"]
            for extra in ("distributor", "release", "country"):
                if e.get(extra):
                    f[extra] = e[extra]
            if c["source"] not in f["sources"]:
                f["sources"].append(c["source"])
            f["runs"].append({k: e.get(k) for k in (
                "rank", "weekend_gross", "weekend_adm", "total_gross", "total_adm", "currency",
                "weekend_gross_eur", "total_gross_eur", "week", "change_pct") if e.get(k) is not None}
                | {"source": c["source"], "period": c.get("period"), "period_end": c["period_end"]})

    today = dt.date.today().isoformat()
    for cin in cinemas:
        for fm in cin["films"]:
            fm["key"] = resolve(fm["key"])
            f = film(fm["key"], fm["title"])
            f["now_showing"] = True
            f["venues"] += 1
            f["screenings"] += len(fm["showtimes"])
            if cin.get("city") and cin["city"] not in f["cities"]:
                f["cities"].append(cin["city"])
            if "cinemas" not in f["sources"]:
                f["sources"].append("cinemas")
            if fm.get("poster") and not f.get("poster"):
                f["poster"] = fm["poster"]
            if fm.get("release") and not f.get("release"):
                f["release"] = fm["release"]
            if fm["title"] not in f["titles"]:
                f["titles"].append(fm["title"])
                f.setdefault("title_bg", fm["title"])

    for f in films.values():
        runs = f["runs"]
        if not runs:
            continue
        f["first_chart"] = runs[0]["period_end"]
        f["last_chart"] = runs[-1]["period_end"]
        f["best_rank"] = min(r["rank"] for r in runs if r.get("rank")) if any(r.get("rank") for r in runs) else None

        def best_total(field):
            # prefer official NFC totals, fall back to forum; else sum weekends of one source
            for src in ("nfc", "forum"):
                vals = [r[field] for r in runs if r["source"] == src and r.get(field) is not None]
                if vals:
                    return max(vals)
            return None
        f["total_gross_eur"] = best_total("total_gross_eur")
        f["total_adm"] = best_total("total_adm")
        if f["total_adm"] is None:
            for src in ("nfc", "forum"):
                s = sum(r.get("weekend_adm") or 0 for r in runs if r["source"] == src and r.get("period") == "week")
                if s:
                    f["total_adm"], f["total_adm_estimated"] = s, True
                    break
        peak = max(runs, key=lambda r: r.get("weekend_gross_eur") or r.get("weekend_adm") or 0)
        f["peak"] = peak

    # daily screening history, for trends
    daily = load_json(DATA_DIR / "daily.json", {})
    if cinemas:
        daily[today] = {k: [f["screenings"], f["venues"]] for k, f in films.items() if f["now_showing"]}
        for d in sorted(daily)[:-180]:
            del daily[d]

    save_json(DATA_DIR / "charts.json", {"generated_at": now_iso(), "charts": charts})
    save_json(DATA_DIR / "films.json", {"generated_at": now_iso(),
                                         "films": sorted(films.values(), key=lambda f: (-(f["total_gross_eur"] or 0) if "total_gross_eur" in f else 0, f["title"]))})
    save_json(DATA_DIR / "showtimes.json", {"generated_at": now_iso(), "cinemas": cinemas})
    save_json(DATA_DIR / "daily.json", daily)
    save_json(DATA_DIR / "status.json", status | {"generated_at": now_iso(),
                                                  "counts": {"films": len(films), "charts": len(charts),
                                                             "cinemas": len(cinemas)}})
    return {"films": len(films), "charts": len(charts), "cinemas": len(cinemas)}
