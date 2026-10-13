package main

// HP-GL files in the program: watched like GBRs; the only fix is putting back the
// notches that are missing compared with the marker.

import (
	"encoding/base64"
	"fmt"
	"path/filepath"
	"strings"
	"time"
)

// hpglKind: "HPG" or "PLT" – how the file is called in messages.
func hpglKind(name string) string {
	if k := strings.ToUpper(strings.TrimPrefix(filepath.Ext(name), ".")); k == "PLT" || k == "HPGL" {
		return k
	}
	return "HPG"
}

func (a *App) convertHPG(p, s string) {
	kind := hpglKind(p)
	cfg := a.conf()
	if !cfg.CheckMissing && cfg.RestoreMode == "off" {
		return
	}
	mm := a.FindMarker(p, filepath.Base(p), s)
	if mm.MRK == "" {
		a.waitForMarker(p)
		a.logEvent(Event{Time: now(), Src: p, Status: "info", NoMarker: true,
			Msg: kind + " файл: .MRK на маркировката не е намерен – липсващите нотчове не са проверени (посочете го с „Посочи .MRK…“ или добавете папката с маркировките в „Настройки“)."})
		return
	}
	a.pmu.Lock()
	delete(a.waitMrk, p)
	a.pmu.Unlock()
	markerNote := "Маркировка: " + mm.MRK + " (" + mm.How + ")"
	out, info, chk := RestoreHPG(s, loadDrawing(mm.MRK))
	info.SourceName = mm.MRK
	e := Event{Time: now(), Src: p, Marker: markerNote}
	switch {
	case chk.NoFit:
		e.Status, e.Msg = "warn", kind+" файлът не съвпада с маркировката "+filepath.Base(mm.MRK)+" (нотчовете не лежат на местата от маркировката) – нищо не е променено. Посочете друга .MRK или проверете настройките на плотера."
	case info.Restored == 0 && info.Unplaced == 0:
		e.Status, e.Msg = "info", fmt.Sprintf("%s файл: всички %d нотча от маркировката са налице – файлът не е променян.", kind, chk.Expected)
	case cfg.RestoreMode == "off":
		e.Status, e.Msg = "warn", fmt.Sprintf("%s файл: ЛИПСВАТ %d нотча (в файла %d от %d). Добавянето на липсващи нотчове е изключено в „Настройки“.", kind, info.Restored, chk.Found, chk.Expected)
	case info.Restored == 0:
		e.Status, e.Msg = "warn", info.Text()
	default:
		// An HPG has nothing to convert, so "separate" gives only the file with the
		// restored notches (…_fixed_restored), "same" gives the usual …_fixed.
		target := a.outPath(p)
		if cfg.RestoreMode == "separate" {
			target = a.restoredPath(p)
		}
		if err := writeAtomic(target, out); err != nil {
			e.Status, e.Msg = "error", "Грешка при запис на "+filepath.Base(target)+" (отворен ли е?): "+err.Error()
			e.Out = target
			a.logEvent(e)
			a.note(target, "error")
			return
		}
		if cfg.RestoreMode == "separate" {
			e.Out2 = target
		} else {
			e.Out = target
		}
		e.Status = "ok"
		e.RestoredFrom, e.RestoredN = mm.MRK, info.Restored
		e.Msg = fmt.Sprintf("%s файл: в него имаше %d от %d нотча. ", kind, chk.Found, chk.Expected) + info.Text() + " Прегледайте го преди рязане."
		if info.Unplaced > 0 {
			e.Status = "warn"
		}
	}
	e.Report = e.Msg
	if len(info.Coords) > 0 {
		e.Report += "\n  " + strings.Join(info.Coords, "\n  ") + "\n"
	}
	rp := filepath.Join(a.dir, "reports", time.Now().Format("20060102_150405_")+filepath.Base(p)+".txt")
	_ = writeAtomic(rp, strings.ReplaceAll(e.Report, "\n", "\r\n"))
	a.logEvent(e)
	if e.Status != "info" {
		target := e.Out
		if target == "" {
			target = e.Out2
		}
		if target == "" {
			target = p
		}
		a.note(target, e.Status)
	}
}

// convertHPGManual: a file opened in the window ("Ръчно конвертиране").
func (a *App) convertHPGManual(raw, name, path string) map[string]any {
	kind := hpglKind(name)
	d := a.recallMRK(name)
	src := "MRK файла"
	if d == nil {
		if m := a.FindMarker(path, name, raw); m.MRK != "" {
			d, src = loadDrawing(m.MRK), m.MRK
		}
	}
	before := Simulate(raw)
	resp := map[string]any{"name": name, "needsFix": false, "before": before, "after": before,
		"fixed": base64.StdEncoding.EncodeToString([]byte(raw))}
	if d == nil {
		resp["report"] = kind + " файл: няма .MRK на маркировката – отворете я заедно с файла или добавете папката ѝ в „Настройки“."
		return resp
	}
	out, info, chk := RestoreHPG(raw, d)
	info.SourceName = src
	rep := fmt.Sprintf("%s файл: в него има %d от %d нотча на маркировката.\n", kind, chk.Found, chk.Expected)
	if chk.NoFit {
		rep = kind + " файлът не съвпада с маркировката – нищо не е променено.\n"
	}
	if t := info.Text(); t != "" {
		rep += t + "\n  " + strings.Join(info.Coords, "\n  ") + "\n"
	}
	resp["report"] = rep
	if info.Restored > 0 {
		resp["needsFix"] = true
		resp["after"] = Simulate(out)
		resp["fixed"] = base64.StdEncoding.EncodeToString([]byte(out))
	}
	return resp
}
