@file:OptIn(ExperimentalLayoutApi::class)

package bg.teokroze.imoti.ui

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Typeface
import android.graphics.drawable.BitmapDrawable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.graphics.toArgb
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import bg.teokroze.imoti.core.Gazetteer
import bg.teokroze.imoti.data.MapGroup
import org.osmdroid.tileprovider.tilesource.TileSourceFactory
import org.osmdroid.util.BoundingBox
import org.osmdroid.views.MapView
import org.osmdroid.views.overlay.Marker
import org.osmdroid.util.GeoPoint as OsmPoint

@Composable
fun MapScreen(vm: MainViewModel) {
    val data by vm.store.state.collectAsStateWithLifecycle()
    val listingIds = vm.mapListings().map { it.id }
    LaunchedEffect(vm.mapSource, listingIds) { vm.loadMap() }

    Column(Modifier.fillMaxSize()) {
        FlowRow(Modifier.padding(horizontal = 12.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            MapSource.entries.forEach { s ->
                FilterChip(selected = vm.mapSource == s, onClick = { vm.mapSource = s }, label = { Text(s.label) })
            }
        }
        val placed = vm.mapGroups.sumOf { it.listings.size }
        Text(
            when {
                listingIds.isEmpty() && vm.mapSource == MapSource.RESULTS -> "Направи търсене, за да видиш резултатите на картата."
                listingIds.isEmpty() -> "Няма обяви за показване."
                else -> "$placed от ${listingIds.size} обяви на картата (по квартал/село — местоположението е приблизително)"
            },
            Modifier.padding(horizontal = 12.dp, vertical = 4.dp),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        if (vm.mapLoading) LinearProgressIndicator(Modifier.fillMaxWidth())

        Box(Modifier.weight(1f).fillMaxWidth()) {
            OsmMap(vm)
        }

        vm.mapSelected?.let { g ->
            val favIds = data.favorites.map { it.id }.toSet()
            Surface(tonalElevation = 3.dp) {
                Column {
                    Row(Modifier.padding(start = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text("${g.label} · ${g.listings.size} обяви", Modifier.weight(1f), fontWeight = FontWeight.Bold)
                        IconButton(onClick = { vm.mapSelected = null }) { Icon(Icons.Filled.Close, "Затвори") }
                    }
                    LazyColumn(
                        Modifier.heightIn(max = 300.dp),
                        contentPadding = PaddingValues(start = 12.dp, end = 12.dp, bottom = 12.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        items(g.listings, key = { it.id }) { l -> ListingItem(vm, l, data, favIds) }
                    }
                }
            }
        }
    }
}

@Composable
private fun OsmMap(vm: MainViewModel) {
    val context = LocalContext.current
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val fitted = remember { mutableListOf<List<MapGroup>>() }
    val markerColor = MaterialTheme.colorScheme.primary.toArgb()
    val mapView = remember {
        MapView(context).apply {
            setTileSource(TileSourceFactory.MAPNIK)
            setMultiTouchControls(true)
            controller.setZoom(12.5)
            controller.setCenter(OsmPoint(Gazetteer.RUSE_CENTER.lat, Gazetteer.RUSE_CENTER.lon))
        }
    }

    // osmdroid's tile loader follows the activity lifecycle.
    DisposableEffect(lifecycle) {
        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_RESUME -> mapView.onResume()
                Lifecycle.Event.ON_PAUSE -> mapView.onPause()
                else -> Unit
            }
        }
        lifecycle.addObserver(observer)
        mapView.onResume()
        onDispose {
            lifecycle.removeObserver(observer)
            mapView.onDetach()
        }
    }

    AndroidView(
        modifier = Modifier.fillMaxSize(),
        factory = { mapView },
        update = { map ->
            val groups = vm.mapGroups
            map.overlays.clear()
            groups.forEach { g ->
                val m = Marker(map)
                m.position = OsmPoint(g.point.lat, g.point.lon)
                m.setAnchor(Marker.ANCHOR_CENTER, Marker.ANCHOR_CENTER)
                m.icon = badge(map.context, g, markerColor)
                m.title = g.label
                m.setOnMarkerClickListener { _, _ -> vm.mapSelected = g; true }
                map.overlays.add(m)
            }
            map.invalidate()
            // Zoom to the pins once loading has finished.
            if (!vm.mapLoading && groups.size > 1 && fitted.lastOrNull() !== groups) {
                fitted.clear()
                fitted.add(groups)
                val box = BoundingBox.fromGeoPoints(groups.map { OsmPoint(it.point.lat, it.point.lon) })
                map.post { runCatching { map.zoomToBoundingBox(box.increaseByScale(1.3f), true) } }
            }
        },
    )
}

/** A rounded pin label like "5 · от 45k €". */
private fun badge(context: Context, g: MapGroup, color: Int): BitmapDrawable {
    val density = context.resources.displayMetrics.density
    val minPrice = g.listings.mapNotNull { it.priceEur }.minOrNull()
    val text = buildString {
        append(g.listings.size)
        if (minPrice != null) append(" · от ").append(shortPrice(minPrice))
    }
    val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        textSize = 13 * density
        typeface = Typeface.DEFAULT_BOLD
        this.color = android.graphics.Color.WHITE
    }
    val padX = 8 * density
    val padY = 5 * density
    val w = (paint.measureText(text) + padX * 2).toInt()
    val h = (paint.textSize + padY * 2).toInt()
    val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
    val c = Canvas(bmp)
    val bg = Paint(Paint.ANTI_ALIAS_FLAG).apply { this.color = color }
    c.drawRoundRect(RectF(0f, 0f, w.toFloat(), h.toFloat()), h / 2f, h / 2f, bg)
    c.drawText(text, padX, h / 2f - (paint.descent() + paint.ascent()) / 2, paint)
    return BitmapDrawable(context.resources, bmp)
}

fun shortPrice(eur: Double): String = when {
    eur >= 1_000_000 -> "%.1fM €".format(eur / 1_000_000)
    eur >= 1_000 -> "${(eur / 1_000).toInt()}k €"
    else -> "${eur.toInt()} €"
}
