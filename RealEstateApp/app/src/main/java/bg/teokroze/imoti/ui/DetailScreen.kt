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
import bg.teokroze.imoti.core.Stats
import bg.teokroze.imoti.data.DealStatus
import bg.teokroze.imoti.data.Note
import bg.teokroze.imoti.data.StoreData
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.filled.Clear
import androidx.compose.material3.FilterChip
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.TextButton
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.text.input.KeyboardType
import kotlin.math.roundToInt
import androidx.compose.runtime.LaunchedEffect
import kotlinx.coroutines.delay
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
                    IconButton(onClick = { vm.hide(listing) }) { Icon(Icons.Filled.Clear, "Скрий обявата") }
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
            item { PriceCard(vm, listing, data) }
            vm.duplicates[listing.id]?.takeIf { it.isNotEmpty() }?.let { copies ->
                item {
                    Card {
                        Column(Modifier.padding(12.dp)) {
                            Text("Вероятно същият имот и в:", fontWeight = FontWeight.Bold)
                            copies.forEach { c ->
                                TextButton(onClick = { vm.open(c) }) { Text("${c.source.label}: ${c.priceText} · ${c.title.take(50)}") }
                            }
                        }
                    }
                }
            }
            item { NoteCard(vm, listing, data) }

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

@Composable
private fun PriceCard(vm: MainViewModel, listing: Listing, data: StoreData) {
    val history = data.prices[listing.id].orEmpty()
    val perSqm = Stats.pricePerSqm(listing)
    val median = vm.medians[listing.type]
    var showCalc by remember { mutableStateOf(false) }
    Card {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text("Цена", fontWeight = FontWeight.Bold)
            if (perSqm != null) {
                Text("${perSqm.roundToInt()} €/м²", style = MaterialTheme.typography.bodyMedium)
                if (median != null) {
                    val diff = (perSqm - median) / median * 100
                    val txt = when {
                        diff <= -3 -> "с ${(-diff).roundToInt()}% под средното"
                        diff >= 3 -> "с ${diff.roundToInt()}% над средното"
                        else -> "около средното"
                    }
                    Text(
                        "$txt за „${listing.type.label}“ (${median.roundToInt()} €/м² в последните резултати)",
                        style = MaterialTheme.typography.bodySmall,
                        color = if (diff <= -3) Color(0xFF2E7D32) else MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            if (history.size > 1) {
                Text("История на цената", style = MaterialTheme.typography.labelLarge)
                history.forEach { p ->
                    Text("${formatTime(p.at)} — ${"%,.0f".format(p.eur)} €", style = MaterialTheme.typography.bodySmall)
                }
            } else if (history.size == 1) {
                Text(
                    "Следя цената от ${formatTime(history.first().at)}. Ако се промени, ще го видиш тук" +
                        (if (data.favorites.any { it.id == listing.id }) " и ще получиш известие." else " (за любимите има и известие)."),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            if (listing.priceEur != null) {
                TextButton(onClick = { showCalc = !showCalc }) { Text(if (showCalc) "Скрий кредитния калкулатор" else "Кредитен калкулатор") }
                if (showCalc) MortgageCalc(listing.priceEur!!)
            }
        }
    }
}

@Composable
private fun MortgageCalc(price: Double) {
    var downPct by remember { mutableStateOf(20) }
    var years by remember { mutableStateOf(30) }
    var ratePct by remember { mutableStateOf("2.6") }
    val loan = price * (100 - downPct) / 100
    val rate = ratePct.replace(',', '.').toDoubleOrNull() ?: 0.0
    val monthly = Stats.monthlyPayment(loan, rate, years)
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text("Самоучастие", style = MaterialTheme.typography.labelMedium)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            listOf(10, 15, 20, 30, 50).forEach { p -> FilterChip(selected = downPct == p, onClick = { downPct = p }, label = { Text("$p%") }) }
        }
        Text("Срок", style = MaterialTheme.typography.labelMedium)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            listOf(15, 20, 25, 30, 35).forEach { y -> FilterChip(selected = years == y, onClick = { years = y }, label = { Text("$y г.") }) }
        }
        OutlinedTextField(
            value = ratePct,
            onValueChange = { ratePct = it.filter { c -> c.isDigit() || c == '.' || c == ',' }.take(5) },
            label = { Text("Годишна лихва, %") },
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
        )
        Text(
            "Самоучастие ${"%,.0f".format(price - loan)} € · кредит ${"%,.0f".format(loan)} €",
            style = MaterialTheme.typography.bodySmall,
        )
        Text("≈ ${"%,.0f".format(monthly)} € на месец", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
        Text(
            "Ориентировъчно, без такси и застраховки.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
private fun NoteCard(vm: MainViewModel, listing: Listing, data: StoreData) {
    val note = data.notes[listing.id] ?: Note()
    var text by remember(listing.id) { mutableStateOf(note.text) }
    // Save the text shortly after typing stops instead of on every keystroke.
    LaunchedEffect(listing.id, text) {
        if (text == note.text) return@LaunchedEffect
        delay(700)
        vm.store.setNote(listing.id, (vm.store.state.value.notes[listing.id] ?: Note()).copy(text = text))
    }
    Card {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text("Наши бележки", fontWeight = FontWeight.Bold)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                DealStatus.entries.forEach { st ->
                    FilterChip(
                        selected = note.status == st,
                        onClick = {
                            vm.store.setNote(listing.id, note.copy(text = text, status = st))
                            // Giving a listing a status means we care about it: keep it in favorites.
                            if (st != DealStatus.NONE && data.favorites.none { it.id == listing.id }) vm.toggleFavorite(listing)
                        },
                        label = { Text(st.label) },
                    )
                }
            }
            OutlinedTextField(
                value = text,
                onValueChange = { text = it },
                label = { Text("Бележка (напр. „оглед в събота 11ч, питай за ТЕЦ“)") },
                modifier = Modifier.fillMaxWidth(),
                minLines = 2,
            )
        }
    }
}
