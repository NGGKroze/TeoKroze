#!/usr/bin/env python3
"""Прави HTML модулите напълно офлайн.

За всеки modules/<id>/index.html:
  * намира адреси към CDN (cdnjs, jsdelivr, unpkg, tailwind, Google Fonts),
  * сваля файловете в modules/<id>/vendor/<хост>/<път>,
  * пренаписва адресите в index.html да сочат към vendor/.

Скриптът е идемпотентен - вече пренаписани файлове не се пипат.
Използване:  python tools/vendorize.py [id ...]     (без аргументи = всички HTML модули)
"""
import re
import ssl
import sys
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent / "modules"
SKIP = {"loreal"}  # вече е напълно офлайн (библиотеките са вградени)
HOSTS = ("cdnjs.cloudflare.com", "cdn.jsdelivr.net", "unpkg.com", "cdn.tailwindcss.com", "fonts.googleapis.com")
URL_RE = re.compile(r"https://(?:%s)(?:/[^\s\"'<>)`]*)?" % "|".join(re.escape(h) for h in HOSTS))
UA_MODERN = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"


def fetch(url: str, ua: str = "teokroze-vendorize") -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": ua})
    with urllib.request.urlopen(req, timeout=60, context=ssl.create_default_context()) as r:
        return r.read()


def local_rel(url: str) -> str:
    p = urllib.parse.urlparse(url)
    path = p.path.lstrip("/")
    if p.netloc == "fonts.googleapis.com":
        q = urllib.parse.parse_qs(p.query).get("family", ["font"])
        name = re.sub(r"[^A-Za-z0-9]+", "_", "_".join(q)).strip("_")
        return f"vendor/fonts/{name}.css"
    if p.netloc == "cdn.tailwindcss.com":
        return "vendor/cdn.tailwindcss.com/tailwindcss.js"
    if p.netloc == "unpkg.com" and "." not in Path(path).name:
        path += ".js"
    return f"vendor/{p.netloc}/{path}"


def vendor_google_css(css_url: str, dest: Path) -> None:
    css = fetch(css_url, UA_MODERN).decode("utf-8")
    font_dir = dest.parent / (dest.stem + "_files")
    font_dir.mkdir(parents=True, exist_ok=True)

    def repl(m):
        u = m.group(1)
        name = re.sub(r"[^A-Za-z0-9._-]+", "_", urllib.parse.urlparse(u).path.lstrip("/"))
        (font_dir / name).write_bytes(fetch(u))
        return f"url({font_dir.name}/{name})"

    css = re.sub(r"url\((https://[^)]+)\)", repl, css)
    dest.write_text(css, encoding="utf-8")


def vendor_font_awesome_css(dest: Path, css_url: str) -> None:
    """Font Awesome сочи към ../webfonts/*.woff2 - сваляме ги редом до css."""
    css = dest.read_text(encoding="utf-8")
    base = css_url.rsplit("/css/", 1)[0]
    for rel in sorted(set(re.findall(r"url\(\.\./webfonts/([^)?#]+)", css))):
        out = dest.parent.parent / "webfonts" / rel
        if not out.exists():
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_bytes(fetch(f"{base}/webfonts/{rel}"))


def process(mod: Path) -> int:
    html_path = mod / "index.html"
    text = html_path.read_text(encoding="utf-8", errors="surrogateescape")
    urls = sorted(set(URL_RE.findall(text)), key=len, reverse=True)
    for url in urls:
        rel = local_rel(url)
        dest = mod / rel
        if not dest.exists():
            dest.parent.mkdir(parents=True, exist_ok=True)
            print(f"  {url} -> {rel}")
            if "fonts.googleapis.com" in url:
                vendor_google_css(url.replace("&amp;", "&"), dest)
            else:
                dest.write_bytes(fetch(url))
                if "font-awesome" in url and url.endswith(".css"):
                    vendor_font_awesome_css(dest, url)
        text = text.replace(url, rel)
    html_path.write_text(text, encoding="utf-8", errors="surrogateescape")
    return len(urls)


def main() -> None:
    wanted = set(sys.argv[1:])
    for mod in sorted(p for p in ROOT.iterdir() if (p / "index.html").exists()):
        if mod.name in SKIP or (wanted and mod.name not in wanted):
            continue
        print(mod.name)
        n = process(mod)
        print(f"  {n} външни адреса -> vendor/")


if __name__ == "__main__":
    main()
