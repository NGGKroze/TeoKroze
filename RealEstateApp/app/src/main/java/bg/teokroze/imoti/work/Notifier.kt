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
import bg.teokroze.imoti.core.NotifyStyle
import bg.teokroze.imoti.core.SearchFilter
import kotlinx.serialization.json.Json

object Notifier {
    private const val CHANNEL = "new_listings"
    private const val CHANNEL_SILENT = "new_listings_silent"
    const val EXTRA_LISTING = "listing"

    fun createChannels(context: Context) {
        val nm = context.getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL, "Нови имоти", NotificationManager.IMPORTANCE_DEFAULT).apply {
                description = "Нови обяви по профилите за известия"
            },
        )
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL_SILENT, "Нови имоти (тихо)", NotificationManager.IMPORTANCE_LOW).apply {
                description = "Профили, настроени „без звук“"
            },
        )
    }

    fun canNotify(context: Context): Boolean =
        Build.VERSION.SDK_INT < 33 ||
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

    fun notifyNew(context: Context, profile: SearchFilter, fresh: List<Listing>) {
        if (!canNotify(context) || fresh.isEmpty()) return
        val s = profile.settings
        val channel = if (s.silent) CHANNEL_SILENT else CHANNEL
        val group = "bg.teokroze.imoti.${profile.id}"
        val name = profile.name.ifBlank { profile.describe() }

        val individual = if (s.style == NotifyStyle.EACH) fresh.take(s.maxPerCheck.coerceAtLeast(1)) else emptyList()
        individual.forEach { l ->
            val n = NotificationCompat.Builder(context, channel)
                .setSmallIcon(R.drawable.ic_notification)
                .setContentTitle(headline(l))
                .setContentText(l.title)
                .setStyle(NotificationCompat.BigTextStyle().bigText("${l.title}\n${l.source.label} · $name"))
                .setSubText(name)
                .setContentIntent(openListingIntent(context, l))
                .setAutoCancel(true)
                .setSilent(s.silent)
                .setGroup(group)
                .build()
            post(context, (profile.id + l.id).hashCode(), n)
        }

        // Summary: the whole notification in SUMMARY mode, or the group header (+ overflow count) in EACH mode.
        if (s.style == NotifyStyle.SUMMARY || fresh.size > 1) {
            val inbox = NotificationCompat.InboxStyle().setBigContentTitle("${fresh.size} ${plural(fresh.size)} · $name")
            fresh.take(6).forEach { inbox.addLine("${headline(it)} — ${it.title}") }
            if (fresh.size > 6) inbox.setSummaryText("и още ${fresh.size - 6}")
            val summary = NotificationCompat.Builder(context, channel)
                .setSmallIcon(R.drawable.ic_notification)
                .setContentTitle("${fresh.size} ${plural(fresh.size)}")
                .setContentText(name)
                .setStyle(inbox)
                .setGroup(group)
                .setGroupSummary(s.style == NotifyStyle.EACH)
                .setSilent(s.silent || s.style == NotifyStyle.EACH)
                .setAutoCancel(true)
                .setContentIntent(openProfileIntent(context, profile.id))
                .build()
            post(context, profile.id.hashCode(), summary)
        }
    }

    private fun headline(l: Listing): String =
        listOfNotNull(l.priceText.ifBlank { null }, l.areaSqm?.let { "${it.toInt()} м²" }, l.location.ifBlank { null })
            .joinToString(" · ")
            .ifBlank { "Нов имот" }

    private fun plural(n: Int) = if (n == 1) "нов имот" else "нови имота"

    private fun post(context: Context, id: Int, n: android.app.Notification) {
        try {
            NotificationManagerCompat.from(context).notify(id, n)
        } catch (_: SecurityException) {
            // Permission revoked between the check and the post.
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

    private fun openProfileIntent(context: Context, profileId: String): PendingIntent {
        val intent = Intent(context, MainActivity::class.java)
            .putExtra(MainActivity.EXTRA_TAB, MainActivity.TAB_NEWS)
            .putExtra(MainActivity.EXTRA_PROFILE, profileId)
            .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
        return PendingIntent.getActivity(
            context, profileId.hashCode(), intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }
}
