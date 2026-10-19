COURREGES Packing List / Carton Label Generator - V35
====================================================

What this version changes
-------------------------
This is no longer a pure browser-only parser. It uses a local Python backend with:
- PyMuPDF for coordinate-based PDF text-layer extraction.
- Tesseract OCR for image-only/scanned PDFs.
- openpyxl for generating approved-style Excel packing lists and carton labels.
- Browser UI for importing, reviewing, correcting, and exporting.

How to start
------------
1. Extract the ZIP to a normal folder, for example Desktop\COURREGES_Python_Tesseract_V35.
2. Double-click start.bat.
3. Keep the black command window open.
4. The browser opens automatically at http://127.0.0.1:8765.

What start.bat does
-------------------
- Creates a local .venv Python environment.
- Installs required Python packages.
- Checks for Tesseract OCR.
- If Tesseract is missing and winget is available, it tries to install UB-Mannheim Tesseract.

If OCR still does not work
--------------------------
Install Tesseract manually and restart start.bat.
The common Windows path is:
C:\Program Files\Tesseract-OCR\tesseract.exe

Recommended use
---------------
For normal COURREGES order PDFs with selectable text:
- Leave Force OCR OFF.
- The parser uses PDF coordinates, which is more accurate than OCR.

For image-only/scanned PDFs:
- Turn Force OCR ON.
- Parse, then check the preview table before exporting.

Packing logic
-------------
Default export grouping is:
- One packing list per order number.
- Each order can include several internal color/style sections.

Default carton logic is:
- 25 pcs per carton.
- Full cartons by size first.
- Mixed remainder cartons after that.

Labels-only from packing lists
------------------------------
Use the section "Labels only from finished packing lists" to upload already approved Packing_List.xlsx files.
The program reads only PACKING LIST DETAIL PER BOXES/HANGERS sections.
It ignores COURREGES ORDER SUMMARY and total summary rows, so phantom labels should not be created.

Important
---------
Always review the parsed table before export. PDF/OCR extraction can still be affected by unusual scans, tilted pages, or bad text layers.


V33 update
----------
- Added popup editor for each order/style/color row. Click the order number, style, or Edit button in the review table.
- Popup lets you edit quantities XS/S/M/L/XL/XXL, order/style/color fields, EAN, and per-row packing overrides.
- Override fields can be left blank; blank means the default pieces per carton, net kg/piece, tare kg, and box size from the left panel are used.
- Estimated pieces/cartons update live after changes and exports use the row-level overrides.

V33 changes:
- Drag and drop fixed for PDF orders and finished Packing_List.xlsx files.
- Added selected export buttons next to order/style rows and order cards.
- Use the selected export button to generate only one PO/order or one style/color packing list + labels instead of exporting all rows.


V33 update
- Fixed individual export errors by adding a safer backend export route.
- Added separate Packing List / Labels / ZIP buttons for each order and style/color row.
- Downloaded orders/styles are highlighted green with a checkmark.
- Backend returns readable plain-text errors instead of a browser HTML 500 popup.


V35 update
----------
- Fixed the carton-label export crash caused by an Excel column-dimension index issue.
- Replaced per-row PL / Labels / ZIP buttons with one Both button that downloads the packing list and carton labels as two separate Excel files, not a ZIP.
- Main and selected export buttons now use separate Excel downloads instead of ZIP for the normal workflow.
- Packing-list Excel formatting rebuilt with stronger merged-cell borders, compact approved-style column widths, no freeze pane, and cleaner black title/total rows.
- Downloaded orders/style rows stay highlighted green with a checkmark.

V35 changes:
- Carton labels now create one Excel worksheet per printable A4 landscape page, with a maximum of two labels per sheet.
- Label borders cleaned to remove odd thick/bold fragments around merged cells.
- The Both buttons still download Packing List and Carton Labels as two separate Excel files, not a ZIP.
