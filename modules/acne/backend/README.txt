ACNE PDF/XLSX Packing + Labels App - V16 SMART BOX PARSER + LIVE PREVIEW

How to run:
1. Extract this ZIP.
2. Double-click RUN_ACNE_PDF_APP.bat.
3. The BAT creates/updates the local .venv and installs required packages.
4. Wait for the browser tab to open.
5. Drop one or more Acne PO PDFs, or existing Acne Packing List .xlsx/.xlsm files.
6. Close the browser tab to stop the local server and close the CMD window.

V16 changes:
- Existing packing parser now accepts CARTON #, CTN #, BOX/BOX #, and sheets where the carton area is named differently, such as Hanging / Boxes.
- If an existing packing has no explicit carton/box number per row, the app treats each quantity row as a box/carton and numbers them sequentially for labels.
- Parser is anchored on STYLE NAME, COLOR NAME, COLOR CODE, CHOOSE APPLICABLE SIZE SCALE, and TTL UNITS, so small header wording changes are handled better.
- Added live Packing List preview in the browser.
- Added live Labels preview in the browser for both PDF-generated orders and imported existing packing lists.
- Preview updates when editing quantities, sizes, color codes, destination, shipment date, carton strategy, etc.

Kept from V15:
- Drop existing Acne Packing List .xlsx/.xlsm files into the same upload area.
- Imported packing lists preserve the original carton split for label generation.
- Imported packing orders can still be edited in the browser and exported as labels / packing / both.
- Legacy .xls files show a clear message asking to save as .xlsx first.

Kept from V14:
- No required PyMuPDF dependency, so pip should not fail with Visual Studio / fitz errors.
- Uses pypdf for normal Acne PDF text extraction.
- Optional OCR path remains only when compatible OCR libraries are already installed.
- Browser-tab close detection stops the local Python server.

Label logic:
- Single SKU carton = one A4 portrait sheet.
- Multi SKU carton = A4 landscape sheet, max 4 labels per sheet.
- In Multi SKU sheets: label 1 starts with Ship To, label 2 starts with Shipment Date, label 3/4 start with PO #.

Destination auto-detection from PO internal order type:
- PurchaseOrder -> SE / WH SE Spånga
- US3PLPurchaseOrder -> US / 3PL US
- KR3PLPurchaseOrder -> KR / 3PL KR
- JP3PLPurchaseOrder -> JP / 3PL JP
- CN3PLPurchaseOrder -> CN / 3PL CN


V17 file naming fix:
- Packing and label workbooks inside ZIP exports now have different descriptive names:
  PACKING_LIST_<PO>_<destination>_<style>.xlsx
  CARTON_LABELS_<PO>_<destination>_<style>.xlsx
- Export All also prefixes each order with 01, 02, 03... so files from multiple orders will not overwrite each other if copied into one folder.
- ZIP creation also protects against accidental duplicate names by adding _02, _03, etc.
