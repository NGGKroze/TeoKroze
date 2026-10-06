package bg.teokroze.imoti.core.sources

import bg.teokroze.imoti.core.Area
import bg.teokroze.imoti.core.HtmlHeuristics
import bg.teokroze.imoti.core.Listing
import bg.teokroze.imoti.core.ListingDetails
import bg.teokroze.imoti.core.Source
import bg.teokroze.imoti.core.TextParsing
import org.jsoup.Jsoup
import org.jsoup.nodes.Document

interface ListingSource {
    val source: Source

    /** Result-page URLs for [area]; [page] starts at 1. */
    fun searchUrls(area: Area, page: Int): List<String>

    fun parseSearch(html: String, pageUrl: String): List<Listing>

    fun parseDetails(html: String, url: String): ListingDetails =
        HtmlHeuristics.extractDetails(Jsoup.parse(html, url), url)
}

/** imot.bg — e.g. https://www.imot.bg/obiava-1b177256124845804-prodava-dvustaen-apartament-grad-ruse-tsentar */
object ImotBg : ListingSource {
    override val source = Source.IMOT_BG
    private val detail = Regex("""imot\.bg/obiava-([0-9a-z]+)-""")

    override fun searchUrls(area: Area, page: Int): List<String> {
        val suffix = if (page > 1) "/p-$page" else ""
        val city = "https://www.imot.bg/obiavi/prodazhbi/grad-ruse$suffix"
        val region = "https://www.imot.bg/obiavi/prodazhbi/oblast-ruse$suffix"
        return when (area) {
            Area.CITY -> listOf(city)
            Area.AROUND -> listOf(region)
            Area.REGION -> listOf(city, region)
        }
    }

    override fun parseSearch(html: String, pageUrl: String) =
        HtmlHeuristics.extractCards(Jsoup.parse(html, pageUrl), source, detail)
}

/** alo.bg — region_id=18 is Ruse oblast, location_ids=3564 is the city. Listings live at https://www.alo.bg/5749048 */
object AloBg : ListingSource {
    override val source = Source.ALO_BG
    private val detail = Regex("""alo\.bg/(\d{6,9})(?:[/?#]|$)""")

    override fun searchUrls(area: Area, page: Int): List<String> {
        val base = "https://www.alo.bg/obiavi/imoti-prodajbi/?region_id=18"
        val loc = if (area == Area.CITY) "&location_ids=3564" else ""
        val p = if (page > 1) "&page=$page" else ""
        return listOf(base + loc + p)
    }

    override fun parseSearch(html: String, pageUrl: String) =
        HtmlHeuristics.extractCards(Jsoup.parse(html, pageUrl), source, detail)
}

/** OLX — listings at https://www.olx.bg/d/ad/<slug>-ID<id>.html. Phone numbers sit behind a login, so we rarely get them. */
object OlxBg : ListingSource {
    override val source = Source.OLX_BG
    private val detail = Regex("""olx\.bg/(?:d/)?ad/[^?#]*?-ID([A-Za-z0-9]+)\.html""")

    override fun searchUrls(area: Area, page: Int): List<String> {
        val place = if (area == Area.CITY) "ruse" else "oblast-ruse" // AROUND: whole oblast, city dropped later
        val p = if (page > 1) "&page=$page" else ""
        return listOf("https://www.olx.bg/nedvizhimi-imoti/prodazhbi/$place/?search%5Border%5D=created_at%3Adesc$p")
    }

    override fun parseSearch(html: String, pageUrl: String) =
        HtmlHeuristics.extractCards(Jsoup.parse(html, pageUrl), source, detail) { card ->
            // "Русе, Възраждане - Днес в 10:15"
            card.selectFirst("[data-testid=location-date]")?.text()?.substringBefore(" - ")
        }

    override fun parseDetails(html: String, url: String): ListingDetails {
        val doc: Document = Jsoup.parse(html, url)
        val details = HtmlHeuristics.extractDetails(doc, url)
        val price = doc.selectFirst("[data-testid=ad-price-container]")?.text()?.let(TextParsing::clean)
        val params = doc.select("[data-testid=ad-parameters-container] p, [data-testid=ad-parameters-container] li")
            .map { TextParsing.clean(it.text()) }
            .mapNotNull { t -> t.indexOf(':').takeIf { it > 0 }?.let { t.substring(0, it) to t.substring(it + 1).trim() } }
        val location = doc.selectFirst("[data-testid=map-aside-section], [data-testid=location-section]")
            ?.select("p")?.joinToString(", ") { it.text() }?.takeIf { it.isNotBlank() }
        return details.copy(
            priceText = price ?: details.priceText,
            attributes = (params + details.attributes).distinctBy { it.first.lowercase() },
            address = location ?: details.address,
        )
    }
}

val ALL_SOURCES: List<ListingSource> = listOf(ImotBg, AloBg, OlxBg)

fun sourceFor(source: Source): ListingSource = ALL_SOURCES.first { it.source == source }
