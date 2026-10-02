package main

// The marker that is open in Optitex Marker. Marker shows the marker's name (often the
// full path) in its window title, so when a GBR is exported the marker it came from is
// usually the one in the title. The titles are read every few seconds and remembered
// for a while, because the GBR is processed a few seconds after it is written and the
// user may have opened another marker meanwhile (the pieces are checked anyway).

import (
	"path/filepath"
	"strings"
	"time"
)

type markerHint struct {
	text string // full path or name of the marker
	path bool   // text is a full path
	seen time.Time
}

const hintMaxAge = 30 * time.Minute

// readMarkerTitles is replaced in tests.
var readMarkerTitles = markerWindowTitles

// parseMarkerTitle finds marker paths/names in a Marker window title, e.g.
// "Marker 26 - [D:\Markers\City-New-Lice-38.mrk]" or "City-New-Lice-38 - Optitex Marker".
func parseMarkerTitle(title string) []markerHint {
	var out []markerHint
	seen := map[string]bool{}
	add := func(t string) {
		t = strings.TrimSpace(strings.Trim(strings.TrimSpace(t), "*"))
		if t == "" || seen[strings.ToLower(t)] {
			return
		}
		seen[strings.ToLower(t)] = true
		out = append(out, markerHint{text: t, path: strings.Contains(t, `\`) || strings.Contains(t, "/")})
	}
	lower := strings.ToLower(title)
	for off := 0; ; {
		i := strings.Index(lower[off:], ".mrk")
		if i < 0 {
			break
		}
		i += off
		off = i + 4
		if off < len(lower) && isNameChar(lower[off]) {
			continue // ".mrkx" or similar
		}
		before := title[:i]
		if k := strings.LastIndexAny(before, `[]()"|<>*`); k >= 0 {
			before = before[k+1:]
		}
		switch {
		case strings.Contains(before, `:\`):
			before = before[strings.Index(before, `:\`)-1:]
		case strings.Contains(before, `\\`):
			before = before[strings.Index(before, `\\`):]
		default:
			for _, sep := range []string{" - ", " – ", `\`, "/"} {
				if k := strings.LastIndex(before, sep); k >= 0 {
					before = before[k+len(sep):]
				}
			}
		}
		full := strings.TrimSpace(before) + title[i:i+4]
		add(full)
		if strings.ContainsAny(full, `\/`) {
			add(filepath.Base(strings.ReplaceAll(full, `\`, "/")))
		}
	}
	// titles without ".mrk": every part may be the marker's name (only names that
	// exist in the marker folders are used)
	parts := strings.FieldsFunc(title, func(r rune) bool { return strings.ContainsRune(`[]()|"`, r) })
	for _, p := range parts {
		for _, q := range strings.Split(strings.ReplaceAll(p, " – ", " - "), " - ") {
			if q = strings.TrimSpace(q); len(q) >= 3 && !strings.Contains(strings.ToLower(q), ".mrk") {
				add(q)
			}
		}
	}
	return out
}

// isMarkerWindow: a window of Optitex Marker. Optitex 26 calls it "Optitex Mark 26"
// (title "NAME - Optitex Mark 26"); the program is in an Optitex folder and its .exe
// name may be just "Mark".
func isMarkerWindow(title, exePath string) bool {
	t := strings.ToLower(title)
	exe := strings.ToLower(strings.ReplaceAll(exePath, `\`, "/"))
	base := exe[strings.LastIndex(exe, "/")+1:]
	if base == "msedge.exe" || base == "chrome.exe" || base == "explorer.exe" {
		return false // browser tabs / folders that only mention Optitex
	}
	return strings.Contains(t, "optitex mark") || strings.Contains(base, "mark") ||
		(strings.Contains(exe, "optitex") && strings.Contains(t, " - "))
}

func isNameChar(c byte) bool {
	return c >= 'a' && c <= 'z' || c >= '0' && c <= '9' || c == '_'
}

// pollMarker reads the Marker window titles now.
func (a *App) pollMarker() {
	titles := readMarkerTitles()
	now := time.Now()
	a.hmu.Lock()
	defer a.hmu.Unlock()
	a.markerTitles = titles
	for _, t := range titles {
		for _, h := range parseMarkerTitle(t) {
			h.seen = now
			found := false
			for i := range a.hints {
				if strings.EqualFold(a.hints[i].text, h.text) {
					a.hints[i].seen, found = now, true
					break
				}
			}
			if !found {
				a.hints = append(a.hints, h)
			}
		}
	}
	keep := a.hints[:0]
	for _, h := range a.hints {
		if now.Sub(h.seen) < hintMaxAge {
			keep = append(keep, h)
		}
	}
	a.hints = keep
}

// recentHints: markers seen in Marker, most recently seen first.
func (a *App) recentHints() []markerHint {
	a.hmu.Lock()
	defer a.hmu.Unlock()
	out := append([]markerHint(nil), a.hints...)
	for i := 1; i < len(out); i++ {
		for j := i; j > 0 && out[j].seen.After(out[j-1].seen); j-- {
			out[j], out[j-1] = out[j-1], out[j]
		}
	}
	return out
}

func (a *App) currentMarkerTitles() []string {
	a.hmu.Lock()
	defer a.hmu.Unlock()
	return append([]string(nil), a.markerTitles...)
}
