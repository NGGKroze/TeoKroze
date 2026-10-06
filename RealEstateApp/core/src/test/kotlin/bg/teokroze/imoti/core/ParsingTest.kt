package bg.teokroze.imoti.core

import bg.teokroze.imoti.core.sources.AloBg
import bg.teokroze.imoti.core.sources.ImotBg
import bg.teokroze.imoti.core.sources.OlxBg
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class ParsingTest {
    @Test
    fun prices() {
        assertEquals(135900.0, TextParsing.parsePriceEur("66 кв.м / 135 900 € » 265 797.30 лв."))
        assertEquals(98300.0, TextParsing.parsePriceEur("Цена: 98 300 EUR"))
        assertEquals(100000.0, TextParsing.parsePriceEur("100 000 евро"))
        assertEquals(1794.9, TextParsing.parsePriceEur("1794.90 €/кв.м"))
        assertEquals(50000.0, TextParsing.parsePriceEur("97 791.50 лв.")!!, 1.0)
        assertEquals(null, TextParsing.parsePriceEur("Цена по договаряне"))
    }

    @Test
    fun areasPhonesEmails() {
        assertEquals(80.68, TextParsing.parseAreaSqm("тристаен 80,68 кв.м, тухла"))
        assertEquals(131.0, TextParsing.parseAreaSqm("жилищна площ 131 м2"))
        assertEquals(listOf("0888123456", "+359828212345"), TextParsing.findPhones("тел: 0888 123 456 или +359 82 821 2345, 1975 г."))
        assertEquals(listOf("ivan@abv.bg"), TextParsing.findEmails("пишете на ivan@abv.bg."))
    }

    @Test
    fun types() {
        assertEquals(PropertyType.ROOM_2, PropertyType.detect("Продава 2-СТАЕН в град Русе"))
        assertEquals(PropertyType.HOUSE, PropertyType.detect("Едноетажна къща в с. Тетово"))
        assertEquals(PropertyType.LAND, PropertyType.detect("Регулиран ПАРЦЕЛ Родина 3"))
    }

    @Test
    fun imotSearchPage() {
        val html = """
            <html><body><div class="list">
              <div class="item">
                <a href="/obiava-1b177256124845804-prodava-dvustaen-apartament-grad-ruse-tsentar"><img src="https://imotstatic.com/big/1.jpg"></a>
                <a href="/obiava-1b177256124845804-prodava-dvustaen-apartament-grad-ruse-tsentar">Продава 2-СТАЕН град Русе, Център</a>
                <div class="price">135 900 €</div><div>66 кв.м, 3 ет.</div>
              </div>
              <div class="item">
                <a href="https://www.imot.bg/obiava-1c111-prodava-kashta-selo-ivanovo">Продава КЪЩА село Иваново</a>
                <div>45 000 €</div><div>120 кв.м</div>
              </div>
            </div></body></html>
        """.trimIndent()
        val res = ImotBg.parseSearch(html, "https://www.imot.bg/obiavi/prodazhbi/grad-ruse")
        assertEquals(2, res.size)
        val a = res[0]
        assertEquals("1b177256124845804", a.nativeId)
        assertEquals(135900.0, a.priceEur)
        assertEquals(66.0, a.areaSqm)
        assertEquals(PropertyType.ROOM_2, a.type)
        assertEquals("https://imotstatic.com/big/1.jpg", a.imageUrl)
        assertTrue(a.location.contains("Русе"), a.location)
        assertEquals(PropertyType.HOUSE, res[1].type)
        assertTrue(res[1].location.contains("Иваново"), res[1].location)
    }

    @Test
    fun aloAndOlxSearchPages() {
        val alo = """<div><div class="listtop-item"><a href="/5749048">Собственик продава тристаен апартамент, Възраждане, Русе</a>
            <span>100 000 €</span> <span>80.68 кв.м</span></div>
            <div class="listtop-item"><a href="/obiavi/imoti-prodajbi/">категория</a><a href="/5749050">Къща в с. Николово</a><span>157 900 €</span></div></div>"""
        val aloRes = AloBg.parseSearch(alo, "https://www.alo.bg/obiavi/imoti-prodajbi/?region_id=18")
        assertEquals(listOf("5749048", "5749050"), aloRes.map { it.nativeId })
        assertEquals(PropertyType.ROOM_3, aloRes[0].type)

        val olx = """<div data-testid="listing-grid"><div data-cy="l-card"><a href="/d/ad/triaten-vazrazhdane-CID368-ID9xYz1.html"><h4>Тристаен Възраждане</h4></a>
            <p data-testid="ad-price">120 000 €</p><p data-testid="location-date">Русе, Възраждане - Днес в 10:15</p><span>85 кв.м</span></div></div>"""
        val olxRes = OlxBg.parseSearch(olx, "https://www.olx.bg/nedvizhimi-imoti/prodazhbi/ruse/")
        assertEquals(1, olxRes.size)
        assertEquals("9xYz1", olxRes[0].nativeId)
        assertEquals("Русе, Възраждане", olxRes[0].location)
        assertEquals(120000.0, olxRes[0].priceEur)
    }

    @Test
    fun detailsPage() {
        val html = """<html><head><meta property="og:image" content="https://cdn.x.bg/photos/a1.jpg"></head><body>
            <h1>Продава 3-СТАЕН град Русе, Център 98 кв.м 175 900 €</h1>
            <div class="description">Тухлен тристаен апартамент с две тераси, ТЕЦ, асансьор. Обадете се на 0899 111 222.</div>
            <table><tr><td>Етаж:</td><td>8-ми от 8</td></tr><tr><td>Строителство:</td><td>Тухла, 1975 г.</td></tr></table>
            <div class="contact"><span class="name">Иван Петров</span><a href="tel:+359888777666">Обади се</a><a href="mailto:ivan@estates.bg">Имейл</a></div>
            </body></html>"""
        val d = ImotBg.parseDetails(html, "https://www.imot.bg/obiava-1x-prodava")
        assertEquals(listOf("+359888777666", "0899111222"), d.phones)
        assertEquals(listOf("ivan@estates.bg"), d.emails)
        assertEquals("Иван Петров", d.contactName)
        assertEquals(listOf("https://cdn.x.bg/photos/a1.jpg"), d.images)
        assertTrue(d.attributes.contains("Етаж" to "8-ми от 8"), d.attributes.toString())
        assertTrue(d.description.startsWith("Тухлен"))
        assertEquals("175 900 €", d.priceText)
    }

    @Test
    fun filterMatching() {
        val l = Listing(Source.ALO_BG, "1", "u", "Тристаен Център", priceEur = 120000.0, areaSqm = 85.0, type = PropertyType.ROOM_3)
        assertTrue(SearchFilter("a").matches(l))
        assertTrue(SearchFilter("a", types = setOf(PropertyType.ROOM_3), maxPriceEur = 130000.0, keyword = "център").matches(l))
        assertEquals(false, SearchFilter("a", maxPriceEur = 100000.0).matches(l))
        assertEquals(false, SearchFilter("a", sources = setOf(Source.OLX_BG)).matches(l))
    }
}
