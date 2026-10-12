package com.teokroze.ytmp3

import android.content.Context
import kotlinx.coroutines.flow.MutableStateFlow

/** Process-wide UI state, written by [DownloadService] and read by the UI. */
object DownloadState {
    val ready = MutableStateFlow(false)
    val running = MutableStateFlow(false)
    val progress = MutableStateFlow(0f)
    val status = MutableStateFlow("")
}

class Prefs(context: Context) {
    private val sp = context.getSharedPreferences("prefs", Context.MODE_PRIVATE)

    var folderUri: String?
        get() = sp.getString("folder", null)
        set(v) = sp.edit().putString("folder", v).apply()

    /** "mp3" = convert to MP3 320 kbps, "best" = keep original best audio stream. */
    var format: String
        get() = sp.getString("format", "mp3") ?: "mp3"
        set(v) = sp.edit().putString("format", v).apply()
}
