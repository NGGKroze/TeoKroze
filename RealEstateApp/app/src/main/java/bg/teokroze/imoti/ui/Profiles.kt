@file:OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)

package bg.teokroze.imoti.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import bg.teokroze.imoti.core.Area
import bg.teokroze.imoti.core.NotifyFrequency
import bg.teokroze.imoti.core.NotifySettings
import bg.teokroze.imoti.core.NotifyStyle
import bg.teokroze.imoti.core.PropertyType
import bg.teokroze.imoti.core.SearchFilter

/** Ready-made profiles; the user can tweak them before saving. */
private val TEMPLATES = listOf(
    SearchFilter(id = "", name = "Къщи до 50 000 € в Русе", area = Area.CITY, types = setOf(PropertyType.HOUSE), maxPriceEur = 50_000.0),
    SearchFilter(id = "", name = "Къщи до 70 000 € около Русе", area = Area.AROUND, types = setOf(PropertyType.HOUSE), maxPriceEur = 70_000.0),
    SearchFilter(
        id = "", name = "Апартаменти до 80 000 € в Русе", area = Area.CITY,
        types = setOf(PropertyType.ROOM_1, PropertyType.ROOM_2, PropertyType.ROOM_3, PropertyType.ROOM_4), maxPriceEur = 80_000.0,
    ),
    SearchFilter(
        id = "", name = "Парцели около Русе (веднъж дневно)", area = Area.AROUND, types = setOf(PropertyType.LAND),
        settings = NotifySettings(frequency = NotifyFrequency.DAILY, style = NotifyStyle.SUMMARY),
    ),
)

@Composable
fun ProfilesScreen(vm: MainViewModel) {
    val data by vm.store.state.collectAsStateWithLifecycle()
    var confirmDelete by remember { mutableStateOf<SearchFilter?>(null) }

    LazyColumn(contentPadding = PaddingValues(12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        item {
            Text(
                "Всеки профил е отделно търсене със собствени известия. Известие идва само когато профилът открие нова обява.",
                style = MaterialTheme.typography.bodyMedium,
            )
        }
        item {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = { vm.newProfile() }) { Icon(Icons.Filled.Add, null); Spacer(Modifier.width(6.dp)); Text("Нов профил") }
                OutlinedButton(onClick = { vm.checkNow() }) { Icon(Icons.Filled.Refresh, null); Spacer(Modifier.width(6.dp)); Text("Провери сега") }
            }
        }
        item {
            Text("Бързо създаване", style = MaterialTheme.typography.labelLarge)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                TEMPLATES.forEach { t -> AssistChip(onClick = { vm.newProfile(t) }, label = { Text(t.name) }) }
            }
        }
        if (data.searches.isEmpty()) item {
            Text("Още нямаш профили.", color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        items(data.searches, key = { it.id }) { p ->
            val hits = data.hits.count { it.profileId == p.id }
            val last = data.lastRun[p.id]
            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(12.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(profileTitle(p), fontWeight = FontWeight.Bold)
                            Text(p.describe(), style = MaterialTheme.typography.bodySmall)
                            Text(
                                if (p.notify) "🔔 ${p.settings.describe()}" else "🔕 известията са спрени",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.primary,
                            )
                            Text(
                                "Сайтове: ${p.sources.joinToString { it.label }}" +
                                    (last?.let { " · проверен ${formatTime(it)}" } ?: ""),
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        Switch(checked = p.notify, onCheckedChange = { vm.setNotify(p.id, it) })
                    }
                    HorizontalDivider(Modifier.padding(vertical = 6.dp))
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        TextButton(onClick = { vm.runSaved(p) }) { Text("Търси") }
                        TextButton(onClick = { vm.newsProfile = p.id; vm.tab = Tab.NEWS }) { Text("Нови ($hits)") }
                        Spacer(Modifier.weight(1f))
                        IconButton(onClick = { vm.editProfile(p) }) { Icon(Icons.Filled.Edit, "Редактирай") }
                        IconButton(onClick = { confirmDelete = p }) { Icon(Icons.Filled.Delete, "Изтрий") }
                    }
                }
            }
        }
    }

    confirmDelete?.let { p ->
        AlertDialog(
            onDismissRequest = { confirmDelete = null },
            title = { Text("Изтриване на профил") },
            text = { Text("Да изтрия ли „${profileTitle(p)}“?") },
            confirmButton = { TextButton(onClick = { vm.deleteSearch(p.id); confirmDelete = null }) { Text("Изтрий") } },
            dismissButton = { TextButton(onClick = { confirmDelete = null }) { Text("Отказ") } },
        )
    }
}

@Composable
fun ProfileEditor(vm: MainViewModel, initial: SearchFilter) {
    var p by remember(initial.id) { mutableStateOf(initial) }
    val isNew = vm.store.state.value.searches.none { it.id == initial.id }
    val s = p.settings
    fun set(n: NotifySettings) { p = p.copy(settings = n) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(if (isNew) "Нов профил" else "Редактиране") },
                navigationIcon = { IconButton(onClick = { vm.cancelEdit() }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Назад") } },
                actions = {
                    TextButton(onClick = { vm.saveProfile(p.copy(name = p.name.trim().ifBlank { p.describe() })) }) { Text("Запази") }
                },
            )
        },
    ) { padding ->
        LazyColumn(
            Modifier.padding(padding),
            contentPadding = PaddingValues(12.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            item {
                OutlinedTextField(
                    value = p.name,
                    onValueChange = { p = p.copy(name = it) },
                    label = { Text("Име на профила (напр. Къщи до 50 хил. в Русе)") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
            item { Text("Какво търсим", style = MaterialTheme.typography.titleSmall) }
            item { FilterEditor(p) { p = it } }
            item { Text("Известия", style = MaterialTheme.typography.titleSmall) }
            item {
                Card {
                    Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        SwitchRow("Известията са включени", p.notify) { p = p.copy(notify = it) }
                        Text("Колко често да проверява", style = MaterialTheme.typography.labelLarge)
                        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            NotifyFrequency.entries.forEach { f ->
                                FilterChip(selected = s.frequency == f, onClick = { set(s.copy(frequency = f)) }, label = { Text(f.label) })
                            }
                        }
                        Text("Как да известява", style = MaterialTheme.typography.labelLarge)
                        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            NotifyStyle.entries.forEach { st ->
                                FilterChip(selected = s.style == st, onClick = { set(s.copy(style = st)) }, label = { Text(st.label) })
                            }
                        }
                        if (s.style == NotifyStyle.EACH) {
                            Text("Най-много отделни известия наведнъж (останалите се събират в едно)", style = MaterialTheme.typography.labelLarge)
                            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                listOf(1, 3, 5, 10).forEach { n ->
                                    FilterChip(selected = s.maxPerCheck == n, onClick = { set(s.copy(maxPerCheck = n)) }, label = { Text("$n") })
                                }
                            }
                        }
                        SwitchRow("Без звук и вибрация", s.silent) { set(s.copy(silent = it)) }
                        SwitchRow("Тихи часове (без известия през нощта)", s.quietHours) { set(s.copy(quietHours = it)) }
                        if (s.quietHours) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                HourStepper("от", s.quietFrom) { set(s.copy(quietFrom = it)) }
                                Spacer(Modifier.width(16.dp))
                                HourStepper("до", s.quietTo) { set(s.copy(quietTo = it)) }
                            }
                            Text(
                                "Обявите, открити през тихите часове, идват наведнъж след тях.",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        HorizontalDivider()
                        Text(
                            "Известие идва само ако има нови обяви. Резюме: ${s.describe()}",
                            style = MaterialTheme.typography.bodySmall,
                        )
                    }
                }
            }
            item {
                Button(onClick = { vm.saveProfile(p.copy(name = p.name.trim().ifBlank { p.describe() })) }, Modifier.fillMaxWidth()) {
                    Text(if (isNew) "Създай профила" else "Запази промените")
                }
            }
        }
    }
}

@Composable
private fun SwitchRow(label: String, checked: Boolean, onChange: (Boolean) -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(label, Modifier.weight(1f))
        Switch(checked = checked, onCheckedChange = onChange)
    }
}

@Composable
private fun HourStepper(label: String, hour: Int, onChange: (Int) -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(label)
        TextButton(onClick = { onChange((hour + 23) % 24) }) { Text("−") }
        Text("%02d:00".format(hour), fontWeight = FontWeight.Bold)
        TextButton(onClick = { onChange((hour + 1) % 24) }) { Text("+") }
    }
}
