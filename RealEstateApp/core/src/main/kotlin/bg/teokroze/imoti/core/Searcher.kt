package bg.teokroze.imoti.core

import bg.teokroze.imoti.core.sources.ALL_SOURCES
import bg.teokroze.imoti.core.sources.ListingSource
import bg.teokroze.imoti.core.sources.sourceFor
import org.jsoup.Jsoup

fun interface Fetcher {
    fun get(url: String): String
}

/** Plain Jsoup fetcher; Jsoup also handles imot.bg's windows-1251 pages. */
object JsoupFetcher : Fetcher {
    private const val UA =
        "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36"

    override fun get(url: String): String =
        Jsoup.connect(url)
            .userAgent(UA)
            .header("Accept-Language", "bg-BG,bg;q=0.9,en;q=0.5")
            .timeout(20_000)
            .followRedirects(true)
            .get()
            .outerHtml()
}

data class SearchResult(
    val listings: List<Listing>,
    /** One message per URL that failed, so the UI can show "OLX не отговаря". */
    val errors: List<String>,
)

class Searcher(
    private val fetcher: Fetcher = JsoupFetcher,
    private val sources: List<ListingSource> = ALL_SOURCES,
) {
    /** Fetch [pages] result pages per site and keep what matches [filter]. */
    fun search(filter: SearchFilter, pages: Int = 2): SearchResult {
        val all = LinkedHashMap<String, Listing>()
        val errors = mutableListOf<String>()
        for (src in sources.filter { it.source in filter.sources }) {
            for (page in 1..pages) {
                var gotAny = false
                for (url in src.searchUrls(filter.area, page)) {
                    try {
                        val found = src.parseSearch(fetcher.get(url), url)
                        if (found.isNotEmpty()) gotAny = true
                        found.forEach { all.putIfAbsent(it.id, it) }
                    } catch (e: Exception) {
                        if (page == 1) errors += "${src.source.label}: ${e.message ?: e::class.simpleName}"
                    }
                }
                if (!gotAny) break
            }
        }
        val filtered = all.values.filter { filter.matches(it) && inArea(it, filter.area) }
        return SearchResult(filtered, errors)
    }

    fun details(listing: Listing): ListingDetails {
        val src = sourceFor(listing.source)
        return src.parseDetails(fetcher.get(listing.url), listing.url)
    }

    private fun inArea(l: Listing, area: Area): Boolean = when (area) {
        Area.REGION -> true
        // City search: drop obvious village listings that slipped in.
        Area.CITY -> !Regex("""(^|\s)(с\.|село)\s""").containsMatchIn("${l.location} ${l.title}".lowercase())
        Area.AROUND -> !isRuseCity(l)
    }

    companion object {
        private val cityPattern = Regex("""(град|гр\.)\s*русе|^русе(?![а-я])""")

        /** True when the listing is in the city of Ruse itself (not a village or another town in the oblast). */
        fun isRuseCity(l: Listing): Boolean {
            val loc = l.location.lowercase().trim()
            if (loc.isNotEmpty()) return cityPattern.containsMatchIn(loc)
            return cityPattern.containsMatchIn(l.title.lowercase())
        }
    }
}
