package bg.teokroze.imoti

import android.Manifest
import android.content.Intent
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import bg.teokroze.imoti.core.Listing
import bg.teokroze.imoti.ui.ImotiRoot
import bg.teokroze.imoti.ui.MainViewModel
import bg.teokroze.imoti.ui.Tab
import bg.teokroze.imoti.work.Notifier
import kotlinx.serialization.json.Json

class MainActivity : ComponentActivity() {
    private val vm: MainViewModel by viewModels()

    private val askNotifications = registerForActivityResult(ActivityResultContracts.RequestPermission()) {}

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        if (Build.VERSION.SDK_INT >= 33 && !Notifier.canNotify(this)) {
            askNotifications.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
        handle(intent)
        setContent { ImotiRoot(vm) }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handle(intent)
    }

    /** Notification taps carry either a listing to open or a tab to show. */
    private fun handle(intent: Intent?) {
        intent ?: return
        intent.getStringExtra(Notifier.EXTRA_LISTING)?.let { raw ->
            runCatching { Json.decodeFromString(Listing.serializer(), raw) }.getOrNull()?.let(vm::open)
            intent.removeExtra(Notifier.EXTRA_LISTING)
        }
        if (intent.getStringExtra(EXTRA_TAB) == TAB_NEWS) {
            vm.tab = Tab.NEWS
            intent.removeExtra(EXTRA_TAB)
        }
    }

    companion object {
        const val EXTRA_TAB = "tab"
        const val TAB_NEWS = "news"
    }
}
