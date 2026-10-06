package bg.teokroze.imoti.core

import bg.teokroze.imoti.core.sources.ALL_SOURCES

/** Hits the real sites and prints what the parsers found: `gradle :core:liveCheck -PcoreOnly`. */
fun main() {
    val searcher = Searcher()
    for (src in ALL_SOURCES) {
        val res = searcher.search(SearchFilter("live", area = Area.REGION, sources = setOf(src.source)), pages = 1)
        println("== ${src.source.label}: ${res.listings.size} listings, errors=${res.errors}")
        res.listings.take(5).forEach { println("  ${it.type} | ${it.priceText} | ${it.areaSqm} | ${it.location} | ${it.title} | ${it.imageUrl}") }
        res.listings.firstOrNull()?.let { l ->
            runCatching { searcher.details(l) }
                .onSuccess { d -> println("  details: phones=${d.phones} emails=${d.emails} name=${d.contactName} addr=${d.address} imgs=${d.images.size} attrs=${d.attributes.take(6)}\n  descr=${d.description.take(160)}") }
                .onFailure { println("  details failed: $it") }
        }
    }
}
