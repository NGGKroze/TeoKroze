package bg.teokroze.imoti.core

import kotlinx.serialization.Serializable

@Serializable
data class GeoPoint(val lat: Double, val lon: Double)

/** Where a listing goes on the map. Listings rarely have street addresses, so this is neighbourhood/village level. */
sealed interface GeoResult {
    /** Resolved from the built-in list. */
    data class Known(val point: GeoPoint, val label: String) : GeoResult

    /** A place we don't know; the app geocodes [query] online (OpenStreetMap Nominatim) and caches it. */
    data class Lookup(val query: String, val label: String) : GeoResult
}

/**
 * Built-in coordinates for Ruse neighbourhoods and the larger towns in the oblast.
 * Neighbourhood points are approximate centres, good enough to group listings on a map.
 */
object Gazetteer {
    val RUSE_CENTER = GeoPoint(43.8487, 25.9534)

    private val neighbourhoods: List<Pair<String, GeoPoint>> = listOf(
        "широк център" to GeoPoint(43.8440, 25.9610),
        "център" to GeoPoint(43.8487, 25.9534),
        "възраждане" to GeoPoint(43.8545, 25.9700),
        "алеи възраждане" to GeoPoint(43.8520, 25.9665),
        "дружба 1" to GeoPoint(43.8455, 25.9935),
        "дружба 2" to GeoPoint(43.8380, 25.9990),
        "дружба 3" to GeoPoint(43.8405, 26.0105),
        "дружба" to GeoPoint(43.8410, 26.0000),
        "здравец изток" to GeoPoint(43.8265, 26.0010),
        "здравец север" to GeoPoint(43.8375, 25.9840),
        "здравец" to GeoPoint(43.8320, 25.9860),
        "чародейка юг" to GeoPoint(43.8255, 25.9600),
        "чародейка север" to GeoPoint(43.8335, 25.9580),
        "чародейка" to GeoPoint(43.8300, 25.9590),
        "родина 1" to GeoPoint(43.8400, 25.9400),
        "родина 2" to GeoPoint(43.8350, 25.9350),
        "родина 3" to GeoPoint(43.8285, 25.9400),
        "родина 4" to GeoPoint(43.8250, 25.9480),
        "родина" to GeoPoint(43.8330, 25.9400),
        "ялта" to GeoPoint(43.8530, 25.9850),
        "хъшове" to GeoPoint(43.8450, 25.9720),
        "изгрев" to GeoPoint(43.8560, 25.9930),
        "ален мак" to GeoPoint(43.8220, 25.9750),
        "типово" to GeoPoint(43.8350, 25.9200),
        "средна кула" to GeoPoint(43.8180, 25.9550),
        "долапите" to GeoPoint(43.8000, 25.9850),
        "мидия енос" to GeoPoint(43.8320, 25.9250),
        "цветница" to GeoPoint(43.8220, 26.0200),
        "сарая" to GeoPoint(43.8350, 25.8900),
        "дзс" to GeoPoint(43.8400, 25.9100),
        "новата махала" to GeoPoint(43.8420, 25.9450),
        "кв. тракция" to GeoPoint(43.8380, 25.9650),
        "тракция" to GeoPoint(43.8380, 25.9650),
        "захарния завод" to GeoPoint(43.8240, 25.9330),
        "работническа" to GeoPoint(43.8420, 25.9800),
    ).sortedByDescending { it.first.length } // "широк център" before "център", "дружба 3" before "дружба"

    private val towns: Map<String, GeoPoint> = mapOf(
        "русе" to RUSE_CENTER,
        "бяла" to GeoPoint(43.4608, 25.7414),
        "две могили" to GeoPoint(43.5925, 25.8731),
        "ветово" to GeoPoint(43.7000, 26.2667),
        "сливо поле" to GeoPoint(43.9436, 26.2058),
        "мартен" to GeoPoint(43.9214, 26.0814),
        "ценово" to GeoPoint(43.5361, 25.6528),
        "иваново" to GeoPoint(43.6875, 25.9583),
        "борово" to GeoPoint(43.4278, 25.8083),
        "басарбово" to GeoPoint(43.7850, 25.9600),
        "образцов чифлик" to GeoPoint(43.8000, 26.0170),
    )

    private val placePattern = Regex("""(?:село|с\.|град|гр\.)\s*([А-Яа-я][А-Яа-я\-]+(?:\s[А-Я][а-я\-]+)?)""")

    fun resolve(location: String, title: String = ""): GeoResult? {
        val loc = location.lowercase()
        val all = "$loc ${title.lowercase()}"

        // An explicit village/town ("село Николово", "гр. Бяла")
        placePattern.find("$location $title")?.groupValues?.get(1)?.trim()?.let { name ->
            val key = name.lowercase()
            if (key != "русе") {
                towns[key]?.let { return GeoResult.Known(it, name) }
                return GeoResult.Lookup("$name, област Русе", name)
            }
        }
        val inRuse = "русе" in all
        if (inRuse || loc.isNotBlank()) {
            neighbourhoods.firstOrNull { (name, _) -> name in all }?.let { (name, p) ->
                return GeoResult.Known(p, "Русе, " + name.replaceFirstChar { it.uppercase() })
            }
        }
        // "Николово, Русе" / "Бяла" style OLX locations: first comma part
        val first = location.substringBefore(',').trim()
        if (first.isNotEmpty() && first.lowercase() != "русе" && first.lowercase() != "област русе") {
            towns[first.lowercase()]?.let { return GeoResult.Known(it, first) }
            if (first.first().isUpperCase() && first.length in 3..30) return GeoResult.Lookup("$first, област Русе", first)
        }
        return if (inRuse) GeoResult.Known(RUSE_CENTER, "Русе") else null
    }
}
