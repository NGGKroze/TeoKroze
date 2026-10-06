package bg.teokroze.imoti.core

import org.jsoup.nodes.Document
import org.jsoup.nodes.Element

/**
 * Site-agnostic extraction. Each site only tells us what a listing URL looks like;
 * cards are found by climbing from those links, so small redesigns don't break parsing.
 */
object HtmlHeuristics {
    private val locationPattern = Regex(
        """(?:град|гр\.|село|с\.)\s*[А-Я][А-Яа-я\-]+(?:\s[А-Я][а-я\-]+)?(?:\s*,\s*(?:кв\.\s*)?[А-Я][А-Яа-я\-\s]{2,30}?(?=[,.\d\-–|]|\s{2}|$))?"""
    )

    fun idOf(url: String, detailUrl: Regex): String? = detailUrl.find(url)?.groupValues?.get(1)

    fun extractCards(
        doc: Document,
        source: Source,
        detailUrl: Regex,
        locationOf: (Element) -> String? = { null },
    ): List<Listing> {
        val linksById = LinkedHashMap<String, MutableList<Element>>()
        for (a in doc.select("a[href]")) {
            val id = idOf(a.absUrl("href"), detailUrl) ?: continue
            linksById.getOrPut(id) { mutableListOf() }.add(a)
        }
        return linksById.map { (id, links) ->
            val card = findCard(links.first(), id, detailUrl)
            val text = TextParsing.clean(card.text())
            val title = bestTitle(links, card)
            val location = locationOf(card)?.takeIf { it.isNotBlank() } ?: findLocation("$title $text")
            Listing(
                source = source,
                nativeId = id,
                url = links.first().absUrl("href").substringBefore('#'),
                title = title,
                priceEur = TextParsing.parsePriceEur(text),
                priceText = TextParsing.priceText(text),
                areaSqm = TextParsing.parseAreaSqm(title) ?: TextParsing.parseAreaSqm(text),
                location = location,
                imageUrl = firstImage(card),
                type = PropertyType.detect(title).takeIf { it != PropertyType.OTHER } ?: PropertyType.detect(text.take(200)),
            )
        }
    }

    /** Largest ancestor (up to 8 levels) that still contains only this listing's links. */
    private fun findCard(link: Element, id: String, detailUrl: Regex): Element {
        var current = link
        repeat(8) {
            val parent = current.parent() ?: return current
            if (parent.tagName() == "body") return current
            val foreign = parent.select("a[href]").any { a ->
                val other = idOf(a.absUrl("href"), detailUrl)
                other != null && other != id
            }
            if (foreign) return current
            current = parent
        }
        return current
    }

    private fun bestTitle(links: List<Element>, card: Element): String {
        val candidates = links.flatMap { listOf(it.text(), it.attr("title")) } +
            card.select("h1,h2,h3,h4,h5,h6,[class*=title]").map { it.text() }
        return candidates.map(TextParsing::clean)
            .filter { it.length in 4..200 }
            .maxByOrNull { it.length }
            ?: TextParsing.clean(card.text()).take(120)
    }

    fun firstImage(root: Element): String? =
        root.select("img, source, [data-src], [style*=background]").asSequence()
            .mapNotNull(::imageUrl)
            .firstOrNull()

    fun imageUrl(el: Element): String? {
        val candidates = listOf("data-src", "data-original", "data-lazy", "data-srcset", "srcset", "src")
            .map { el.absUrl(it).ifEmpty { el.attr(it) } } +
            Regex("""url\(['"]?([^'")]+)""").find(el.attr("style"))?.groupValues?.get(1).orEmpty()
        return candidates.asSequence()
            .map { it.trim().split(Regex("\\s+")).first().split(",").first() }
            .map { if (it.startsWith("//")) "https:$it" else it }
            .firstOrNull { it.startsWith("http") && looksLikePhoto(it) }
    }

    private fun looksLikePhoto(url: String): Boolean {
        val u = url.lowercase()
        if (listOf("logo", "icon", "sprite", "avatar", "banner", "placeholder", "blank.gif", ".svg", "pixel", "flag").any { it in u }) return false
        return true
    }

    fun findLocation(text: String): String {
        locationPattern.find(text)?.let { return TextParsing.clean(it.value).trimEnd(',', '-', ' ') }
        return if ("русе" in text.lowercase()) "Русе" else ""
    }

    /** Generic listing-page parser: meta tags, JSON-LD, tel:/mailto: links, tables, description blocks. */
    fun extractDetails(doc: Document, url: String, extraPhones: List<String> = emptyList()): ListingDetails {
        val og = { p: String -> doc.select("meta[property=$p], meta[name=$p]").attr("content").trim() }
        val jsonLd = doc.select("script[type=application/ld+json]").joinToString("\n") { it.data() }
        val title = TextParsing.clean(doc.selectFirst("h1")?.text().orEmpty()).ifEmpty { og("og:title") }.ifEmpty { doc.title() }

        val description = doc.select("[itemprop=description], [class*=descr], [id*=descr], [data-cy*=description], [data-testid*=description]")
            .map { TextParsing.clean(it.wholeText().ifBlank { it.text() }) }
            .maxByOrNull { it.length }
            ?.takeIf { it.length > 30 }
            ?: og("og:description").ifEmpty { og("description") }

        val bodyText = TextParsing.clean(doc.body()?.text().orEmpty())

        val telLinks = doc.select("a[href^=tel:]").map { TextParsing.normalizePhone(it.attr("href").removePrefix("tel:")) }
        val ldPhones = Regex(""""telephone"\s*:\s*"([^"]+)"""").findAll(jsonLd).map { TextParsing.normalizePhone(it.groupValues[1]) }.toList()
        val phones = (extraPhones + telLinks + ldPhones + TextParsing.findPhones(description) + TextParsing.findPhones(bodyText))
            .filter { it.length >= 9 }
            .distinct()
            .take(4)

        val mailLinks = doc.select("a[href^=mailto:]").map { it.attr("href").removePrefix("mailto:").substringBefore('?') }
        val emails = (mailLinks + TextParsing.findEmails(jsonLd) + TextParsing.findEmails(bodyText))
            .filterNot { e -> listOf("@olx.", "@imot.bg", "@alo.bg").any { it in e.lowercase() } }
            .distinct()
            .take(3)

        val images = (doc.select("meta[property=og:image]").map { it.attr("content") } +
            Regex(""""image"\s*:\s*\[?\s*"([^"]+)"""").findAll(jsonLd).map { it.groupValues[1] } +
            doc.select("img, [data-src], a[href~=(?i)\\.(jpe?g|webp)]").mapNotNull { imageUrl(it) ?: it.absUrl("href").takeIf { h -> h.isNotEmpty() } })
            .map { if (it.startsWith("//")) "https:$it" else it }
            .filter { it.startsWith("http") && looksLikePhoto(it) && Regex("(?i)\\.(jpe?g|webp|png)|/image|/photo|/pics|img").containsMatchIn(it) }
            .distinctBy { it.substringBefore('?').substringAfterLast('/') }
            .take(25)

        val contactName = doc.select(
            "[class*=contact] [class*=name], [class*=agency] [class*=name], [class*=seller] [class*=name], [class*=user-name], [class*=userName], [data-testid=user-profile-user-name], [class*=broker], [class*=agent-name]"
        ).map { TextParsing.clean(it.text()) }.firstOrNull { it.length in 2..80 }

        val attributes = extractAttributes(doc)
        val address = attributes.firstOrNull { (k, _) -> k.lowercase().let { "адрес" in it || "локация" in it || "местоположение" in it || "район" in it || "квартал" in it } }?.second
            ?: findLocation("$title $description").ifEmpty { null }

        return ListingDetails(
            url = url,
            title = title,
            description = description,
            priceText = TextParsing.priceText(title).ifEmpty { TextParsing.priceText(bodyText) },
            images = images,
            phones = phones,
            emails = emails,
            contactName = contactName,
            address = address,
            attributes = attributes,
        )
    }

    private fun extractAttributes(doc: Document): List<Pair<String, String>> {
        val out = mutableListOf<Pair<String, String>>()
        fun add(k: String, v: String) {
            val key = TextParsing.clean(k).trimEnd(':')
            val value = TextParsing.clean(v)
            if (key.any { it.isDigit() }) return
            if (key.length in 2..40 && value.length in 1..120 && out.none { it.first.equals(key, true) }) out += key to value
        }
        doc.select("tr").forEach { tr ->
            val cells = tr.select("> th, > td")
            if (cells.size == 2) add(cells[0].text(), cells[1].text())
        }
        doc.select("dl").forEach { dl ->
            dl.select("> dt").forEach { dt -> dt.nextElementSibling()?.takeIf { it.tagName() == "dd" }?.let { add(dt.text(), it.text()) } }
        }
        doc.select("li, p, div").forEach { el ->
            if (el.childrenSize() > 3) return@forEach
            val t = TextParsing.clean(el.text())
            val idx = t.indexOf(':')
            if (t.length in 5..90 && idx in 2..35) add(t.substring(0, idx), t.substring(idx + 1))
        }
        return out.take(30)
    }
}
