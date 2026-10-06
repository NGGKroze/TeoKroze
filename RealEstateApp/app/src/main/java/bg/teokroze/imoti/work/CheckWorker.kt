package bg.teokroze.imoti.work

import android.content.Context
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import bg.teokroze.imoti.data.Repository
import bg.teokroze.imoti.data.Store
import java.util.concurrent.TimeUnit

/** Periodically re-runs every saved search and notifies about listings it hasn't seen before. */
class CheckWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        val store = Store.get(applicationContext)
        val searches = store.state.value.searches.filter { it.notify }
        for (filter in searches) {
            val result = runCatching { Repository.search(filter, pages = 3) }.getOrNull() ?: continue
            // A site that is down must not make all its listings look "new" next time.
            if (result.listings.isEmpty()) continue
            val seen = store.state.value.seen[filter.id]
            val seenSet = seen?.toHashSet()
            val fresh = if (seenSet == null) emptyList() else result.listings.filter { it.id !in seenSet }
            store.update { d ->
                val ids = (result.listings.map { it.id } + seen.orEmpty()).distinct().take(MAX_SEEN)
                d.copy(
                    seen = d.seen + (filter.id to ids),
                    news = (fresh + d.news).distinctBy { it.id }.take(MAX_NEWS),
                )
            }
            if (fresh.isNotEmpty()) Notifier.notifyNew(applicationContext, filter, fresh)
        }
        store.update { it.copy(lastCheck = System.currentTimeMillis()) }
        return Result.success()
    }

    companion object {
        private const val PERIODIC = "check-new-listings"
        private const val ONCE = "check-now"
        private const val MAX_SEEN = 3000
        private const val MAX_NEWS = 200

        private val constraints = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()

        fun schedule(context: Context, intervalMinutes: Long = 60) {
            val req = PeriodicWorkRequestBuilder<CheckWorker>(intervalMinutes, TimeUnit.MINUTES)
                .setConstraints(constraints)
                .build()
            WorkManager.getInstance(context).enqueueUniquePeriodicWork(PERIODIC, ExistingPeriodicWorkPolicy.UPDATE, req)
        }

        fun runNow(context: Context) {
            val req = OneTimeWorkRequestBuilder<CheckWorker>().setConstraints(constraints).build()
            WorkManager.getInstance(context).enqueueUniqueWork(ONCE, ExistingWorkPolicy.REPLACE, req)
        }
    }
}
