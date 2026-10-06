package bg.teokroze.imoti.core

import kotlinx.serialization.Serializable

@Serializable
enum class Source(val label: String, val host: String) {
    IMOT_BG("imot.bg", "www.imot.bg"),
    ALO_BG("alo.bg", "www.alo.bg"),
    OLX_BG("OLX", "www.olx.bg"),
}

/** Which part of the Ruse area a search covers. */
@Serializable
enum class Area(val label: String) {
    CITY("град Русе"),
    REGION("Русе + областта"),
}

@Serializable
enum class PropertyType(val label: String, val keywords: List<String>) {
    ROOM_1("Едностаен", listOf("едностаен", "1-стаен", "1 стаен", "гарсониера", "студио")),
    ROOM_2("Двустаен", listOf("двустаен", "2-стаен", "2 стаен")),
    ROOM_3("Тристаен", listOf("тристаен", "3-стаен", "3 стаен")),
    ROOM_4("4+ стаен / мезонет", listOf("четиристаен", "4-стаен", "многостаен", "мезонет", "мансарда")),
    HOUSE("Къща / вила", listOf("къща", "вила", "етаж от къща")),
    LAND("Парцел / земя", listOf("парцел", "земя", "нива", "лозе", "градина", "земеделск", "гора")),
    GARAGE("Гараж", listOf("гараж", "паркомясто")),
    COMMERCIAL("Офис / магазин / друго", listOf("офис", "магазин", "заведение", "склад", "хотел", "ателие", "помещение", "промишлен", "бизнес")),
    OTHER("Друго", emptyList());

    companion object {
        /** Guess the type from a listing title, e.g. "Продава 2-СТАЕН в град Русе". */
        fun detect(text: String): PropertyType {
            val t = text.lowercase()
            return entries.firstOrNull { type -> type.keywords.any { it in t } } ?: OTHER
        }
    }
}

/** A row in a search results page. */
@Serializable
data class Listing(
    val source: Source,
    val nativeId: String,
    val url: String,
    val title: String,
    val priceEur: Double? = null,
    val priceText: String = "",
    val areaSqm: Double? = null,
    val location: String = "",
    val imageUrl: String? = null,
    val type: PropertyType = PropertyType.OTHER,
    /** Epoch millis when this app first saw the listing. */
    val firstSeen: Long = 0,
) {
    val id: String get() = "${source.name}:$nativeId"
}

/** Everything we could read from the listing page itself. */
@Serializable
data class ListingDetails(
    val url: String,
    val title: String,
    val description: String,
    val priceText: String,
    val images: List<String>,
    val phones: List<String>,
    val emails: List<String>,
    val contactName: String?,
    val address: String?,
    val attributes: List<Pair<String, String>>,
)

@Serializable
data class SearchFilter(
    val id: String,
    val name: String = "",
    val area: Area = Area.REGION,
    /** Empty means every type. */
    val types: Set<PropertyType> = emptySet(),
    val minPriceEur: Double? = null,
    val maxPriceEur: Double? = null,
    val minAreaSqm: Double? = null,
    val maxAreaSqm: Double? = null,
    /** Words that must all appear in the title or location, e.g. "център". */
    val keyword: String = "",
    val sources: Set<Source> = Source.entries.toSet(),
    val notify: Boolean = true,
) {
    fun matches(l: Listing): Boolean {
        if (l.source !in sources) return false
        if (types.isNotEmpty() && l.type !in types) return false
        // A listing with no price/area is kept: better to show it than silently hide it.
        if (minPriceEur != null && l.priceEur != null && l.priceEur < minPriceEur) return false
        if (maxPriceEur != null && l.priceEur != null && l.priceEur > maxPriceEur) return false
        if (minAreaSqm != null && l.areaSqm != null && l.areaSqm < minAreaSqm) return false
        if (maxAreaSqm != null && l.areaSqm != null && l.areaSqm > maxAreaSqm) return false
        if (keyword.isNotBlank()) {
            val hay = "${l.title} ${l.location}".lowercase()
            if (!keyword.lowercase().split(Regex("\\s+")).filter { it.isNotBlank() }.all { it in hay }) return false
        }
        return true
    }

    fun describe(): String = buildList {
        add(area.label)
        if (types.isNotEmpty()) add(types.joinToString { it.label })
        if (minPriceEur != null || maxPriceEur != null) add("€ ${minPriceEur?.toInt() ?: 0}–${maxPriceEur?.toInt() ?: "∞"}")
        if (minAreaSqm != null || maxAreaSqm != null) add("${minAreaSqm?.toInt() ?: 0}–${maxAreaSqm?.toInt() ?: "∞"} м²")
        if (keyword.isNotBlank()) add("„$keyword“")
    }.joinToString(" · ")
}
