package bg.teokroze.imoti.data

import bg.teokroze.imoti.core.Gazetteer
import bg.teokroze.imoti.core.GeoPoint
import bg.teokroze.imoti.core.GeoResult
import bg.teokroze.imoti.core.Listing
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

/** A map pin: all listings at one place (neighbourhood or village). */
data class MapGroup(val point: GeoPoint, val label: String, val listings: List<Listing>)

object Geocoder {
    private val json = Json { ignoreUnknownKeys = true }

    /**
     * Group [listings] by place. Known places resolve instantly; unknown villages are looked up on
     * OpenStreetMap Nominatim (max 1 request/second, results cached in [store]).
     * [onProgress] is called with the groups found so far, so the map fills in gradually.
     */
    suspend fun group(store: Store, listings: List<Listing>, onProgress: (List<MapGroup>) -> Unit): List<MapGroup> {
        val placed = LinkedHashMap<String, Triple<GeoPoint, String, MutableList<Listing>>>()
        val pending = LinkedHashMap<String, Pair<String, MutableList<Listing>>>()

        fun add(p: GeoPoint, label: String, l: Listing) {
            placed.getOrPut(label) { Triple(p, label, mutableListOf()) }.third += l
        }
        fun snapshot() = placed.values.map { MapGroup(it.first, it.second, it.third.toList()) }

        for (l in listings) {
            when (val r = Gazetteer.resolve(l.location, l.title)) {
                is GeoResult.Known -> add(r.point, r.label, l)
                is GeoResult.Lookup -> {
                    val cache = store.state.value.geoCache
                    if (cache.containsKey(r.query)) cache[r.query]?.let { add(it, r.label, l) }
                    else pending.getOrPut(r.query) { r.label to mutableListOf() }.second += l
                }
                null -> Unit
            }
        }
        onProgress(snapshot())

        for ((query, labelAndListings) in pending) {
            val result = runCatching { lookup(query) }
            // Cache "not found" too, but not network errors (those are retried next time).
            if (result.isSuccess) store.update { it.copy(geoCache = it.geoCache + (query to result.getOrNull())) }
            val point = result.getOrNull()
            if (point != null) {
                labelAndListings.second.forEach { add(point, labelAndListings.first, it) }
                onProgress(snapshot())
            }
            delay(1100) // Nominatim usage policy: at most 1 request per second
        }
        return snapshot()
    }

    private suspend fun lookup(query: String): GeoPoint? = withContext(Dispatchers.IO) {
        val url = URL(
            "https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=bg&accept-language=bg&q=" +
                URLEncoder.encode(query, "UTF-8"),
        )
        val conn = (url.openConnection() as HttpURLConnection).apply {
            setRequestProperty("User-Agent", "ImotiRuse/1.2 (personal Android app)")
            connectTimeout = 10_000
            readTimeout = 10_000
        }
        try {
            val body = conn.inputStream.bufferedReader().use { it.readText() }
            val first = json.parseToJsonElement(body).jsonArray.firstOrNull()?.jsonObject ?: return@withContext null
            val lat = first["lat"]?.jsonPrimitive?.content?.toDoubleOrNull()
            val lon = first["lon"]?.jsonPrimitive?.content?.toDoubleOrNull()
            // Sanity check: stay roughly inside Ruse oblast.
            if (lat == null || lon == null || lat !in 43.3..44.1 || lon !in 25.4..26.6) null else GeoPoint(lat, lon)
        } finally {
            conn.disconnect()
        }
    }
}
