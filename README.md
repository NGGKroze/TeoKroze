# Logistics Packing Solution

Единна програма (WinUI 3, изцяло на български и **изцяло офлайн**) за всички клиентски генератори на packing list и етикети.
Стартирате я, избирате клиент от големите плочки (или го търсите), и работите в неговия генератор.

```
LogisticsPacking.sln
src/LogisticsPacking.Core   ядро: откриване на модули, стартиране на Python модули, настройки (тестваемо)
src/LogisticsPacking.App    WinUI 3 обвивка: плочки, търсене, WebView2, сваляния, настройки
modules/<id>/               един клиент = една папка (виж по-долу)
runtime/                    общи помощници за Python модулите; тук се слага вграденият Python/Tesseract (билд)
installer/                  Inno Setup скрипт на инсталатора
tools/                      помощни скриптове (vendorize, assets, offline тест, подготовка на Python)
tests/                      xUnit тестове на ядрото
```

## Модулност - как се променя един клиент

Всеки клиент е **самостоятелна папка** в `modules/` с файл `module.json`. Обвивката не знае нищо друго за клиента.
Счупен или липсващ модул не пречи на останалите (показва се само в Настройки -> "Модули с проблем").

```json
{
  "id": "ami", "name": "AMI Paris", "version": "1.0.0",
  "type": "html",                 // "html" или "python"
  "entry": "index.html",          // html: входният файл; python: run.py
  "order": 20,                    // подредба на плочките
  "summary": "PKL плюс баркод данни",
  "requires": ["PKL Excel файл", "Barcode Excel файл"],   // показва се в "Нужни файлове"
  "formats": ["XLSX", "XLS"],
  "note": "…",
  "enabled": true,
  "python": { "script": "run.py", "port": 5057, "health": "/", "startupTimeoutSec": 90 },
  "variants": [ { "id": "prada", "name": "Prada", "onLoad": "document.getElementById('tabPradaBtn').click()" } ]
}
```

* **HTML модул** - `index.html` + `vendor/` (всички библиотеки локално, без CDN). Зарежда се във WebView2 през
  `https://<id>.lps.local/` - всеки модул има собствен "origin", затова версиите на библиотеките и `localStorage`
  не се бъркат между клиентите.
* **Python модул** - `run.py` (кратък стартер) + `backend/` (оригиналната програма, почти непроменена).
  Обвивката го стартира скрито на `127.0.0.1`, чака да отговори и го показва във WebView2. Спира го при "Затвори"
  или при изход (Job Object + следене на stdin - не остават "сираци").
  Оригиналните програми са променени само с 1 ред: папката за запис идва от `TEOKROZE_DATA_DIR`
  (маркирано с `# TEOKROZE`). Така обновена версия на клиента се слага лесно - повтаря се същият 1 ред.
* **Подклиенти** (`variants`) - напр. L'Oréal -> Valentino / Prada / Biotherm: плочката отваря втори екран.
  Всеки вариант може да изпълни скрипт след зареждане (избор на таб).

### Единен вид на клиентските екрани
Обвивката вкарва във всяка страница (преди скриптовете ѝ) общата тема: `runtime/lps-theme.js` + `runtime/lps-theme.css`
(мраморен фон, графит и месинг, шрифтове, полета, бутони; палитрата на Tailwind за акцентните цветове се подменя).
Всичко е само за екран - печатът на етикети и packing list не се променя. Модул може да има собствени корекции в
`modules/<id>/lps.css` (селектор `html[data-lps="<id>"] …`). Темата се изключва глобално в Настройки или за един
модул с `"theme": false` в `module.json`. Преглед: `node tools/theme_shots.mjs <папка>` + `python tools/contact_sheet.py`.

### Единна структура на екраните (док)
Всеки клиентски екран получава една и съща структура: **заглавие** (горе), **лява колона** с входни файлове и настройки,
**лента с действия** (долу, големи еднакви бутони - основните са графитени, второстепенните бели, опасните червени) и
**преглед/резултати** в средата. Прави се от `runtime/lps-layout.js` по `modules/<id>/layout.json`:
```json
{ "title": "…", "subtitle": "…",
  "hide": ["#old-header"],                       // стари заглавия, които се скриват
  "side": [{ "title": "1. Файл", "move": ["#drop-zone", "#field<"] },   // "<" на края = родителят (поле заедно с етикета му)
           { "card": false, "move": ["#panel"] }],                      // card:false = без допълнителна карта
  "actions": [{ "sel": "#print", "kind": "primary|secondary|danger", "side": "left|right" }],
  "style": [{ "sel": ".go", "kind": "primary" }] }                      // само оцветяване на бутони, без преместване
```
Местят се само контролите (възлите се местят, не се копират - манипулаторите остават). Печатните области и прегледите
не се пипат, затова печатът е непроменен (при печат докът е скрит). Бутон, който модулът показва/скрива чрез
КОНТЕЙНЕР, не се премества (ползва се `style`), иначе би се виждал винаги. Изключва се в Настройки или с `"layout": false`.
Проверка: `node tools/test_layout.mjs`; снимки: `node tools/theme_shots.mjs <папка>`.

### Български интерфейс
`runtime/lps-i18n.js` превежда видимия текст (и подсказките, placeholder-ите, диалозите) по речник: общ
`runtime/i18n/common.bg.json` + `modules/<id>/bg.json` (точни фрази + регулярни шаблони за динамични съобщения).
Етикетите, печатът и данните НЕ се превеждат (`skip` селектори). Липсва превод? В страницата (F12 -> Console):
`__lpsMissing()` връща непреведените английски низове; или `node tools/i18n_report.mjs <id>`.
Изключва се в Настройки или с `"translate": false` в `module.json`.

### Общ engine (OCR / PDF)
`runtime/lps_engine/` е единен слой за PDF текст с координати (PyMuPDF) и OCR (Tesseract). Работи като един общ процес
(`runtime/engine`, стартира се при първа нужда), а HTML модулите го ползват през `LPS.engine.pdfText(file)` /
`LPS.engine.ocrImage(file)` (виж `runtime/lps-engine.js`). Пример: Dior пада на OCR, ако PDF-ът е сканиран.
Python модулите (ACNE, ASPHALTE, COURREGES) ползват същия Tesseract (път през `TESSERACT_CMD`) и могат да `import lps_engine`.
Тестове: `python -m unittest discover -s tests/engine`, `node tools/test_engine_bridge.mjs`.

### Поправка на един клиент без нов инсталатор
Сложете обновената папка на модула в `%LOCALAPPDATA%\LogisticsPacking\modules\<id>\` (бутон в Настройки).
Тя има предимство пред вградената със същото `id`. Изтриете ли я - връща се вграденият.

### Нов клиент
1. Нова папка `modules/<id>/` с `module.json` + `index.html` (или `run.py` + `backend/`).
2. Библиотеки от CDN -> `python tools/vendorize.py <id>` ги сваля в `vendor/` и пренаписва адресите.
3. `PLAYWRIGHT_PATH=$(npm root -g)/playwright node tools/test_offline.mjs <id>` проверява, че работи без интернет.

## Билд (на Windows)

Нужни: **.NET 8 SDK**, **Visual Studio 2022** (Community или Build Tools) с workload *.NET desktop development*,
**Inno Setup 6**, и Python 3 само ако ползвате `-PrepareCache`.

```powershell
.\build.ps1                # тестове -> Python среда -> приложение -> dist\installer\LogisticsPacking-Setup-1.0.0.exe
.\build.ps1 -NoInstaller   # само dist\app (за проба: dist\app\LogisticsPacking.exe)
.\build.ps1 -Offline       # Python пакетите от tools\offline-cache (виж tools\prepare_runtime.ps1)
```

* Вграденият Python (3.12) и пакетите се подготвят от `tools\prepare_runtime.ps1`. OCR (Tesseract) се копира от
  инсталиран Tesseract-OCR (UB-Mannheim) в `runtime\tesseract` - без него не работи OCR на сканирани PDF.
* За инсталатор без интернет на клиентските машини сложете `MicrosoftEdgeWebView2RuntimeInstallerX64.exe`
  в `installer\redist\` (иначе инсталаторът предупреждава, ако WebView2 липсва; на Windows 11 обикновено го има).
* Инсталацията е за текущия потребител (без администраторски права) в `%LOCALAPPDATA%\Programs`.

## Папки с данни
* Настройки, логове, данни на модулите: `%LOCALAPPDATA%\LogisticsPacking\`
* Свалените файлове: `Документи\Logistics Packing\<Клиент>\` (сменя се в Настройки; може "питай къде да запиша").

## Проверки
```bash
dotnet test tests/LogisticsPacking.Core.Tests                       # ядро
PLAYWRIGHT_PATH=$(npm root -g)/playwright node tools/test_offline.mjs   # всички HTML модули без интернет
```
