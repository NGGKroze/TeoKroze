package com.teokroze.ytmp3

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.Uri
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.documentfile.provider.DocumentFile
import com.yausername.youtubedl_android.YoutubeDL
import com.yausername.youtubedl_android.YoutubeDLRequest
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import java.io.File

class DownloadService : Service() {
    private val scope = CoroutineScope(Dispatchers.IO)

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val url = intent?.getStringExtra(EXTRA_URL)
        if (url == null || DownloadState.running.value) {
            if (!DownloadState.running.value) stopSelf()
            return START_NOT_STICKY
        }
        startInForeground("Започва свалянето…")
        DownloadState.running.value = true
        DownloadState.progress.value = 0f
        scope.launch {
            try {
                download(url)
            } catch (e: Exception) {
                DownloadState.status.value = "Грешка: ${e.message?.lineSequence()?.lastOrNull { it.isNotBlank() } ?: e}"
            } finally {
                DownloadState.running.value = false
                stopForeground(STOP_FOREGROUND_REMOVE)
                stopSelf()
            }
        }
        return START_NOT_STICKY
    }

    private fun download(url: String) {
        val prefs = Prefs(this)
        val folder = prefs.folderUri?.let { DocumentFile.fromTreeUri(this, Uri.parse(it)) }
            ?: error("Не е избрана папка")
        val tmp = File(cacheDir, "dl").apply { deleteRecursively(); mkdirs() }

        val req = YoutubeDLRequest(url).apply {
            addOption("--no-playlist")
            addOption("-x")
            if (prefs.format == "mp3") {
                addOption("--audio-format", "mp3")
                addOption("--audio-quality", "320K")
            } else {
                addOption("--audio-format", "best")
            }
            addOption("-f", "bestaudio/best")
            addOption("--embed-metadata")
            addOption("--trim-filenames", "120")
            addOption("-o", "${tmp.absolutePath}/%(title)s.%(ext)s")
        }

        DownloadState.status.value = "Сваля…"
        YoutubeDL.getInstance().execute(req, "dl") { progress, _, line ->
            if (progress >= 0) DownloadState.progress.value = progress / 100f
            val text = if (progress >= 0) "Сваля… ${progress.toInt()}%" else line.trim().take(80)
            updateNotification(text)
        }

        val files = tmp.listFiles { f -> f.isFile && !f.name.endsWith(".part") }.orEmpty()
        if (files.isEmpty()) error("Не е получен файл")
        DownloadState.status.value = "Записва в папката…"
        for (f in files) {
            val mime = when (f.extension.lowercase()) {
                "mp3" -> "audio/mpeg"
                "m4a" -> "audio/mp4"
                "opus", "ogg" -> "audio/ogg"
                "webm" -> "audio/webm"
                else -> "application/octet-stream"
            }
            folder.findFile(f.name)?.delete()
            val dest = folder.createFile(mime, f.nameWithoutExtension) ?: error("Не мога да създам файл в папката")
            contentResolver.openOutputStream(dest.uri)?.use { out -> f.inputStream().use { it.copyTo(out) } }
        }
        tmp.deleteRecursively()
        DownloadState.progress.value = 1f
        DownloadState.status.value = "Готово: ${files.first().nameWithoutExtension}"
    }

    private fun startInForeground(text: String) {
        val nm = getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= 26) {
            nm.createNotificationChannel(NotificationChannel(CHANNEL, "Сваляне", NotificationManager.IMPORTANCE_LOW))
        }
        val n = notification(text)
        if (Build.VERSION.SDK_INT >= 29) {
            startForeground(NOTIF_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        } else {
            startForeground(NOTIF_ID, n)
        }
    }

    private fun updateNotification(text: String) {
        getSystemService(NotificationManager::class.java).notify(NOTIF_ID, notification(text))
    }

    private fun notification(text: String): Notification =
        NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(android.R.drawable.stat_sys_download)
            .setContentTitle("YT MP3")
            .setContentText(text)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .build()

    companion object {
        private const val EXTRA_URL = "url"
        private const val CHANNEL = "download"
        private const val NOTIF_ID = 1

        fun start(context: Context, url: String) {
            val i = Intent(context, DownloadService::class.java).putExtra(EXTRA_URL, url)
            context.startForegroundService(i)
        }
    }
}
