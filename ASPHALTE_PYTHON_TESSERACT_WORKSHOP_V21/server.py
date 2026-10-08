from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import threading
import time
import urllib.request
import webbrowser
from pathlib import Path
from typing import Dict

from flask import Flask, Response, jsonify, request, send_file, send_from_directory
from werkzeug.utils import secure_filename

from asphalte_core import DEFAULT_SHIPPER, DEFAULT_RECEIVER, _v18_ean13_card_image, _v18_ident_barcode_image, build_from_order, build_from_edited_payload, build_from_edited_cartons, build_labels_from_existing_pl, analyze_orders_zip

APP_DIR = Path(__file__).resolve().parent
WEB_DIR = APP_DIR / "web"
JOBS_DIR = APP_DIR / "jobs"
JOBS_DIR.mkdir(exist_ok=True)

app = Flask(__name__, static_folder=str(WEB_DIR), static_url_path="")
JOBS: Dict[str, Dict] = {}


def save_upload(file_storage, work_dir: str, default_name: str):
    if not file_storage or not file_storage.filename:
        return None
    name = secure_filename(file_storage.filename) or default_name
    path = os.path.join(work_dir, name)
    file_storage.save(path)
    return path


def public_individual_downloads(job_id: str, outputs):
    public = []
    for item in outputs or []:
        oid = item.get("id")
        if not oid:
            continue
        public.append({
            "id": oid,
            "line_index": item.get("line_index", 0),
            "name": item.get("name", oid),
            "batch": item.get("batch", ""),
            "color": item.get("color", ""),
            "cartons": item.get("cartons", 0),
            "pieces": item.get("pieces", 0),
            "xlsx": f"/download/{job_id}/individual/{oid}/xlsx" if item.get("xlsx") else "",
            "labels_xlsx": f"/download/{job_id}/individual/{oid}/labels_xlsx" if item.get("labels_xlsx") else "",
            "pallet_labels_xlsx": f"/download/{job_id}/individual/{oid}/pallet_labels_xlsx" if item.get("pallet_labels_xlsx") else "",
        })
    return public


def store_job(job_id: str, work_dir: str, result: Dict):
    JOBS[job_id] = {
        "dir": work_dir,
        "payload": result.get("payload", {}),
        "individual": {i.get("id"): i for i in result.get("individual", []) if i.get("id")},
        **{k: v for k, v in result.items() if k in ("xlsx", "labels_xlsx", "pallet_labels_xlsx", "json", "zip")},
    }


@app.get("/")
def index():
    return send_from_directory(WEB_DIR, "index.html")


@app.post("/api/build/order")
def api_build_order():
    job_id = f"job_{int(time.time())}_{os.getpid()}_{len(JOBS)+1}"
    work_dir = str(JOBS_DIR / job_id)
    os.makedirs(work_dir, exist_ok=True)
    try:
        order_pdf = save_upload(request.files.get("order_pdf"), work_dir, "order.pdf")
        if not order_pdf:
            return jsonify({"ok": False, "error": "Upload an order PDF first."}), 400
        ean_xlsx = save_upload(request.files.get("ean_xlsx"), work_dir, "eans.xlsx")
        template_xlsx = save_upload(request.files.get("template_xlsx"), work_dir, "template.xlsx")
        manual_eans = request.form.get("manual_eans", "")
        ocr_mode = request.form.get("ocr_mode", "auto")
        carton_mode = request.form.get("carton_mode", "sequential")
        max_pcs = int(request.form.get("max_pcs", "15") or 15)
        shipment_date = request.form.get("shipment_date", "")
        identification_code = request.form.get("identification_code", "")
        tare_kg = float(request.form.get("tare_kg", "1.2") or 1.2)
        unit_kg = float(request.form.get("unit_kg", "1.3") or 1.3)
        pl_unit_kg = float(request.form.get("pl_unit_kg", "0.75") or 0.75)
        pallet_capacity = int(request.form.get("pallet_capacity", "16") or 16)
        result = build_from_order(
            order_pdf=order_pdf,
            work_dir=work_dir,
            ean_xlsx=ean_xlsx,
            template_xlsx=template_xlsx,
            manual_eans=manual_eans,
            ocr_mode=ocr_mode,
            max_pcs=max_pcs,
            carton_mode=carton_mode,
            shipment_date=shipment_date,
            identification_code=identification_code,
            tare_kg=tare_kg,
            unit_kg=unit_kg,
            pl_unit_kg=pl_unit_kg,
            pallet_capacity=pallet_capacity,
        )
        store_job(job_id, work_dir, result)
        payload = result["payload"]
        return jsonify({
            "ok": True,
            "job_id": job_id,
            "settings": {"max_pcs": max_pcs, "carton_mode": carton_mode, "tare_kg": tare_kg, "unit_kg": unit_kg, "pl_unit_kg": pl_unit_kg, "pallet_capacity": pallet_capacity, "shipment_date": shipment_date, "identification_code": payload.get("identification_code", "")},
            "downloads": {
                "xlsx": f"/download/{job_id}/xlsx",
                "labels_xlsx": f"/download/{job_id}/labels_xlsx",
                "pallet_labels_xlsx": f"/download/{job_id}/pallet_labels_xlsx",
                "json": f"/download/{job_id}/json",
                "zip": f"/download/{job_id}/zip",
            },
            "individual_downloads": public_individual_downloads(job_id, result.get("individual", [])),
            "summary": {
                "order": payload.get("parsed_order", {}).get("metadata", {}).get("production_order", ""),
                "product": payload.get("parsed_order", {}).get("metadata", {}).get("product_name", ""),
                "total_pieces": payload.get("parsed_order", {}).get("total_pieces", 0),
                "order_lines": len(payload.get("parsed_order", {}).get("order_lines", [])),
                "cartons": len(payload.get("cartons", [])),
                "pallets": payload.get("pallets", 0),
                "eans": len(payload.get("ean_rows", [])),
                "identification_code": payload.get("identification_code", ""),
                "warnings": payload.get("warnings", []),
            },
            "preview": {
                "ean_rows": payload.get("ean_rows", []),
                "metadata": payload.get("parsed_order", {}).get("metadata", {}),
                "order_lines": payload.get("parsed_order", {}).get("order_lines", []),
                "cartons": payload.get("cartons", [])[:500],
            }
        })
    except Exception as exc:
        return jsonify({"ok": False, "error": str(exc)}), 500


@app.post("/api/rebuild/order")
def api_rebuild_order():
    try:
        data = request.get_json(force=True) or {}
        old_job_id = data.get("job_id", "")
        old_job = JOBS.get(old_job_id)
        if not old_job:
            return jsonify({"ok": False, "error": "Original job was not found. Build the order again."}), 404
        job_id = f"edit_{int(time.time())}_{os.getpid()}_{len(JOBS)+1}"
        work_dir = str(JOBS_DIR / job_id)
        os.makedirs(work_dir, exist_ok=True)
        result = build_from_edited_payload(
            base_payload=old_job.get("payload", {}),
            work_dir=work_dir,
            order_lines=data.get("order_lines", []),
            max_pcs=int(data.get("max_pcs", 15) or 15),
            carton_mode=data.get("carton_mode", "sequential"),
            tare_kg=float(data.get("tare_kg", 1.2) or 1.2),
            unit_kg=float(data.get("unit_kg", 1.3) or 1.3),
            pl_unit_kg=float(data.get("pl_unit_kg", 0.75) or 0.75),
            pallet_capacity=int(data.get("pallet_capacity", 16) or 16),
            shipment_date=data.get("shipment_date", ""),
            identification_code=data.get("identification_code", ""),
        )
        store_job(job_id, work_dir, result)
        payload = result["payload"]
        return jsonify({
            "ok": True,
            "job_id": job_id,
            "settings": {"max_pcs": int(data.get("max_pcs", 15) or 15), "carton_mode": data.get("carton_mode", "sequential"), "tare_kg": float(data.get("tare_kg", 1.2) or 1.2), "unit_kg": float(data.get("unit_kg", 1.3) or 1.3), "pl_unit_kg": float(data.get("pl_unit_kg", 0.75) or 0.75), "pallet_capacity": int(data.get("pallet_capacity", 16) or 16), "shipment_date": data.get("shipment_date", ""), "identification_code": payload.get("identification_code", "")},
            "downloads": {"xlsx": f"/download/{job_id}/xlsx", "labels_xlsx": f"/download/{job_id}/labels_xlsx", "pallet_labels_xlsx": f"/download/{job_id}/pallet_labels_xlsx", "json": f"/download/{job_id}/json", "zip": f"/download/{job_id}/zip"},
            "individual_downloads": public_individual_downloads(job_id, result.get("individual", [])),
            "summary": {
                "order": payload.get("parsed_order", {}).get("metadata", {}).get("production_order", ""),
                "product": payload.get("parsed_order", {}).get("metadata", {}).get("product_name", ""),
                "total_pieces": payload.get("parsed_order", {}).get("total_pieces", 0),
                "order_lines": len(payload.get("parsed_order", {}).get("order_lines", [])),
                "cartons": len(payload.get("cartons", [])),
                "pallets": payload.get("pallets", 0),
                "eans": len(payload.get("ean_rows", [])),
                "identification_code": payload.get("identification_code", ""),
                "warnings": payload.get("warnings", []),
            },
            "preview": {"ean_rows": payload.get("ean_rows", []), "metadata": payload.get("parsed_order", {}).get("metadata", {}), "order_lines": payload.get("parsed_order", {}).get("order_lines", []), "cartons": payload.get("cartons", [])[:500]}
        })
    except Exception as exc:
        return jsonify({"ok": False, "error": str(exc)}), 500



@app.post("/api/rebuild/cartons")
def api_rebuild_cartons():
    """Rebuild the PKL / carton labels / pallet labels directly from a manually
    edited packing (carton) list, without recomputing cartons from the order
    lines. This is what the in-app packing editor calls after the user hand-edits
    box numbers, quantities, EAN codes, batches, colors, or adds/duplicates/deletes
    boxes, so the generated files always match exactly what is shown on screen."""
    try:
        data = request.get_json(force=True) or {}
        old_job_id = data.get("job_id", "")
        old_job = JOBS.get(old_job_id)
        if not old_job:
            return jsonify({"ok": False, "error": "Original job was not found. Build the order again."}), 404
        cartons = data.get("cartons", [])
        if not isinstance(cartons, list) or not cartons:
            return jsonify({"ok": False, "error": "The packing list is empty. Add at least one carton with quantities before saving."}), 400
        job_id = f"pack_{int(time.time())}_{os.getpid()}_{len(JOBS)+1}"
        work_dir = str(JOBS_DIR / job_id)
        os.makedirs(work_dir, exist_ok=True)
        result = build_from_edited_cartons(
            base_payload=old_job.get("payload", {}),
            work_dir=work_dir,
            cartons=cartons,
            tare_kg=float(data.get("tare_kg", 1.2) or 1.2),
            unit_kg=float(data.get("unit_kg", 1.3) or 1.3),
            pl_unit_kg=float(data.get("pl_unit_kg", 0.75) or 0.75),
            pallet_capacity=int(data.get("pallet_capacity", 16) or 16),
            shipment_date=data.get("shipment_date", ""),
            identification_code=data.get("identification_code", ""),
        )
        store_job(job_id, work_dir, result)
        payload = result["payload"]
        return jsonify({
            "ok": True,
            "job_id": job_id,
            "settings": {"tare_kg": float(data.get("tare_kg", 1.2) or 1.2), "unit_kg": float(data.get("unit_kg", 1.3) or 1.3), "pl_unit_kg": float(data.get("pl_unit_kg", 0.75) or 0.75), "pallet_capacity": int(data.get("pallet_capacity", 16) or 16), "shipment_date": data.get("shipment_date", ""), "identification_code": payload.get("identification_code", "")},
            "downloads": {"xlsx": f"/download/{job_id}/xlsx", "labels_xlsx": f"/download/{job_id}/labels_xlsx", "pallet_labels_xlsx": f"/download/{job_id}/pallet_labels_xlsx", "json": f"/download/{job_id}/json", "zip": f"/download/{job_id}/zip"},
            "individual_downloads": public_individual_downloads(job_id, result.get("individual", [])),
            "summary": {
                "order": payload.get("parsed_order", {}).get("metadata", {}).get("production_order", ""),
                "product": payload.get("parsed_order", {}).get("metadata", {}).get("product_name", ""),
                "total_pieces": payload.get("parsed_order", {}).get("total_pieces", 0),
                "order_lines": len(payload.get("parsed_order", {}).get("order_lines", [])),
                "cartons": len(payload.get("cartons", [])),
                "pallets": payload.get("pallets", 0),
                "eans": len(payload.get("ean_rows", [])),
                "identification_code": payload.get("identification_code", ""),
                "warnings": payload.get("warnings", []),
            },
            "preview": {"ean_rows": payload.get("ean_rows", []), "metadata": payload.get("parsed_order", {}).get("metadata", {}), "order_lines": payload.get("parsed_order", {}).get("order_lines", []), "cartons": payload.get("cartons", [])[:2000]}
        })
    except Exception as exc:
        return jsonify({"ok": False, "error": str(exc)}), 500


@app.post("/api/analyze/zip")
def api_analyze_zip():
    job_id = f"audit_{int(time.time())}_{os.getpid()}_{len(JOBS)+1}"
    work_dir = str(JOBS_DIR / job_id)
    os.makedirs(work_dir, exist_ok=True)
    try:
        zip_file = save_upload(request.files.get("orders_zip"), work_dir, "orders.zip")
        if not zip_file:
            return jsonify({"ok": False, "error": "Upload a ZIP with order PDFs first."}), 400
        ocr_mode = request.form.get("ocr_mode", "never")
        result = analyze_orders_zip(zip_file, work_dir, ocr_mode=ocr_mode)
        JOBS[job_id] = {"dir": work_dir, "json": result["json"], "csv": result["csv"]}
        return jsonify({
            "ok": True,
            "job_id": job_id,
            "downloads": {"json": f"/download/{job_id}/json", "csv": f"/download/{job_id}/csv"},
            "summary": result.get("summary", {}),
            "rows": result.get("rows", [])[:500],
        })
    except Exception as exc:
        return jsonify({"ok": False, "error": str(exc)}), 500


@app.post("/api/build/pl-labels")
def api_build_pl_labels():
    job_id = f"pl_{int(time.time())}_{os.getpid()}_{len(JOBS)+1}"
    work_dir = str(JOBS_DIR / job_id)
    os.makedirs(work_dir, exist_ok=True)
    try:
        pl_xlsx = save_upload(request.files.get("pl_xlsx"), work_dir, "packing_list.xlsx")
        if not pl_xlsx:
            return jsonify({"ok": False, "error": "Upload an existing packing-list XLSX first."}), 400
        ean_xlsx = save_upload(request.files.get("ean_xlsx"), work_dir, "eans.xlsx")
        manual_eans = request.form.get("manual_eans", "")
        tare_kg = float(request.form.get("tare_kg", "1.2") or 1.2)
        unit_kg = float(request.form.get("unit_kg", "1.3") or 1.3)
        pl_unit_kg = float(request.form.get("pl_unit_kg", "0.75") or 0.75)
        pallet_capacity = int(request.form.get("pallet_capacity", "16") or 16)
        shipment_date = request.form.get("shipment_date", "")
        identification_code = request.form.get("identification_code", "")
        result = build_labels_from_existing_pl(pl_xlsx, work_dir, ean_xlsx=ean_xlsx, manual_eans=manual_eans, tare_kg=tare_kg, unit_kg=unit_kg, pl_unit_kg=pl_unit_kg, pallet_capacity=pallet_capacity, shipment_date=shipment_date, identification_code=identification_code)
        store_job(job_id, work_dir, result)
        payload = result["payload"]
        meta = payload.get("metadata", {})
        return jsonify({
            "ok": True,
            "job_id": job_id,
            "settings": {"tare_kg": tare_kg, "unit_kg": unit_kg, "pl_unit_kg": pl_unit_kg, "pallet_capacity": pallet_capacity, "shipment_date": meta.get("shipment_date", shipment_date), "identification_code": meta.get("identification_code", "")},
            "downloads": {"labels_xlsx": f"/download/{job_id}/labels_xlsx", "pallet_labels_xlsx": f"/download/{job_id}/pallet_labels_xlsx", "json": f"/download/{job_id}/json", "zip": f"/download/{job_id}/zip"},
            "summary": {"cartons": len(payload.get("cartons", [])), "pallets": payload.get("pallets", 0), "eans": len(payload.get("ean_rows", [])), "identification_code": meta.get("identification_code", ""), "warnings": payload.get("warnings", [])},
            "preview": {"ean_rows": payload.get("ean_rows", []), "metadata": meta, "cartons": payload.get("cartons", [])[:2000]}
        })
    except Exception as exc:
        return jsonify({"ok": False, "error": str(exc)}), 500


# ---------------------------------------------------------------------------
# Barcode images for the on-screen label preview
# ---------------------------------------------------------------------------
BARCODE_DIR = JOBS_DIR / "_barcodes"


def _barcode_response(make):
    BARCODE_DIR.mkdir(exist_ok=True)
    path = make(str(BARCODE_DIR))
    if not path or not os.path.exists(path):
        return Response(status=204)
    resp = send_file(path, mimetype="image/png")
    resp.headers["Cache-Control"] = "public, max-age=3600"
    return resp


@app.get("/api/defaults")
def api_defaults():
    return jsonify({"shipper": DEFAULT_SHIPPER, "receiver": DEFAULT_RECEIVER})


@app.get("/api/barcode/ean")
def api_barcode_ean():
    ean = request.args.get("ean", "")
    color = request.args.get("color", "")
    size = request.args.get("size", "")
    return _barcode_response(lambda d: _v18_ean13_card_image(ean, color, size, d))


@app.get("/api/barcode/ident")
def api_barcode_ident():
    value = request.args.get("value", "")
    return _barcode_response(lambda d: _v18_ident_barcode_image(value, d))


# ---------------------------------------------------------------------------
# Lifecycle: the server closes itself when the browser window is closed
# ---------------------------------------------------------------------------
_CLIENTS = {"count": 0, "ever": False, "last_zero": time.time()}
_CLIENT_LOCK = threading.Lock()
GRACE_SECONDS = float(os.environ.get("ASPHALTE_GRACE", "8"))
STARTUP_SECONDS = float(os.environ.get("ASPHALTE_STARTUP_WAIT", "90"))


@app.get("/api/lifecycle")
def api_lifecycle():
    """Long-lived event stream. While a page is open it stays connected; when the
    browser/tab is closed the connection drops and the watchdog shuts the server down."""
    def stream():
        with _CLIENT_LOCK:
            _CLIENTS["count"] += 1
            _CLIENTS["ever"] = True
        try:
            while True:
                yield ": ping\n\n"
                time.sleep(2)
        finally:
            with _CLIENT_LOCK:
                _CLIENTS["count"] = max(0, _CLIENTS["count"] - 1)
                if _CLIENTS["count"] == 0:
                    _CLIENTS["last_zero"] = time.time()
    resp = Response(stream(), mimetype="text/event-stream")
    resp.headers["Cache-Control"] = "no-cache"
    resp.headers["X-Accel-Buffering"] = "no"
    return resp


def _watchdog():
    started = time.time()
    while True:
        time.sleep(1)
        with _CLIENT_LOCK:
            count, ever, last_zero = _CLIENTS["count"], _CLIENTS["ever"], _CLIENTS["last_zero"]
        if count > 0:
            continue
        if ever and time.time() - last_zero > GRACE_SECONDS:
            os._exit(0)
        if not ever and time.time() - started > STARTUP_SECONDS:
            os._exit(0)


@app.get("/download/<job_id>/<kind>")
def download(job_id: str, kind: str):
    job = JOBS.get(job_id)
    if not job or kind not in job:
        return jsonify({"ok": False, "error": "File not found or server was restarted."}), 404
    path = job[kind]
    download_names = {"xlsx": "generated_packing_list.xlsx", "labels_xlsx": "generated_labels.xlsx" if "generated_labels" in os.path.basename(path) else "labels_from_existing_packing_list.xlsx", "pallet_labels_xlsx": "generated_pallet_labels.xlsx" if "generated_pallet_labels" in os.path.basename(path) else "pallet_labels_from_existing_packing_list.xlsx", "json": "parsed_data.json", "csv": "training_audit.csv", "zip": "asphalte_output.zip"}
    return send_file(path, as_attachment=True, download_name=download_names.get(kind, os.path.basename(path)))


@app.get("/download/<job_id>/individual/<item_id>/<kind>")
def download_individual(job_id: str, item_id: str, kind: str):
    job = JOBS.get(job_id)
    item = (job or {}).get("individual", {}).get(item_id)
    if not item or kind not in ("xlsx", "labels_xlsx", "pallet_labels_xlsx") or not item.get(kind):
        return jsonify({"ok": False, "error": "Individual file not found or server was restarted."}), 404
    return send_file(item[kind], as_attachment=True, download_name=os.path.basename(item[kind]))


@app.get("/health")
def health():
    return jsonify({"ok": True, "app": "asphalte-workshop"})


def _find_app_browser():
    """Edge/Chrome in app mode gives a clean window (own title bar, no tabs)."""
    candidates = []
    for env in ("ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA"):
        base = os.environ.get(env)
        if not base:
            continue
        candidates.append(os.path.join(base, "Microsoft", "Edge", "Application", "msedge.exe"))
        candidates.append(os.path.join(base, "Google", "Chrome", "Application", "chrome.exe"))
    for name in ("msedge", "google-chrome", "chromium", "chrome"):
        found = shutil.which(name)
        if found:
            candidates.append(found)
    for c in candidates:
        if c and os.path.exists(c):
            return c
    return None


def open_browser(port: int):
    url = f"http://127.0.0.1:{port}/"
    exe = _find_app_browser()
    if exe and os.name == "nt":
        try:
            subprocess.Popen([exe, f"--app={url}", "--window-size=1500,950"], close_fds=True)
            return
        except Exception:
            pass
    webbrowser.open(url)


def open_browser_delayed(port: int):
    def _open():
        time.sleep(1.0)
        open_browser(port)
    threading.Thread(target=_open, daemon=True).start()


def _already_running(port: int) -> bool:
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/health", timeout=1.5) as r:
            return b"asphalte-workshop" in r.read()
    except Exception:
        return False


def _redirect_output_if_windowless():
    """pythonw.exe has no console: send prints/tracebacks to a log file instead of crashing."""
    if sys.stdout is None or sys.stderr is None:
        log_dir = Path(os.environ.get("LOCALAPPDATA", str(APP_DIR))) / "ASPHALTE_Workshop"
        log_dir.mkdir(parents=True, exist_ok=True)
        log = open(log_dir / "server.log", "a", encoding="utf-8", buffering=1)
        sys.stdout = sys.stdout or log
        sys.stderr = sys.stderr or log


if __name__ == "__main__":
    _redirect_output_if_windowless()
    port = int(os.environ.get("ASPHALTE_PORT", "8777"))
    # Single instance: if the app is already running, just bring up a window for it.
    if _already_running(port):
        if "--no-browser" not in sys.argv:
            open_browser(port)
        sys.exit(0)
    if "--no-browser" not in sys.argv:
        open_browser_delayed(port)
    if "--keep-alive" not in sys.argv:
        threading.Thread(target=_watchdog, daemon=True).start()
    print("\nASPHALTE Python + Tesseract Workshop")
    print(f"Open: http://127.0.0.1:{port}/")
    app.run(host="127.0.0.1", port=port, debug=False, threaded=True)
