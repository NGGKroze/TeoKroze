package bg.teokroze.imoti.ui

import android.app.Application
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import bg.teokroze.imoti.core.Listing
import bg.teokroze.imoti.core.ListingDetails
import bg.teokroze.imoti.core.SearchFilter
import bg.teokroze.imoti.data.Repository
import bg.teokroze.imoti.data.Store
import bg.teokroze.imoti.work.CheckWorker
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import java.util.UUID

enum class Tab(val label: String) { SEARCH("Търсене"), FAVORITES("Любими"), NEWS("Нови"), ALERTS("Известия") }

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
    val results: List<Listing> get() = sort.apply(rawResults)
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
            res.onSuccess { rawResults = it.listings; errors = it.errors }
                .onFailure { errors = listOf(it.message ?: "Грешка при търсене") }
            searched = true
            loading = false
        }
    }

    fun open(listing: Listing) {
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

    /** Save the current filter; the current results become the baseline so only later listings notify. */
    fun saveCurrentSearch(name: String) {
        val saved = filter.copy(id = newId(), name = name.trim(), notify = true)
        val baseline = if (searched) rawResults.map { it.id } else null
        store.update { d ->
            d.copy(
                searches = d.searches + saved,
                seen = if (baseline != null) d.seen + (saved.id to baseline) else d.seen,
            )
        }
        if (baseline == null) CheckWorker.runNow(getApplication())
    }

    fun deleteSearch(id: String) = store.update { d -> d.copy(searches = d.searches.filterNot { it.id == id }, seen = d.seen - id) }

    fun setNotify(id: String, on: Boolean) = store.update { d ->
        d.copy(searches = d.searches.map { if (it.id == id) it.copy(notify = on) else it })
    }

    fun runSaved(f: SearchFilter) {
        filter = f.copy(id = newId())
        tab = Tab.SEARCH
        search()
    }

    fun checkNow() = CheckWorker.runNow(getApplication())

    fun clearNews() = store.update { it.copy(news = emptyList()) }

    private fun newId() = UUID.randomUUID().toString()
}
