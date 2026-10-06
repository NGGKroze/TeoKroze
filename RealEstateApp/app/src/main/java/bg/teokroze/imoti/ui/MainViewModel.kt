package bg.teokroze.imoti.ui

import android.app.Application
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import bg.teokroze.imoti.core.Duplicates
import bg.teokroze.imoti.core.Listing
import bg.teokroze.imoti.core.ListingDetails
import bg.teokroze.imoti.core.PropertyType
import bg.teokroze.imoti.core.SearchFilter
import bg.teokroze.imoti.core.Stats
import bg.teokroze.imoti.data.DealStatus
import bg.teokroze.imoti.data.Geocoder
import bg.teokroze.imoti.data.MapGroup
import bg.teokroze.imoti.data.Repository
import bg.teokroze.imoti.data.Store
import bg.teokroze.imoti.work.CheckWorker
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import java.util.UUID

enum class Tab(val label: String) { SEARCH("Търсене"), MAP("Карта"), FAVORITES("Любими"), NEWS("Нови"), ALERTS("Профили") }

enum class MapSource(val label: String) { RESULTS("Резултати"), FAVORITES("Любими"), NEWS("Нови") }

enum class Sort(val label: String) {
    NEWEST("Най-нови"), PRICE_ASC("Цена ↑"), PRICE_DESC("Цена ↓"), PRICE_SQM("€/м² ↑");

    fun apply(list: List<Listing>): List<Listing> = when (this) {
        NEWEST -> list
        PRICE_ASC -> list.sortedWith(compareBy<Listing, Double?>(nullsLast()) { it.priceEur })
        PRICE_DESC -> list.sortedWith(compareByDescending<Listing, Double?>(nullsFirst()) { it.priceEur })
        PRICE_SQM -> list.sortedWith(compareBy<Listing, Double?>(nullsLast()) { l -> l.areaSqm?.takeIf { it > 0 }?.let { a -> l.priceEur?.div(a) } })
    }
}

class MainViewModel(app: Application) : AndroidViewModel(app) {
    val store = Store.get(app)

    var tab by mutableStateOf(Tab.SEARCH)
    var filter by mutableStateOf(SearchFilter(id = newId()))
    var sort by mutableStateOf(Sort.NEWEST)
    private var rawResults by mutableStateOf<List<Listing>>(emptyList())
    /** Same property found on several sites: listing id -> its copies elsewhere. */
    var duplicates by mutableStateOf<Map<String, List<Listing>>>(emptyMap())
        private set
    var collapseDuplicates by mutableStateOf(true)
    val results: List<Listing>
        get() = sort.apply(if (collapseDuplicates) Duplicates.collapse(rawResults, duplicates) else rawResults)
    /** Listings this search returned that the app had never seen before. */
    var newIds by mutableStateOf<Set<String>>(emptySet())
        private set
    /** Median €/m² per type over the last results + favorites, for "cheaper than average" hints. */
    val medians: Map<PropertyType, Double>
        get() = Stats.medianPerSqm((rawResults + store.state.value.favorites).distinctBy { it.id })
    var loading by mutableStateOf(false)
        private set
    var searched by mutableStateOf(false)
        private set
    var errors by mutableStateOf<List<String>>(emptyList())
        private set

    var opened by mutableStateOf<Listing?>(null)
        private set
    var details by mutableStateOf<ListingDetails?>(null)
        private set
    var detailsError by mutableStateOf<String?>(null)
        private set
    private var detailsJob: Job? = null

    fun search() {
        viewModelScope.launch {
            loading = true
            errors = emptyList()
            val res = runCatching { Repository.search(filter, pages = 3) }
            res.onSuccess { r ->
                // On the very first search everything is "new", which isn't useful to highlight.
                val firstEver = store.state.value.prices.isEmpty()
                val fresh = store.recordPrices(r.listings).first
                newIds = if (firstEver) emptySet() else fresh
                duplicates = Duplicates.find(r.listings)
                rawResults = r.listings
                errors = r.errors
            }
                .onFailure { errors = listOf(it.message ?: "Грешка при търсене") }
            searched = true
            loading = false
        }
    }

    fun open(listing: Listing) {
        store.markViewed(listing.id)
        opened = listing
        details = null
        detailsError = null
        detailsJob?.cancel()
        detailsJob = viewModelScope.launch {
            runCatching { Repository.details(listing) }
                .onSuccess { details = it }
                .onFailure { detailsError = it.message ?: "Неуспешно зареждане" }
        }
    }

    fun close() {
        detailsJob?.cancel()
        opened = null
        details = null
    }

    fun toggleFavorite(listing: Listing) = store.toggleFavorite(listing)

    fun hide(listing: Listing) {
        store.setHidden(listing.id, true)
        if (opened?.id == listing.id) close()
    }

    fun unhideAll() = store.update { it.copy(hidden = emptyList()) }

    /** Favorites tab: show only this status (null = all). */
    var favoriteStatus by mutableStateOf<DealStatus?>(null)

    // ---------- Map ----------

    var mapSource by mutableStateOf(MapSource.RESULTS)
    var mapGroups by mutableStateOf<List<MapGroup>>(emptyList())
        private set
    var mapLoading by mutableStateOf(false)
        private set
    var mapSelected by mutableStateOf<MapGroup?>(null)
    private var mapJob: Job? = null

    fun mapListings(): List<Listing> {
        val d = store.state.value
        val hidden = d.hidden.toHashSet()
        return when (mapSource) {
            MapSource.RESULTS -> results
            MapSource.FAVORITES -> d.favorites
            MapSource.NEWS -> d.hits.map { it.listing }.distinctBy { it.id }
        }.filter { it.id !in hidden }
    }

    fun loadMap() {
        mapJob?.cancel()
        mapSelected = null
        val listings = mapListings()
        mapJob = viewModelScope.launch {
            mapLoading = true
            mapGroups = emptyList()
            Geocoder.group(store, listings) { mapGroups = it }
            mapLoading = false
        }
    }

    /** Profile open in the editor; null when the editor is closed. */
    var editing by mutableStateOf<SearchFilter?>(null)
    /** News tab: show hits of this profile only (null = all). */
    var newsProfile by mutableStateOf<String?>(null)

    fun newProfile(template: SearchFilter? = null) {
        editing = (template ?: SearchFilter(id = "")).copy(id = newId())
    }

    fun newProfileFromSearch() {
        editing = filter.copy(id = newId(), name = "")
    }

    fun editProfile(p: SearchFilter) {
        editing = p
    }

    fun cancelEdit() {
        editing = null
    }

    /** Insert or update a profile. New or changed criteria get a fresh baseline so old listings don't notify. */
    fun saveProfile(p: SearchFilter) {
        val old = store.state.value.searches.firstOrNull { it.id == p.id }
        val criteriaChanged = old == null || !old.sameCriteria(p)
        // If the current search results are for exactly these criteria, use them as the baseline right away.
        val baseline = if (criteriaChanged && searched && filter.sameCriteria(p)) rawResults.map { it.id } else null
        val now = System.currentTimeMillis()
        store.update { d ->
            val searches = if (old == null) d.searches + p else d.searches.map { if (it.id == p.id) p else it }
            when {
                !criteriaChanged -> d.copy(searches = searches)
                baseline != null -> d.copy(searches = searches, seen = d.seen + (p.id to baseline), lastRun = d.lastRun + (p.id to now))
                else -> d.copy(searches = searches, seen = d.seen - p.id, lastRun = d.lastRun - p.id)
            }
        }
        if (criteriaChanged && baseline == null) CheckWorker.baseline(getApplication(), p.id)
        editing = null
    }

    fun deleteSearch(id: String) = store.update { d ->
        d.copy(
            searches = d.searches.filterNot { it.id == id },
            seen = d.seen - id,
            lastRun = d.lastRun - id,
            hits = d.hits.filterNot { it.profileId == id },
        )
    }

    fun setNotify(id: String, on: Boolean) = store.update { d ->
        d.copy(searches = d.searches.map { if (it.id == id) it.copy(notify = on) else it })
    }

    fun runSaved(f: SearchFilter) {
        filter = f.copy(id = newId())
        tab = Tab.SEARCH
        search()
    }

    fun checkNow() = CheckWorker.runNow(getApplication())

    fun clearNews() = store.update { d ->
        val p = newsProfile
        d.copy(hits = if (p == null) emptyList() else d.hits.filterNot { it.profileId == p })
    }

    private fun newId() = UUID.randomUUID().toString()
}
