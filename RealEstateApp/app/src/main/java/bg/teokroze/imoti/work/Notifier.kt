package bg.teokroze.imoti.work

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import bg.teokroze.imoti.MainActivity
import bg.teokroze.imoti.R
import bg.teokroze.imoti.core.Listing
import bg.teokroze.imoti.core.SearchFilter
import kotlinx.serialization.json.Json

object Notifier {
    const val CHANNEL = "new_listings"
    const val EXTRA_LISTING = "listing"
    private const val GROUP = "bg.teokroze.imoti.NEW"

    fun createChannel(context: Context) {
        val channel = NotificationChannel(CHANNEL, "Нови имоти", NotificationManager.IMPORTANCE_DEFAULT).apply {
            description = "Нови обяви по запазените търсения"
        }
        context.getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }

    fun canNotify(context: Context): Boolean =
        Build.VERSION.SDK_INT < 33 ||
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

    fun notifyNew(context: Context, filter: SearchFilter, fresh: List<Listing>) {
        if (!canNotify(context)) return
        val nm = NotificationManagerCompat.from(context)
        val searchName = filter.name.ifBlank { filter.describe() }
        fresh.take(5).forEach { l ->
            val n = NotificationCompat.Builder(context, CHANNEL)
                .setSmallIcon(R.drawable.ic_notification)
                .setContentTitle(listOfNotNull(l.priceText.ifBlank { null }, l.areaSqm?.let { "${it.toInt()} м²" }, l.location.ifBlank { null }).joinToString(" · ").ifBlank { "Нов имот" })
                .setContentText(l.title)
                .setStyle(NotificationCompat.BigTextStyle().bigText("${l.title}\n${l.source.label} · $searchName"))
                .setContentIntent(openListingIntent(context, l))
                .setAutoCancel(true)
                .setGroup(GROUP)
                .build()
            try {
                nm.notify(l.id.hashCode(), n)
            } catch (_: SecurityException) {
                return
            }
        }
        if (fresh.size > 1) {
            val summary = NotificationCompat.Builder(context, CHANNEL)
                .setSmallIcon(R.drawable.ic_notification)
                .setContentTitle("${fresh.size} нови имота")
                .setContentText(searchName)
                .setGroup(GROUP)
                .setGroupSummary(true)
                .setAutoCancel(true)
                .setContentIntent(
                    PendingIntent.getActivity(
                        context, 0,
                        Intent(context, MainActivity::class.java).putExtra(MainActivity.EXTRA_TAB, MainActivity.TAB_NEWS),
                        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
                    ),
                )
                .build()
            try {
                nm.notify(GROUP.hashCode(), summary)
            } catch (_: SecurityException) {
            }
        }
    }

    private fun openListingIntent(context: Context, l: Listing): PendingIntent {
        val intent = Intent(context, MainActivity::class.java)
            .putExtra(EXTRA_LISTING, Json.encodeToString(Listing.serializer(), l))
            .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
        return PendingIntent.getActivity(
            context, l.id.hashCode(), intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }
}
