package com.teokroze.ytmp3

import android.Manifest
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import android.os.Bundle
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.documentfile.provider.DocumentFile
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.yausername.youtubedl_android.YoutubeDL
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class MainActivity : ComponentActivity() {
    private var sharedUrl by mutableStateOf("")

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        handleIntent(intent)
        setContent { MaterialTheme { Screen(sharedUrl) } }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleIntent(intent)
    }

    private fun handleIntent(i: Intent?) {
        if (i?.action == Intent.ACTION_SEND) {
            extractUrl(i.getStringExtra(Intent.EXTRA_TEXT))?.let { sharedUrl = it }
        }
    }
}

private fun extractUrl(text: String?): String? =
    text?.let { Regex("https?://\\S+").find(it)?.value }

@Composable
private fun Screen(initialUrl: String) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val prefs = remember { Prefs(ctx) }

    var url by remember { mutableStateOf("") }
    LaunchedEffect(initialUrl) { if (initialUrl.isNotEmpty()) url = initialUrl }
    var folder by remember { mutableStateOf(prefs.folderUri) }
    var format by remember { mutableStateOf(prefs.format) }
    var updateMsg by remember { mutableStateOf("") }

    val ready by DownloadState.ready.collectAsStateWithLifecycle()
    val running by DownloadState.running.collectAsStateWithLifecycle()
    val progress by DownloadState.progress.collectAsStateWithLifecycle()
    val status by DownloadState.status.collectAsStateWithLifecycle()

    val notifPerm = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {}
    LaunchedEffect(Unit) {
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) notifPerm.launch(Manifest.permission.POST_NOTIFICATIONS)
    }

    val pickFolder = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocumentTree()) { uri: Uri? ->
        if (uri != null) {
            ctx.contentResolver.takePersistableUriPermission(
                uri, Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION
            )
            prefs.folderUri = uri.toString()
            folder = uri.toString()
        }
    }

    val folderName = folder?.let { DocumentFile.fromTreeUri(ctx, Uri.parse(it))?.name } ?: "не е избрана"

    Surface(Modifier.fillMaxSize()) {
        Column(Modifier.padding(16.dp).statusBarsPadding(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("YouTube → MP3", style = MaterialTheme.typography.headlineSmall)

            OutlinedTextField(
                value = url, onValueChange = { url = it },
                label = { Text("YouTube линк") }, singleLine = true,
                modifier = Modifier.fillMaxWidth()
            )
            OutlinedButton(onClick = {
                val cm = ctx.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                val clip = cm.primaryClip?.getItemAt(0)?.text?.toString()
                extractUrl(clip)?.let { url = it }
            }) { Text("Постави от клипборда") }

            Text("Папка: $folderName")
            OutlinedButton(onClick = { pickFolder.launch(null) }) { Text("Избери папка") }

            Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                RadioButton(selected = format == "mp3", onClick = { format = "mp3"; prefs.format = "mp3" })
                Text("MP3 320 kbps")
                Spacer(Modifier.width(12.dp))
                RadioButton(selected = format == "best", onClick = { format = "best"; prefs.format = "best" })
                Text("Оригинал (най-добро)")
            }

            Button(
                enabled = ready && !running && folder != null && extractUrl(url) != null,
                onClick = { DownloadService.start(ctx, extractUrl(url)!!) },
                modifier = Modifier.fillMaxWidth()
            ) { Text(if (!ready) "Зарежда се…" else "Свали") }

            if (running) LinearProgressIndicator(progress = { progress }, modifier = Modifier.fillMaxWidth())
            if (status.isNotEmpty()) Text(status)

            Spacer(Modifier.weight(1f))
            OutlinedButton(
                enabled = ready && !running,
                onClick = {
                    updateMsg = "Обновява…"
                    scope.launch {
                        updateMsg = withContext(Dispatchers.IO) {
                            try { YoutubeDL.getInstance().updateYoutubeDL(ctx, YoutubeDL.UpdateChannel._NIGHTLY); "yt-dlp е обновен (nightly)" }
                            catch (e: Exception) { "Грешка при обновяване: ${e.message}" }
                        }
                    }
                }
            ) { Text("Обнови yt-dlp (ако не работи)") }
            if (updateMsg.isNotEmpty()) Text(updateMsg, style = MaterialTheme.typography.bodySmall)
        }
    }
}
