package bg.teokroze.imoti.data

import bg.teokroze.imoti.core.Listing
import bg.teokroze.imoti.core.ListingDetails
import bg.teokroze.imoti.core.SearchFilter
import bg.teokroze.imoti.core.SearchResult
import bg.teokroze.imoti.core.Searcher
import bg.teokroze.imoti.core.sources.ALL_SOURCES
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.withContext

object Repository {
    /** Query every selected site in parallel and merge the results. */
    suspend fun search(filter: SearchFilter, pages: Int): SearchResult = coroutineScope {
        val now = System.currentTimeMillis()
        ALL_SOURCES.filter { it.source in filter.sources }
            .map { src -> async(Dispatchers.IO) { Searcher(sources = listOf(src)).search(filter, pages) } }
            .awaitAll()
            .let { parts ->
                SearchResult(
                    listings = parts.flatMap { it.listings }.distinctBy { it.id }.map { it.copy(firstSeen = now) },
                    errors = parts.flatMap { it.errors },
                )
            }
    }

    suspend fun details(listing: Listing): ListingDetails =
        withContext(Dispatchers.IO) { Searcher().details(listing) }
}
