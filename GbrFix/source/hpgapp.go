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

func (a *App) convertHPG(p, s string) {
	cfg := a.conf()
	if !cfg.CheckMissing && cfg.RestoreMode == "off" {
		return
	}
	mm := a.FindMarker(p, filepath.Base(p), s)
	if mm.MRK == "" {
		a.waitForMarker(p)
		a.logEvent(Event{Time: now(), Src: p, Status: "info", NoMarker: true,
			Msg: "HPG файл: .MRK на маркировката не е намерен – липсващите нотчове не са проверени (посочете го с „Посочи .MRK…“ или добавете папката с маркировките в „Настройки“)."})
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
		e.Status, e.Msg = "warn", "HPG файлът не съвпада с маркировката "+filepath.Base(mm.MRK)+" (нотчовете не лежат на местата от маркировката) – нищо не е променено. Посочете друга .MRK или проверете настройките на плотера."
	case info.Restored == 0 && info.Unplaced == 0:
		e.Status, e.Msg = "info", fmt.Sprintf("HPG файл: всички %d нотча от маркировката са налице – файлът не е променян.", chk.Expected)
	case cfg.RestoreMode == "off":
		e.Status, e.Msg = "warn", fmt.Sprintf("HPG файл: ЛИПСВАТ %d нотча (в файла %d от %d). Добавянето на липсващи нотчове е изключено в „Настройки“.", info.Restored, chk.Found, chk.Expected)
	case info.Restored == 0:
		e.Status, e.Msg = "warn", info.Text()
	default:
		e.Out = a.outPath(p)
		if err := writeAtomic(e.Out, out); err != nil {
			e.Status, e.Msg = "error", "Грешка при запис на "+filepath.Base(e.Out)+" (отворен ли е?): "+err.Error()
			a.logEvent(e)
			a.note(e.Out, "error")
			return
		}
		e.Status = "ok"
		e.RestoredFrom, e.RestoredN = mm.MRK, info.Restored
		e.Msg = fmt.Sprintf("HPG файл: в него имаше %d от %d нотча. ", chk.Found, chk.Expected) + info.Text() + " Прегледайте го преди рязане."
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
			target = p
		}
		a.note(target, e.Status)
	}
}

// convertHPGManual: a file opened in the window ("Ръчно конвертиране").
func (a *App) convertHPGManual(raw, name, path string) map[string]any {
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
		resp["report"] = "HPG файл: няма .MRK на маркировката – отворете я заедно с HPG файла или добавете папката ѝ в „Настройки“."
		return resp
	}
	out, info, chk := RestoreHPG(raw, d)
	info.SourceName = src
	rep := fmt.Sprintf("HPG файл: в него има %d от %d нотча на маркировката.\n", chk.Found, chk.Expected)
	if chk.NoFit {
		rep = "HPG файлът не съвпада с маркировката – нищо не е променено.\n"
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
