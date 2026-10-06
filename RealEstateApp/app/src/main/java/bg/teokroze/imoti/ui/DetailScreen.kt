@file:OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)

package bg.teokroze.imoti.ui

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.widget.Toast
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Call
import androidx.compose.material.icons.filled.Email
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.FavoriteBorder
import androidx.compose.material.icons.filled.LocationOn
import androidx.compose.material.icons.filled.Share
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import bg.teokroze.imoti.core.Listing
import coil.compose.AsyncImage

@Composable
fun DetailScreen(vm: MainViewModel, listing: Listing) {
    val ctx = LocalContext.current
    val data by vm.store.state.collectAsStateWithLifecycle()
    val favorite = data.favorites.any { it.id == listing.id }
    val d = vm.details

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(listing.source.label) },
                navigationIcon = { IconButton(onClick = { vm.close() }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Назад") } },
                actions = {
                    IconButton(onClick = { share(ctx, listing) }) { Icon(Icons.Filled.Share, "Сподели") }
                    IconButton(onClick = { vm.toggleFavorite(listing) }) {
                        Icon(
                            if (favorite) Icons.Filled.Favorite else Icons.Filled.FavoriteBorder,
                            "Любими",
                            tint = if (favorite) Color(0xFFD32F2F) else MaterialTheme.colorScheme.onSurface,
                        )
                    }
                },
            )
        },
    ) { padding ->
        LazyColumn(
            Modifier.padding(padding),
            contentPadding = PaddingValues(12.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            val images = d?.images?.takeIf { it.isNotEmpty() } ?: listOfNotNull(listing.imageUrl)
            if (images.isNotEmpty()) item {
                LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    items(images) { url ->
                        AsyncImage(
                            model = url,
                            contentDescription = null,
                            contentScale = ContentScale.Crop,
                            modifier = Modifier.size(width = 300.dp, height = 210.dp).clip(RoundedCornerShape(12.dp)),
                        )
                    }
                }
            }
            item {
                Text(
                    d?.priceText?.ifBlank { null } ?: listing.priceText.ifBlank { "Цена при запитване" },
                    style = MaterialTheme.typography.headlineSmall,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.primary,
                )
                Text(d?.title?.ifBlank { null } ?: listing.title, style = MaterialTheme.typography.titleMedium)
                val meta = listOfNotNull(
                    listing.areaSqm?.let { "${it.toInt()} м²" },
                    listing.type.label,
                    (d?.address ?: listing.location).ifBlank { null },
                ).joinToString(" · ")
                Text(meta, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }

            item { ContactCard(ctx, vm, listing) }

            if (d == null && vm.detailsError == null) item {
                Box(Modifier.fillMaxWidth().padding(16.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
            }
            vm.detailsError?.let { err ->
                item { Text("Не успях да заредя детайлите ($err). Отвори обявата в сайта.", color = MaterialTheme.colorScheme.error) }
            }
            if (d != null && d.attributes.isNotEmpty()) item {
                Card {
                    Column(Modifier.padding(12.dp)) {
                        Text("Характеристики", fontWeight = FontWeight.Bold)
                        Spacer(Modifier.height(6.dp))
                        d.attributes.forEach { (k, v) ->
                            Row(Modifier.padding(vertical = 2.dp)) {
                                Text(k, Modifier.weight(0.45f), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                Text(v, Modifier.weight(0.55f), style = MaterialTheme.typography.bodySmall)
                            }
                        }
                    }
                }
            }
            if (d != null && d.description.isNotBlank()) item {
                Column {
                    Text("Описание", fontWeight = FontWeight.Bold)
                    Spacer(Modifier.height(4.dp))
                    Text(d.description, style = MaterialTheme.typography.bodyMedium)
                }
            }
            item {
                OutlinedButton(onClick = { open(ctx, Intent(Intent.ACTION_VIEW, Uri.parse(listing.url))) }, Modifier.fillMaxWidth()) {
                    Text("Отвори обявата в ${listing.source.label}")
                }
            }
        }
    }
}

@Composable
private fun ContactCard(ctx: Context, vm: MainViewModel, listing: Listing) {
    val d = vm.details
    Card {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Контакт", fontWeight = FontWeight.Bold)
            d?.contactName?.let { Text(it, maxLines = 1, overflow = TextOverflow.Ellipsis) }
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                d?.phones.orEmpty().forEach { phone ->
                    Button(onClick = { open(ctx, Intent(Intent.ACTION_DIAL, Uri.parse("tel:$phone"))) }) {
                        Icon(Icons.Filled.Call, null); Spacer(Modifier.width(6.dp)); Text(phone)
                    }
                }
                d?.emails.orEmpty().forEach { email ->
                    FilledTonalButton(onClick = {
                        val i = Intent(Intent.ACTION_SENDTO, Uri.parse("mailto:$email"))
                            .putExtra(Intent.EXTRA_SUBJECT, "Запитване: ${listing.title.take(80)}")
                            .putExtra(Intent.EXTRA_TEXT, "Здравейте,\n\nИнтересувам се от имота: ${listing.url}\n\n")
                        open(ctx, i)
                    }) {
                        Icon(Icons.Filled.Email, null); Spacer(Modifier.width(6.dp)); Text(email, maxLines = 1)
                    }
                }
                val place = (d?.address ?: listing.location).ifBlank { null }
                if (place != null) {
                    FilledTonalButton(onClick = {
                        val q = if ("русе" in place.lowercase()) place else "$place, област Русе"
                        open(ctx, Intent(Intent.ACTION_VIEW, Uri.parse("geo:0,0?q=" + Uri.encode(q))))
                    }) {
                        Icon(Icons.Filled.LocationOn, null); Spacer(Modifier.width(6.dp)); Text("Карта")
                    }
                }
            }
            if (d != null && d.phones.isEmpty() && d.emails.isEmpty()) {
                HorizontalDivider()
                Text(
                    "Сайтът не показва телефона директно — натисни „Отвори обявата“ по-долу, за да го видиш.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

private fun open(ctx: Context, intent: Intent) {
    try {
        ctx.startActivity(intent)
    } catch (_: ActivityNotFoundException) {
        Toast.makeText(ctx, "Няма приложение за това действие", Toast.LENGTH_SHORT).show()
    }
}

private fun share(ctx: Context, l: Listing) {
    val text = listOf(l.title, l.priceText, l.url).filter { it.isNotBlank() }.joinToString("\n")
    open(ctx, Intent.createChooser(Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, text), "Сподели"))
}
