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
import androidx.work.workDataOf
import bg.teokroze.imoti.data.Hit
import bg.teokroze.imoti.data.Repository
import bg.teokroze.imoti.data.Store
import java.util.Calendar
import java.util.concurrent.TimeUnit

/**
 * Wakes up every 30 minutes and runs each notification profile whose own interval has passed
 * (and that isn't in its quiet hours). Notifies only when a profile finds listings it hasn't seen.
 */
class CheckWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        val store = Store.get(applicationContext)
        val force = inputData.getBoolean(KEY_FORCE, false)
        val only = inputData.getString(KEY_ONLY)
        val now = System.currentTimeMillis()
        val hour = Calendar.getInstance().get(Calendar.HOUR_OF_DAY)

        val profiles = store.state.value.searches.filter { it.notify && (only == null || it.id == only) }
        for (profile in profiles) {
            val settings = profile.settings
            val seen = store.state.value.seen[profile.id]
            val baseline = seen == null
            if (!baseline && !force) {
                if (settings.isQuiet(hour)) continue
                val last = store.state.value.lastRun[profile.id] ?: 0L
                if (now - last < TimeUnit.MINUTES.toMillis(settings.frequency.minutes - SLACK_MINUTES)) continue
            }

            val result = runCatching { Repository.search(profile, pages = 3) }.getOrNull() ?: continue
            // A site that is down must not make all its listings look "new" next time.
            if (result.listings.isEmpty()) continue

            val seenSet = seen?.toHashSet()
            val fresh = if (seenSet == null) emptyList() else result.listings.filter { it.id !in seenSet }
            store.update { d ->
                val ids = (result.listings.map { it.id } + seen.orEmpty()).distinct().take(MAX_SEEN)
                d.copy(
                    seen = d.seen + (profile.id to ids),
                    lastRun = d.lastRun + (profile.id to now),
                    hits = (fresh.map { Hit(it, profile.id, profile.name, now) } + d.hits)
                        .distinctBy { it.profileId + it.listing.id }
                        .take(MAX_HITS),
                )
            }
            if (fresh.isNotEmpty()) Notifier.notifyNew(applicationContext, profile, fresh)
        }
        store.update { it.copy(lastCheck = now) }
        return Result.success()
    }

    companion object {
        private const val PERIODIC = "check-new-listings"
        private const val ONCE = "check-now"
        private const val KEY_FORCE = "force"
        private const val KEY_ONLY = "only"
        private const val MAX_SEEN = 3000
        private const val MAX_HITS = 300
        /** The periodic job drifts a bit; don't skip a profile that is just a few minutes early. */
        private const val SLACK_MINUTES = 15L

        private val constraints = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()

        fun schedule(context: Context) {
            val req = PeriodicWorkRequestBuilder<CheckWorker>(30, TimeUnit.MINUTES)
                .setConstraints(constraints)
                .build()
            WorkManager.getInstance(context).enqueueUniquePeriodicWork(PERIODIC, ExistingPeriodicWorkPolicy.UPDATE, req)
        }

        /** Check every profile now, ignoring intervals and quiet hours. */
        fun runNow(context: Context) = enqueue(context, workDataOf(KEY_FORCE to true), ONCE)

        /** Record what a new/changed profile currently sees, so only later listings notify. */
        fun baseline(context: Context, profileId: String) =
            enqueue(context, workDataOf(KEY_ONLY to profileId), "baseline-$profileId")

        private fun enqueue(context: Context, data: androidx.work.Data, name: String) {
            val req = OneTimeWorkRequestBuilder<CheckWorker>().setConstraints(constraints).setInputData(data).build()
            WorkManager.getInstance(context).enqueueUniqueWork(name, ExistingWorkPolicy.REPLACE, req)
        }
    }
}
