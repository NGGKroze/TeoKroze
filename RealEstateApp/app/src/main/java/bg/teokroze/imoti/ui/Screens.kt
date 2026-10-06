@file:OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)

package bg.teokroze.imoti.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.FavoriteBorder
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Star
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import android.os.Build
import bg.teokroze.imoti.core.Area
import bg.teokroze.imoti.core.Listing
import bg.teokroze.imoti.core.PropertyType
import bg.teokroze.imoti.core.SearchFilter
import bg.teokroze.imoti.core.Source
import bg.teokroze.imoti.core.PriceHistory
import bg.teokroze.imoti.core.Stats
import bg.teokroze.imoti.data.DealStatus
import bg.teokroze.imoti.data.StoreData
import androidx.compose.foundation.background
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.filled.LocationOn
import androidx.compose.ui.draw.alpha
import coil.compose.AsyncImage
import java.text.DateFormat
import java.util.Date

@Composable
fun ImotiTheme(content: @Composable () -> Unit) {
    val dark = isSystemInDarkTheme()
    val ctx = LocalContext.current
    val scheme = when {
        Build.VERSION.SDK_INT >= 31 -> if (dark) dynamicDarkColorScheme(ctx) else dynamicLightColorScheme(ctx)
        dark -> darkColorScheme(primary = Color(0xFF7FD8B5))
        else -> lightColorScheme(primary = Color(0xFF1E6B52))
    }
    MaterialTheme(colorScheme = scheme, content = content)
}

@Composable
fun ImotiRoot(vm: MainViewModel) {
    ImotiTheme {
        val opened = vm.opened
        if (opened != null) {
            BackHandler { vm.close() }
            DetailScreen(vm, opened)
        } else if (vm.editing != null) {
            BackHandler { vm.cancelEdit() }
            ProfileEditor(vm, vm.editing!!)
        } else {
            TabsScaffold(vm)
        }
    }
}

@Composable
private fun TabsScaffold(vm: MainViewModel) {
        Scaffold(
            topBar = { TopAppBar(title = { Text("Имоти Русе · ${vm.tab.label}") }) },
            bottomBar = {
                NavigationBar {
                    Tab.entries.forEach { t ->
                        NavigationBarItem(
                            selected = vm.tab == t,
                            onClick = { vm.tab = t },
                            icon = {
                                Icon(
                                    when (t) {
                                        Tab.SEARCH -> Icons.Filled.Search
                                        Tab.MAP -> Icons.Filled.LocationOn
                                        Tab.FAVORITES -> Icons.Filled.Favorite
                                        Tab.NEWS -> Icons.Filled.Star
                                        Tab.ALERTS -> Icons.Filled.Notifications
                                    },
                                    contentDescription = t.label,
                                )
                            },
                            label = { Text(t.label, maxLines = 1) },
                        )
                    }
                }
            },
        ) { padding ->
            Box(Modifier.padding(padding)) {
                when (vm.tab) {
                    Tab.SEARCH -> SearchScreen(vm)
                    Tab.MAP -> MapScreen(vm)
                    Tab.FAVORITES -> FavoritesScreen(vm)
                    Tab.NEWS -> NewsScreen(vm)
                    Tab.ALERTS -> ProfilesScreen(vm)
                }
            }
        }
}

// ---------- Search ----------

@Composable
private fun SearchScreen(vm: MainViewModel) {
    val data by vm.store.state.collectAsStateWithLifecycle()
    val favIds = data.favorites.map { it.id }.toSet()
    var showFilters by remember { mutableStateOf(!vm.searched) }

    LazyColumn(contentPadding = PaddingValues(12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        item {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(vm.filter.describe(), Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
                TextButton(onClick = { showFilters = !showFilters }) { Text(if (showFilters) "Скрий филтри" else "Филтри") }
            }
        }
        if (showFilters) item { FilterEditor(vm.filter) { vm.filter = it } }
        item {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = { showFilters = false; vm.search() }, enabled = !vm.loading) {
                    Icon(Icons.Filled.Search, null); Spacer(Modifier.width(6.dp)); Text("Търси")
                }
                OutlinedButton(onClick = { vm.newProfileFromSearch() }) {
                    Icon(Icons.Filled.Notifications, null); Spacer(Modifier.width(6.dp)); Text("Следи за нови")
                }
            }
        }
        vm.errors.forEach { e ->
            item { Text("⚠ $e", color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
        }
        if (vm.loading) {
            item { Box(Modifier.fillMaxWidth().padding(24.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator() } }
        } else if (vm.searched) {
            val hidden = data.hidden.toHashSet()
            val shown = vm.results.filter { it.id !in hidden }
            item {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("${shown.size} обяви", Modifier.weight(1f), fontWeight = FontWeight.Bold)
                    if (vm.newIds.isNotEmpty()) Text("${shown.count { it.id in vm.newIds }} нови", color = MaterialTheme.colorScheme.tertiary)
                    TextButton(onClick = { vm.tab = Tab.MAP; vm.mapSource = MapSource.RESULTS }) { Text("На картата") }
                }
                FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Sort.entries.forEach { s -> FilterChip(selected = vm.sort == s, onClick = { vm.sort = s }, label = { Text(s.label) }) }
                    if (vm.duplicates.isNotEmpty()) {
                        FilterChip(
                            selected = vm.collapseDuplicates,
                            onClick = { vm.collapseDuplicates = !vm.collapseDuplicates },
                            label = { Text("Без повторения") },
                        )
                    }
                }
            }
            items(shown, key = { it.id }) { l -> ListingItem(vm, l, data, favIds) }
        }
    }
}

@Composable
fun FilterEditor(filter: SearchFilter, onChange: (SearchFilter) -> Unit) {
    Card {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Район", style = MaterialTheme.typography.labelLarge)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Area.entries.forEach { a ->
                    FilterChip(selected = filter.area == a, onClick = { onChange(filter.copy(area = a)) }, label = { Text(a.label) })
                }
            }
            Text("Вид имот (нищо избрано = всички)", style = MaterialTheme.typography.labelLarge)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                PropertyType.entries.forEach { t ->
                    val on = t in filter.types
                    FilterChip(
                        selected = on,
                        onClick = { onChange(filter.copy(types = if (on) filter.types - t else filter.types + t)) },
                        label = { Text(t.label) },
                    )
                }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                NumberField("Цена от €", filter.minPriceEur, Modifier.weight(1f)) { onChange(filter.copy(minPriceEur = it)) }
                NumberField("Цена до €", filter.maxPriceEur, Modifier.weight(1f)) { onChange(filter.copy(maxPriceEur = it)) }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                NumberField("Площ от м²", filter.minAreaSqm, Modifier.weight(1f)) { onChange(filter.copy(minAreaSqm = it)) }
                NumberField("Площ до м²", filter.maxAreaSqm, Modifier.weight(1f)) { onChange(filter.copy(maxAreaSqm = it)) }
            }
            OutlinedTextField(
                value = filter.keyword,
                onValueChange = { onChange(filter.copy(keyword = it)) },
                label = { Text("Ключова дума (напр. Център, Възраждане, Мартен)") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            Text("Сайтове", style = MaterialTheme.typography.labelLarge)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Source.entries.forEach { s ->
                    val on = s in filter.sources
                    FilterChip(
                        selected = on,
                        onClick = {
                            val next = if (on) filter.sources - s else filter.sources + s
                            if (next.isNotEmpty()) onChange(filter.copy(sources = next))
                        },
                        label = { Text(s.label) },
                    )
                }
            }
            TextButton(onClick = { onChange(SearchFilter(id = filter.id, name = filter.name, notify = filter.notify, settings = filter.settings)) }) { Text("Изчисти филтрите") }
        }
    }
}

@Composable
private fun NumberField(label: String, value: Double?, modifier: Modifier, onChange: (Double?) -> Unit) {
    var text by remember(value == null) { mutableStateOf(value?.toLong()?.toString().orEmpty()) }
    OutlinedTextField(
        value = text,
        onValueChange = { v ->
            text = v.filter { it.isDigit() }
            onChange(text.toDoubleOrNull())
        },
        label = { Text(label) },
        singleLine = true,
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
        modifier = modifier,
    )
}

/** Card with everything the store knows about the listing (new, viewed, price drop, duplicates, status). */
@Composable
fun ListingItem(vm: MainViewModel, l: Listing, data: StoreData, favIds: Set<String>) {
    ListingCard(
        l = l,
        favorite = l.id in favIds,
        onClick = { vm.open(l) },
        onFavorite = { vm.toggleFavorite(l) },
        isNew = l.id in vm.newIds,
        viewed = l.id in data.viewed,
        drop = PriceHistory.dropFromPeak(data.prices[l.id]),
        alsoOn = vm.duplicates[l.id].orEmpty().map { it.source }.distinct(),
        status = data.notes[l.id]?.status?.takeIf { it != DealStatus.NONE },
    )
}

@Composable
fun ListingCard(
    l: Listing,
    favorite: Boolean,
    onClick: () -> Unit,
    onFavorite: () -> Unit,
    isNew: Boolean = false,
    viewed: Boolean = false,
    drop: Double = 0.0,
    alsoOn: List<Source> = emptyList(),
    status: DealStatus? = null,
) {
    Card(Modifier.fillMaxWidth().clickable(onClick = onClick).alpha(if (viewed && !favorite) 0.75f else 1f)) {
        Row {
            Box {
                if (l.imageUrl != null) {
                    AsyncImage(
                        model = l.imageUrl,
                        contentDescription = null,
                        contentScale = ContentScale.Crop,
                        modifier = Modifier.size(width = 120.dp, height = 116.dp),
                    )
                } else {
                    Box(Modifier.size(width = 120.dp, height = 116.dp), contentAlignment = Alignment.Center) {
                        Icon(Icons.Filled.Home, null, tint = MaterialTheme.colorScheme.outline)
                    }
                }
                if (isNew) Badge("НОВО", MaterialTheme.colorScheme.tertiary, Modifier.padding(4.dp))
            }
            Column(Modifier.weight(1f).padding(8.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        l.priceText.ifBlank { "Цена при запитване" },
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.Bold,
                        color = MaterialTheme.colorScheme.primary,
                    )
                    if (drop >= 1) {
                        Spacer(Modifier.width(6.dp))
                        Badge("↓ ${shortPrice(drop)}", Color(0xFF2E7D32))
                    }
                }
                Text(l.title, maxLines = 2, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodyMedium)
                val meta = listOfNotNull(
                    l.areaSqm?.let { "${it.toInt()} м²" },
                    Stats.pricePerSqm(l)?.let { "${it.toInt()} €/м²" },
                    l.location.ifBlank { null },
                    l.source.label + if (alsoOn.isNotEmpty()) " (+${alsoOn.joinToString { it.label }})" else "",
                ).joinToString(" · ")
                Text(meta, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2)
                if (status != null) {
                    Spacer(Modifier.height(2.dp))
                    Badge(status.label, MaterialTheme.colorScheme.secondary)
                }
            }
            IconButton(onClick = onFavorite) {
                Icon(
                    if (favorite) Icons.Filled.Favorite else Icons.Filled.FavoriteBorder,
                    contentDescription = "Любими",
                    tint = if (favorite) Color(0xFFD32F2F) else MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

@Composable
fun Badge(text: String, color: Color, modifier: Modifier = Modifier) {
    Text(
        text,
        modifier
            .background(color, RoundedCornerShape(6.dp))
            .padding(horizontal = 6.dp, vertical = 1.dp),
        color = Color.White,
        style = MaterialTheme.typography.labelSmall,
        fontWeight = FontWeight.Bold,
    )
}

// ---------- Favorites / news ----------

@Composable
private fun FavoritesScreen(vm: MainViewModel) {
    val data by vm.store.state.collectAsStateWithLifecycle()
    val statusOf = { id: String -> data.notes[id]?.status ?: DealStatus.NONE }
    val used = data.favorites.map { statusOf(it.id) }.toSet()
    val selected = vm.favoriteStatus?.takeIf { it in used }
    Column {
        if (used.size > 1) {
            FlowRow(Modifier.padding(horizontal = 12.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                FilterChip(selected = selected == null, onClick = { vm.favoriteStatus = null }, label = { Text("Всички") })
                DealStatus.entries.filter { it in used }.forEach { st ->
                    FilterChip(
                        selected = selected == st,
                        onClick = { vm.favoriteStatus = st },
                        label = { Text("${st.label} (${data.favorites.count { statusOf(it.id) == st }})") },
                    )
                }
            }
        }
        ListingList(
            items = data.favorites.filter { selected == null || statusOf(it.id) == selected },
            data = data,
            empty = "Нямаш любими имоти. Натисни ♡ на обява, за да я запазиш.",
            vm = vm,
        )
    }
}

@Composable
private fun NewsScreen(vm: MainViewModel) {
    val data by vm.store.state.collectAsStateWithLifecycle()
    val selected = vm.newsProfile?.takeIf { id -> data.searches.any { it.id == id } }
    val hits = data.hits.filter { selected == null || it.profileId == selected }
    Column {
        Row(Modifier.padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(
                if (data.lastCheck > 0) "Последна проверка: ${formatTime(data.lastCheck)}" else "Още няма проверка",
                Modifier.weight(1f),
                style = MaterialTheme.typography.bodySmall,
            )
            IconButton(onClick = { vm.checkNow() }) { Icon(Icons.Filled.Refresh, "Провери сега") }
            if (hits.isNotEmpty()) TextButton(onClick = { vm.clearNews() }) { Text("Изчисти") }
        }
        if (data.searches.size > 1) {
            FlowRow(Modifier.padding(horizontal = 12.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                FilterChip(selected = selected == null, onClick = { vm.newsProfile = null }, label = { Text("Всички") })
                data.searches.forEach { p ->
                    val count = data.hits.count { it.profileId == p.id }
                    FilterChip(
                        selected = selected == p.id,
                        onClick = { vm.newsProfile = p.id },
                        label = { Text("${profileTitle(p)} ($count)") },
                    )
                }
            }
        }
        ListingList(
            items = hits.map { it.listing }.distinctBy { it.id }.filter { it.id !in data.hidden },
            data = data,
            empty = "Тук се появяват новите обяви, открити от профилите за известия (раздел „Профили“).",
            vm = vm,
        )
    }
}

fun formatTime(millis: Long): String =
    DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.SHORT).format(Date(millis))

fun profileTitle(p: SearchFilter): String = p.name.ifBlank { "Профил" }

@Composable
private fun ListingList(items: List<Listing>, data: StoreData, empty: String, vm: MainViewModel) {
    if (items.isEmpty()) {
        Box(Modifier.fillMaxSize().padding(24.dp), contentAlignment = Alignment.Center) { Text(empty) }
        return
    }
    val favIds = data.favorites.map { it.id }.toSet()
    LazyColumn(contentPadding = PaddingValues(12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        items(items, key = { it.id }) { l -> ListingItem(vm, l, data, favIds) }
    }
}
