# Дизайн на картите — Riftbound (работно име)

Решение: **правилата следват Yu-Gi-Oh!** (8000 LP, 5 карти в ръка, Normal Summon с tribute, Extra Deck, chain със Spell Speed, Main/Battle фази). Правилата и механиките не са защитени, но **имената, текстовете, артът, героите и терминологията са изцяло оригинални** — така играта не копира продукта, а само познатия геймплей. Това е и по-малко работа: махаме "Focus" ресурса и Realm слота от първия план. Правно мнение не е дадено; преди публикуване — проверка за име/марка.

## 1. Речник (YGO → наше)
| YGO | Наше | Бележка |
|---|---|---|
| Monster | **Unit** | Normal / Effect / Merge |
| Spell | **Tactic** | Normal, Quick, Continuous, Equip, Field |
| Trap | **Snare** | Normal, Continuous, Counter |
| Fusion | **Merge** | Extra Deck, материали по списък |
| Synchro / Xyz / Link / Ritual / Pendulum | *по-късно* | не са в MVP; добавяме по една, когато Merge е стабилен |
| Graveyard / Banish | Graveyard / Banish | |
| Tribute | Tribute | L5–6 = 1, L7+ = 2 |

## 2. Типове карти
- **Unit** – Level 1–8, ATK/DEF (кратни на 100), Attribute, Race.
  - *Normal* (без ефект), *Effect*, *Merge* (в Extra Deck, призовава се с Tactic като "Forge of Unity" / "Weave Together").
- **Tactic** – Normal (еднократна, само в твоя Main), Quick (по всяко време, със Spell Speed 2), Continuous, Equip, Field (един на играч).
- **Snare** – слага се затворена, активира се най-рано следващия ход; Normal, Continuous, Counter (Speed 3).

**Атрибути (6):** Flame, Stone, Radiance (+ Tide, Gale, Umbra — за следващите архетипи).
**Раси:** Beast, Warrior, Mage, Spirit, Construct, Dragon (+ Aquatic, Plant, Fiend по-късно).
**Рядкост:** Common / Rare / Epic / Mythic. Рядкостта **не** определя силата, а колко централна е картата; Mythic са боссове/финишъри.

## 3. Бюджет на статовете (за баланс)
Ориентир за обикновена карта: `(ATK+DEF)/2 ≈ Level×400 + 400`.
- Вградените ефекти *намаляват* статовете; чистите vanilla са около бюджета.
- L1–4: без tribute; L5–6: 1 tribute (+~400); L7–8: 2 tributes (+~800); Merge: като L8 но с материали.
- `tools/build_cards.py` предупреждава за карта над бюджета с повече от 600.
- Правило за дизайн: всеки архетип има **слабост** (Emberclaw – няма card advantage; Iron Covenant – бавен; Weavers – чупи се, ако му отнемеш материалите).

## 4. Архетипи
**В кода (60 карти, `cards/`):**

| Архетип | Атрибут/раса | Идентичност | Слабост | Брой |
|---|---|---|---|---|
| **Emberclaw** | Flame · Beast/Warrior/Dragon | Агресия + директни щети; Imp/Whelp за бързо поле, Volcarex като финишър | Свършват картите; уязвим на lifegain и Defense | 16 |
| **Iron Covenant** | Stone · Warrior/Construct | Defense стена, Equip карти, Colossus атакува с DEF | Бавен, малко директни щети | 16 |
| **Astral Weavers** | Radiance · Mage/Spirit | Merge + възстановяване от Graveyard, много tutor | Зависи от материали; слаб ако му счупиш Loom | 16 |
| **Neutral** | всякакви | Универсални инструменти (draw, removal, negate, revive) | — | 12 |

**Следващи архетипи (брифове):**
- **Verdant Cycle** (Plant/Beast, Gale/Stone) – връща карти от Graveyard, "расте" всеки ход; слаб срещу Banish и бърза агресия.
- **Tidebound** (Aquatic/Spirit, Tide) – tempo: връща карти в ръка, Quick Tactics и Counter Snares; слаб, ако няма ресурс за реакции.
- **Eclipse Court** (Fiend/Warrior, Umbra) – жертва LP и units за мощни ефекти; слаб към бърз burn и прекъснати разходи.

## 5. Стартови тестета (40 карти)
Всяко: 3 копия на ядрото, 2 на поддръжката, 1 на финишърите + Neutral колони. Точните рецепти са в `docs/CATALOG.md` като стартова точка за playtest; първата итерация е:
- **Emberclaw Starter:** 3 Ember Imp, 3 Whelp, 3 Scout, 3 Cindertail Fox, 3 Ashmane Lion, 2 Flare Raider, 2 Scorchwing Hawk, 2 Pyre Matriarch, 1 Magma Warden, 1 Volcarex, 3 Ember Spark, 2 Rekindle, 1 Caldera, 2 Backdraft, 1 Ash Veil, 3 Scholar's Gambit, 1 Shatter Strike, 1 Cleansing Gale, 1 Hollow Ward, 1 Forge of Unity + Extra: Pyrovex.
- **Iron Covenant Starter** и **Astral Weavers Starter** — по същата логика (виж каталога).
Тестетата ще се финализират след автоматични симулации (виж по-долу).

## 6. Формат на данните (`cards/*.json`)
Всяка карта: `id, name, type, subtype, archetype, attribute, race, level, atk, def, rarity, deck (main|extra), materials, text, effects[], art_brief, status`.
`effects[]` са машинно четими; `text` е човешкият текст (в бъдеще се генерира от ефектите).

Ефектът има: `timing` (`ignition`, `trigger`, `quick`, `continuous`, `summon_rule`, `replacement`, `on_resolve`), `trigger`, `cost`, `limit` (напр. веднъж на ход), `target`, `ops[]`.
**Примитиви (около 25 за този сет):** `damage, gain_lp, draw, discard, search, add_to_hand, special_summon, send, destroy, negate_attack, negate_activation, negate_summon, modify_stat, grant (keyword), set_position, force_attack_target, equip_from, merge_summon, reveal_top, shuffle_in`.
Всичко извън тях → ревюирано разширение на енджина, никога скрипт от клиента.

## 7. Арт посока
Единен рамков шаблон; цветът на рамката показва типа (Unit жълт/оранжев, Merge виолетов, Tactic зелен, Snare червен), символът в ъгъла – атрибута.

| Архетип | Палитра | Мотиви |
|---|---|---|
| Emberclaw | `#E8590C` `#2B1B17` `#FFD43B` | пепел, лава, нокти, вулкани |
| Iron Covenant | `#495057` `#4DABF7` `#ADB5BD` | щитове, руни, крепости, камък |
| Astral Weavers | `#7048E8` `#FFF3BF` `#0B1437` | нишки светлина, станове, съзвездия |
| Neutral | `#868E96` `#F1E4C3` | пътници, гилдии, обикновени реквизити |

Всяка карта има `art_brief` (едно изречение — готов prompt или задание за художник). Шаблон: *"[art_brief], digital fantasy painting, dramatic lighting, [палитра], centered subject, no text, no logos, no existing characters"*.
Правила: един и същи герой/стил в рамките на архетипа; текстът никога не е в арта; за всеки ресурс се записва **източник и права** (особено при AI-генериран арт — проверка за артефакти и приличие на съществуващи персонажи).

## 8. Следващи стъпки
1. Playtest на хартия/в таблица с трите стартови тестета (`cards/*.json`) — 20 мача, записваме кой печели, дължина на мача, "мъртви" карти.
2. Корекции на статове/ефекти → нови версии в `tools/build_cards.py`.
3. Headless енджин (Python или C#/TS) за правилата + бот; автоматични 10 000 мача за баланс.
4. Арт: първи пакет от 3 илюстрации на архетип (Mythic + 2 обикновени), за да се определи стилът.
5. Втора вълна: Verdant Cycle, Tidebound, Eclipse Court (≈16 карти всеки).
