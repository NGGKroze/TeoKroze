"""Offline tests with hand-made fixtures:  python -m unittest discover -s tests"""
import datetime as dt
import unittest

from scraper.charts import parse_table_rows, parse_text_chart
from scraper.common import parse_number, title_key, to_eur, weekend_end_for
from scraper.sources import forum, nfc
from scraper.sources.cinemas import parse_html_cinema

FORUM_HTML = """
<html><body>
<ul class="ipsPagination" data-pages="3"></ul>
<article id="elComment_101" class="cPost">
 <aside><h3 class="cAuthorPane_author"><strong><a href="/profile/1-x/">BGfan</a></strong></h3></aside>
 <time datetime="2026-01-12T09:00:00Z">Jan 12</time>
 <div data-role="commentContent">
  <blockquote class="ipsQuote"><p>1. Old Film - 1,000 adm</p><p>2. B - 1 adm</p><p>3. C - 1 adm</p></blockquote>
  <p>Weekend Jan 9-11</p>
  <p>1. Avatar: Fire and Ash - €245,000 (-35%) / 21,500 adm; total €3.1M / 280K adm<br>
  2. Verity (NEW) - €120,500 - 10,234 admissions<br>
  3. Heart of the Beast - €80.000 (-12%) Total: €400.000</p>
 </div>
</article>
<article id="elComment_102">
 <time datetime="2026-01-12T10:00:00Z">Jan 12</time>
 <div data-role="commentContent"><p>Great numbers!</p></div>
</article>
</body></html>
"""

NFC_HTML = """
<html><head><title>Бокс офис 09.01.2026 - 15.01.2026</title></head><body>
<table>
<tr><th>№</th><th>Филм</th><th>Оригинално заглавие</th><th>Разпространител</th>
<th>Приходи (€)</th><th>Зрители</th><th>Общо приходи (€)</th><th>Общо зрители</th><th>Седмици</th></tr>
<tr><td>1</td><td>Аватар: Огън и пепел</td><td>Avatar: Fire and Ash</td><td>Форум Филм</td><td>300 000</td><td>26 000</td><td>3 400 000</td><td>300 000</td><td>4</td></tr>
<tr><td>2</td><td>Верити</td><td>Verity</td><td>Александра</td><td>150 000</td><td>13 000</td><td>150 000</td><td>13 000</td><td>1</td></tr>
<tr><td>3</td><td>Сърцето на звяра</td><td>Heart of the Beast</td><td>А Плюс</td><td>90 000</td><td>8 000</td><td>420 000</td><td>37 000</td><td>3</td></tr>
<tr><td></td><td>Общо</td><td></td><td></td><td>540 000</td><td>47 000</td><td></td><td></td><td></td></tr>
</table></body></html>
"""

CINEMA_HTML = """
<html><head><script type="application/ld+json">
{"@context":"https://schema.org","@graph":[
 {"@type":"ScreeningEvent","startDate":"2026-01-12T18:30","workPresented":{"@type":"Movie","name":"Верити"}},
 {"@type":"ScreeningEvent","startDate":"2026-01-12T21:00","workPresented":{"@type":"Movie","name":"Верити"}},
 {"@type":"Movie","name":"Аватар: Огън и пепел (3D)","image":"https://x/p.jpg"}
]}</script></head>
<body><div class="movie"><h3><a href="/f/1">Сърцето на звяра</a></h3><span class="t">17:15</span><span class="t">20:00</span></div></body></html>
"""


class Numbers(unittest.TestCase):
    def test_parse(self):
        self.assertEqual(parse_number("1,234,567"), 1234567)
        self.assertEqual(parse_number("1 234 567 лв."), 1234567)
        self.assertEqual(parse_number("€3.1M"), 3_100_000)
        self.assertEqual(parse_number("280K"), 280_000)
        self.assertEqual(parse_number("12,5 хил."), 12_500)
        self.assertEqual(to_eur(195583, "BGN"), 100000)

    def test_keys(self):
        self.assertEqual(title_key("The Avatar (3D) (2025)"), "avatar")
        self.assertEqual(title_key("Зоотрополис 2 - БГ аудио"), title_key("Зоотрополис 2"))

    def test_weekend(self):
        self.assertEqual(weekend_end_for(dt.date(2026, 1, 12)), dt.date(2026, 1, 11))  # Monday
        self.assertEqual(weekend_end_for(dt.date(2026, 1, 9)), dt.date(2026, 1, 11))   # Friday


class Forum(unittest.TestCase):
    def test_page_and_chart(self):
        posts, last = forum.parse_page(FORUM_HTML, 1)
        self.assertEqual(last, 3)
        self.assertEqual([p["id"] for p in posts], ["101", "102"])
        self.assertEqual(posts[0]["author"], "BGfan")
        self.assertNotIn("Old Film", posts[0]["text"])
        charts = forum.extract_charts({"posts": posts})
        self.assertEqual(len(charts), 1)
        c = charts[0]
        self.assertEqual(c["period_end"], "2026-01-11")
        e = c["entries"]
        self.assertEqual([x["title"] for x in e], ["Avatar: Fire and Ash", "Verity", "Heart of the Beast"])
        self.assertEqual(e[0]["total_adm"], 280_000)
        self.assertEqual(e[1]["weekend_adm"], 10234)
        self.assertTrue(e[1]["new"])
        self.assertEqual(e[2]["total_gross"], 400_000)

    def test_page_urls(self):
        self.assertTrue(forum.page_url(1).endswith("/"))
        self.assertTrue(forum.page_url(7).endswith("/page/7/"))

    def test_text_chart_needs_three_rows(self):
        self.assertEqual(parse_text_chart("1. A - 5 adm\n2. B - 4 adm", "EUR"), [])


class NFC(unittest.TestCase):
    def test_period(self):
        self.assertEqual(nfc.find_period("Бокс офис 09.01.2026 - 15.01.2026"),
                         (dt.date(2026, 1, 9), dt.date(2026, 1, 15)))
        self.assertEqual(nfc.find_period("седмица 26 – 31.12.2025"),
                         (dt.date(2025, 12, 26), dt.date(2025, 12, 31)))

    def test_table(self):
        from bs4 import BeautifulSoup
        tbl = nfc._html_tables(BeautifulSoup(NFC_HTML, "lxml"))[0]
        e = parse_table_rows(tbl, "BGN")
        self.assertEqual(len(e), 3)
        self.assertEqual(e[0]["key"], title_key("Avatar: Fire and Ash"))
        self.assertEqual(e[0]["currency"], "EUR")
        self.assertEqual(e[0]["total_gross"], 3_400_000)
        self.assertEqual(e[2]["week"], 3)
        self.assertEqual(e[1]["distributor"], "Александра")


class Cinemas(unittest.TestCase):
    def test_jsonld_and_selectors(self):
        films = parse_html_cinema(CINEMA_HTML, "https://kino.bg/", {
            "selectors": {"film": ".movie", "title": "h3", "time": ".t"}})
        by = {f["title"]: f for f in films}
        self.assertEqual(len(by["Верити"]["showtimes"]), 2)
        self.assertIn("Аватар: Огън и пепел (3D)", by)
        self.assertEqual(by["Сърцето на звяра"]["showtimes"], ["17:15", "20:00"])


class Build(unittest.TestCase):
    def test_merge(self):
        import tempfile
        from pathlib import Path
        from scraper import build as b
        from scraper import common
        posts, _ = forum.parse_page(FORUM_HTML, 1)
        charts = forum.extract_charts({"posts": posts})
        from bs4 import BeautifulSoup
        tbl = nfc._html_tables(BeautifulSoup(NFC_HTML, "lxml"))[0]
        charts.append(nfc._chart(parse_table_rows(tbl, "EUR"), (dt.date(2026, 1, 9), dt.date(2026, 1, 15)), "u", "l"))
        venues = [{"id": "x", "name": "X", "city": "София",
                   "films": parse_html_cinema(CINEMA_HTML, "https://kino.bg/", {})}]
        with tempfile.TemporaryDirectory() as d:
            old = b.DATA_DIR
            b.DATA_DIR = Path(d)
            try:
                b.build(charts, venues, {"sources": {}})
                films = common.load_json(Path(d) / "films.json", {})["films"]
            finally:
                b.DATA_DIR = old
        verity = next(f for f in films if f["key"] == "verity")
        self.assertEqual(sorted(verity["sources"]), ["cinemas", "forum", "nfc"])
        self.assertTrue(verity["now_showing"])
        avatar = next(f for f in films if f["key"] == title_key("Avatar: Fire and Ash"))
        self.assertEqual(avatar["total_gross_eur"], 3_400_000)  # NFC preferred over forum
        self.assertEqual(avatar["title_bg"], "Аватар: Огън и пепел")


if __name__ == "__main__":
    unittest.main()
