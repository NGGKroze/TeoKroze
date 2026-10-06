package bg.teokroze.imoti

import android.app.Application
import bg.teokroze.imoti.work.CheckWorker
import bg.teokroze.imoti.work.Notifier

class ImotiApp : Application() {
    override fun onCreate() {
        super.onCreate()
        Notifier.createChannel(this)
        CheckWorker.schedule(this)
    }
}
