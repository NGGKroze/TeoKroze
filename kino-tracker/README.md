# Кино Тракер България

Следи филмите в българските кина: текуща програма от кината, официален бокс офис от
**Национален филмов център (НФЦ)** и исторически класации от темата
[Bulgaria Box Office Thread](https://forums.boxofficetheory.com/topic/30981-bulgaria-box-office-thread-verity-breaks-out-heart-of-the-beast-going-strong-doomsday-with-astonishing-presales/)
във форума BoxOfficeTheory. Форумът се обхожда от страница 1 нататък.

## Как работи

```
GitHub Actions (всеки ден)          kino-tracker/data/*.json          GitHub Pages
  scraper/sources/forum.py   ─┐
  scraper/sources/nfc.py     ─┼─► scraper/build.py ─►  films.json  ─►  web/ (статичен сайт)
  scraper/sources/cinemas.py ─┘                         charts.json
                                                        showtimes.json, daily.json, status.json
```

| Източник | Какво дава | Как |
|---|---|---|
| Форум BoxOfficeTheory | уикенд класации назад във времето | обхожда всички страници (Invision Community), пази суровите постове в `data/forum_posts.json`, разпознава класации от вида `1. Филм – €123,456 / 10,234 adm` и HTML таблици |
| НФЦ (nfc.bg) | официален седмичен бокс офис | следва линкове „бокс офис“ и чете HTML таблици и XLS/XLSX/PDF/CSV файлове |
| Cinema City | програма за всички кина Cinema City в България | публичен JSON API (Quickbook) |
| Кино Арена, Cineland, Cine Grand, Cinemax, Евро Синема, Дом на киното, Одеон, Люмиер, G8 | програма | schema.org JSON-LD + CSS селектори по избор (`config/sources.json`) |

Филмите от различните източници се свързват по нормализирано заглавие. НФЦ дава и българско,
и оригинално заглавие, така че двете автоматично се свързват. Ръчни съответствия могат да се
добавят в `config/aliases.json`. Сумите в лева се превръщат в евро по фиксирания курс 1.95583.
Еврото е въведено на 1.1.2026.

## Пускане

```bash
cd kino-tracker
pip install -r requirements.txt
python -m scraper.run --full-forum      # първо пускане: целият форум от стр. 1
python -m scraper.run                   # после: само новите страници + НФЦ + кината
python -m scraper.run --reparse         # без мрежа: преизчисли от кеша след промяна на парсерите
python -m unittest discover -s tests    # тестове
python -m http.server -d . 8000         # после отвори http://localhost:8000/web/
```

### GitHub Pages
1. Settings → Pages → Source: **GitHub Actions**.
2. Actions → „Kino Tracker – scrape & publish“ → **Run workflow** (с отметка *full_forum* първия път).
3. Workflow-ът върви всеки ден, записва данните в `kino-tracker/data/` и публикува сайта.

## Настройка на кината
Табът **Кина** в приложението показва статус за всеки източник. Ако някое кино показва
„no films found“, в `config/sources.json` добави селектори за страницата му, например:

```json
{"id": "kinoarena", "type": "html", "urls": ["https://www.kinoarena.com/bg/program"],
 "selectors": {"film": ".movie-item", "title": "h3 a", "time": ".projection-time"}}
```

URL адресите, маркирани с `"verify": true`, не са проверени на живо, защото средата, в която е
писан кодът, нямаше достъп до тези сайтове. Може да се наложи да бъдат коригирани след първото
пускане.
