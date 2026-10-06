package bg.teokroze.imoti

import android.app.Application
import bg.teokroze.imoti.work.CheckWorker
import bg.teokroze.imoti.work.Notifier

class ImotiApp : Application() {
    override fun onCreate() {
        super.onCreate()
        Notifier.createChannels(this)
        // OpenStreetMap tiles: identify the app and keep the tile cache in app-private storage.
        org.osmdroid.config.Configuration.getInstance().apply {
            userAgentValue = packageName
            osmdroidBasePath = java.io.File(cacheDir, "osmdroid")
            osmdroidTileCache = java.io.File(cacheDir, "osmdroid/tiles")
        }
        CheckWorker.schedule(this)
    }
}
