package bg.teokroze.imoti.data

import android.content.Context
import bg.teokroze.imoti.core.GeoPoint
import bg.teokroze.imoti.core.Listing
import bg.teokroze.imoti.core.PriceHistory
import bg.teokroze.imoti.core.PricePoint
import bg.teokroze.imoti.core.SearchFilter
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import java.io.File

/** A listing found by a notification profile. */
@Serializable
data class Hit(
    val listing: Listing,
    val profileId: String,
    val profileName: String,
    val at: Long,
)

@Serializable
enum class DealStatus(val label: String) {
    NONE("Без статус"),
    TO_CALL("За обаждане"),
    CALLED("Обадихме се"),
    VIEWING("Оглед"),
    LIKED("Харесваме"),
    REJECTED("Отпада"),
}

@Serializable
data class Note(val text: String = "", val status: DealStatus = DealStatus.NONE)

/** A favorite whose price went down since we last saw it. */
data class PriceDrop(val listing: Listing, val from: Double, val to: Double)

@Serializable
data class StoreData(
    val favorites: List<Listing> = emptyList(),
    /** Notification profiles (saved searches). */
    val searches: List<SearchFilter> = emptyList(),
    /** Profile id -> listing ids already seen, so only new ones are notified. */
    val seen: Map<String, List<String>> = emptyMap(),
    /** Profile id -> when it was last checked. */
    val lastRun: Map<String, Long> = emptyMap(),
    /** New listings found by profiles, newest first. */
    val hits: List<Hit> = emptyList(),
    val lastCheck: Long = 0,
    /** Listing id -> price changes over time. */
    val prices: Map<String, List<PricePoint>> = emptyMap(),
    /** Listings opened at least once. */
    val viewed: List<String> = emptyList(),
    /** Listings the user doesn't want to see again (also never notified). */
    val hidden: List<String> = emptyList(),
    /** Listing id -> our own note and status. */
    val notes: Map<String, Note> = emptyMap(),
    /** Geocoding cache for places outside the built-in list; null = not found. */
    val geoCache: Map<String, GeoPoint?> = emptyMap(),
    /** Notify when a favorite gets cheaper. */
    val priceDropAlerts: Boolean = true,
)

/** Everything the app keeps lives in one small JSON file on the phone. */
class Store private constructor(context: Context) {
    private val file = File(context.filesDir, "store.json")
    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }
    private val _state = MutableStateFlow(load())
    val state: StateFlow<StoreData> = _state.asStateFlow()

    private fun load(): StoreData =
        runCatching { json.decodeFromString<StoreData>(file.readText()) }.getOrDefault(StoreData())

    @Synchronized
    fun update(change: (StoreData) -> StoreData) {
        val next = change(_state.value)
        _state.value = next
        val tmp = File(file.parentFile, "store.json.tmp")
        tmp.writeText(json.encodeToString(StoreData.serializer(), next))
        tmp.renameTo(file)
    }

    fun isFavorite(id: String) = _state.value.favorites.any { it.id == id }

    fun toggleFavorite(listing: Listing) = update { d ->
        if (d.favorites.any { it.id == listing.id }) d.copy(favorites = d.favorites.filterNot { it.id == listing.id })
        else d.copy(favorites = listOf(listing) + d.favorites)
    }

    /**
     * Record current prices. Returns ids seen for the first time and favorites that got cheaper.
     */
    fun recordPrices(listings: List<Listing>): Pair<Set<String>, List<PriceDrop>> {
        val now = System.currentTimeMillis()
        val firstTime = HashSet<String>()
        val drops = mutableListOf<PriceDrop>()
        update { d ->
            val prices = d.prices.toMutableMap()
            val favIds = d.favorites.map { it.id }.toHashSet()
            for (l in listings) {
                val eur = l.priceEur ?: continue
                val old = prices[l.id]
                if (old == null) firstTime += l.id
                val prev = old?.lastOrNull()?.eur
                if (prev != null && eur < prev - 1 && l.id in favIds) drops += PriceDrop(l, prev, eur)
                prices[l.id] = PriceHistory.record(old, eur, now)
            }
            // Keep the file small: favorites always, plus the most recently updated others.
            val trimmed = if (prices.size <= MAX_PRICES) prices else {
                val keep = prices.entries.sortedByDescending { it.value.last().at }.take(MAX_PRICES).map { it.key }.toHashSet() + favIds
                prices.filterKeys { it in keep }
            }
            // Favorites keep a copy of the listing: refresh its price/text.
            val byId = listings.associateBy { it.id }
            d.copy(
                prices = trimmed,
                favorites = d.favorites.map { f -> byId[f.id]?.copy(firstSeen = f.firstSeen) ?: f },
            )
        }
        return firstTime to drops
    }

    fun markViewed(id: String) = update { d ->
        if (id in d.viewed) d else d.copy(viewed = (listOf(id) + d.viewed).take(MAX_VIEWED))
    }

    fun setHidden(id: String, hide: Boolean) = update { d ->
        d.copy(hidden = if (hide) (d.hidden + id).distinct() else d.hidden - id)
    }

    fun setNote(id: String, note: Note) = update { d ->
        d.copy(notes = if (note.text.isBlank() && note.status == DealStatus.NONE) d.notes - id else d.notes + (id to note))
    }

    companion object {
        private const val MAX_PRICES = 4000
        private const val MAX_VIEWED = 5000

        @Volatile private var instance: Store? = null
        fun get(context: Context): Store =
            instance ?: synchronized(this) { instance ?: Store(context.applicationContext).also { instance = it } }
    }
}
