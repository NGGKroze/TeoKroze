# ASPHALTE Python + Tesseract Workshop v21

## v21.1: colour text touching the quantities

When the supplier-colour text ends right next to the first quantity (`...NAVY` + `3`), the previous
layout reader glued them into one cell and shifted every quantity. The layout reader now uses every
text-show operation of the PDF as its own cell (`get_texttrace`), keeps the old heuristic reader as a
fallback, and the reading that matches row totals and the GLOBAL ORDER total is chosen.

## New in v21

**Order detection (OF-2188 type PDFs).** In some PDFs the supplier-colour text sits right next to the first
size/quantity cells, so the text layer glues them together and the first quantities were shifted. The order
table is now also read from the page's character positions (layout-aware cells), both readings are scored and
the better one is used, cross-checked against the "GLOBAL ORDER -> TOTAL" in the PDF. OF-2188: 9 lines, 594 pcs.

**Barcodes for ready packing lists.** In "Готов PKL" mode there is now an EAN / SKU Excel drop zone (plus a
manual EAN box) and the same settings as the order mode (weights, pallet capacity, date, identification code).
EANs are matched by colour + size onto the cartons, so the labels can be regenerated with barcodes. Add or
change the EAN file and press the button again to regenerate. When you save the packing table, cartons with an
empty EAN get it filled from the loaded EAN file automatically.

**Label preview.** New result tab "Превю на етикети" shows the carton label as it will be built (addresses,
N of M, gross weight, sizes, identification barcode and the EAN barcode cards) for every carton, following the
current packing table. Missing/invalid EANs are flagged in red.

**Compact layout.** The KPI tiles (order, pieces, lines, cartons, pallets, kg ...) are one compact horizontal
row instead of a tall column, and order lines / packing / label preview are separate tabs, so the page is no
longer pushed far down.

**Starts and stops cleanly.**
- The server closes itself a few seconds after the browser window is closed. No cmd window to forget.
- Single instance: starting the program again while it runs just opens a new window to the running instance.
- `ASPHALTE.vbs` (or the desktop shortcut) starts it with no console window at all; `start.bat` does the
  first-time setup, creates the desktop shortcut with the app icon (once) and then starts the app hidden.
- Opens as an app window (Edge/Chrome `--app`) when available. Log: `%LOCALAPPDATA%\ASPHALTE_Workshop\server.log`.
- Developer switches: `python server.py --keep-alive` (do not auto-exit), `--no-browser`.
- If the barcode library is missing, a built-in Code128 renderer is used for the identification barcode.

## History

### v20.1: numeric colour codes in orders

Orders where a colour is written as a number (e.g. `Beige / 18225` instead of a supplier colour name,
or even a numeric Asphalte colour) were silently dropped by the parser. The parser now accepts a
4-6 digit colour code in the colour columns, and decides between "colour code" and "quantity" by
checking which reading makes the size quantities add up to the row total. Verified on OF-2118
(La Parka d'Hiver V2, Batch 100): all 3 rows / 210 pcs are now detected (before: Beige was missing).

## New in v20: cleaned-up `asphalte_core.py`

`asphalte_core.py` had accumulated several generations of the same functions (v13 → v19
"upgrades"), each one redefining the previous - `build_labels_xlsx` alone was defined 6 times,
plus 2 duplicate definitions each of `build_packing_list_xlsx`, `normalize_size`, `sort_sizes`,
`extract_sizes_from_section`, `detect_size_from_sku`, `parse_manual_eans`, `parse_eans_xlsx` and
the internal `_v14_barcode_png_path`/`_v13_write_packing_sheet` helpers. Since Python only ever
runs the *last* definition of a name, every earlier copy was dead weight: ~1,270 lines (26% of
the file) that never ran, but made the file slower to read and risked someone editing the wrong
(inactive) copy.

All of that dead code has been removed. The one place where an older version was still reachable
(the packing-sheet layout writer, which layered v13 → "extended" refinements → the final v19
version through a function-alias trick) was untangled into three clearly named, explicitly
chained functions (`_write_packing_sheet_base` → `_write_packing_sheet_extended` →
`_v13_write_packing_sheet`) instead of three same-named redefinitions.

This was verified behavior-preserving by differential testing: every generated PKL / carton
labels / pallet labels Excel file (cell values across all sheets, for both alphabetic and numeric
size systems), every parsed EAN/size/order payload, and the packing-editor rebuild endpoint were
compared line-for-line against the pre-cleanup v19.2 code and are identical. Nothing about how the
app behaves has changed - `asphalte_core.py` is just ~26% shorter and much easier to navigate.

## Direct packing (carton) editing

After a PKL is generated (from a PDF order or from an existing packing list), the workspace
now shows an editable **"Опаковъчен лист (пакинг) · директна редакция"** table. Every cell -
box number, batch, reference, color, per-size quantities, EAN - is a live input. Editing any
cell updates the on-screen totals (cartons / pieces / pallets / weight) immediately, no
re-upload or re-parse needed. You can also add a blank carton, duplicate/split an existing one,
delete one, or auto-renumber box numbers.

These edits are independent from the order-line editor: once you touch the packing table
directly, it stops being auto-recalculated from the order lines (a banner says so), so your
manual corrections are never silently discarded. Press **"Запази пакинга и обнови файловете"**
to regenerate the PKL Excel, carton labels Excel and pallet labels Excel exactly as shown in
the table. If you'd rather discard the manual edits and go back to automatic cartonization from
the order lines, use **"Регенерирай от редовете"**.

## Windows start

Extract the whole folder and run `start.bat`.

### First start
The launcher automatically:
1. creates/rebuilds the shared Python virtual environment,
2. installs all packages from `requirements.txt`,
3. installs Tesseract OCR through Windows Package Manager (winget) if Tesseract is missing.

Only a successful setup is marked complete.

### Normal starts
After setup, `start.bat` does not run pip and does not ask about Tesseract. It only starts the local application.

The shared environment is stored in `%LOCALAPPDATA%\ASPHALTE_Workshop`.
