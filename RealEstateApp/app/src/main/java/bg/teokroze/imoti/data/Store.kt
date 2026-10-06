package bg.teokroze.imoti.data

import android.content.Context
import bg.teokroze.imoti.core.Listing
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

    companion object {
        @Volatile private var instance: Store? = null
        fun get(context: Context): Store =
            instance ?: synchronized(this) { instance ?: Store(context.applicationContext).also { instance = it } }
    }
}
