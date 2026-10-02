package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// two rectangular pieces, coordinates in 0.1 mm
type rect struct{ x0, y0, x1, y1 int }

func gbrOf(rs ...rect) string {
	var b strings.Builder
	b.WriteString("H1*ZX5000*")
	for i, r := range rs {
		fmt.Fprintf(&b, "N%d*X%dY%d*M14*X%dY%d*X%dY%d*X%dY%d*X%dY%d*M15*", i+1, r.x0, r.y0, r.x1, r.y0, r.x1, r.y1, r.x0, r.y1, r.x0, r.y0)
	}
	b.WriteString("M0*")
	return b.String()
}

const svgH = 2000

// mrkOf writes a marker whose drawing has the given pieces (SVG: y down, starts at 1).
func mrkOf(pds string, rs ...rect) string {
	var b strings.Builder
	b.WriteString(`<?xml version="1.0"?><MARKER><STYLE><FILENAME>` + pds + `</FILENAME></STYLE>`)
	for i, r := range rs {
		fmt.Fprintf(&b, `<PIECE><NAME>p%d</NAME><GEOM SIZE_X="%.1f" SIZE_Y="%.1f"/><ORDER_INFO NESTED="1"/></PIECE>`, i, float64(r.x1-r.x0)/10, float64(r.y1-r.y0)/10)
	}
	b.WriteString("</MARKER>")
	fmt.Fprintf(&b, `<svg viewBox="0 0 5000 %d">`, svgH)
	sx := func(x int) int { return x + 1 }
	sy := func(y int) int { return svgH - 1 - y }
	for i, r := range rs {
		fmt.Fprintf(&b, `<polygon comment="p%d" points="%d,%d %d,%d %d,%d %d,%d"/>`, i,
			sx(r.x0), sy(r.y0), sx(r.x1), sy(r.y0), sx(r.x1), sy(r.y1), sx(r.x0), sy(r.y1))
	}
	b.WriteString("</svg>")
	return b.String()
}

var (
	pcsA = []rect{{100, 100, 1100, 600}, {1300, 100, 1800, 900}}
	pcsB = []rect{{100, 100, 700, 700}, {900, 100, 1500, 400}}
)

func write(t *testing.T, p, s string) string {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(p), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(p, []byte(s), 0644); err != nil {
		t.Fatal(err)
	}
	return p
}

func testApp(t *testing.T, cfg Config) *App {
	dir := t.TempDir()
	_ = os.MkdirAll(filepath.Join(dir, "reports"), 0755)
	cfg.path = filepath.Join(dir, "gbrfix.ini")
	a := &App{cfg: cfg, dir: dir, pending: map[string]time.Time{}, done: map[string]string{}, waitMrk: map[string]time.Time{}}
	a.loadPairs()
	return a
}

func TestFindMarkerByNameInMarkerFolder(t *testing.T) {
	root := t.TempDir()
	gbr := write(t, filepath.Join(root, "cut", "M1.GBR"), gbrOf(pcsA...))
	mrk := write(t, filepath.Join(root, "markers", "2026", "M1.MRK"), mrkOf(`C:\x\none.PDS`, pcsA...))
	cfg := defaultConfig()
	a := testApp(t, cfg)
	if m := a.FindMarker(gbr, "M1.GBR", gbrOf(pcsA...)); m.MRK != "" {
		t.Fatalf("found %q without a marker folder", m.MRK)
	}
	cfg.MarkerDirs = []string{filepath.Join(root, "markers")}
	a = testApp(t, cfg)
	m := a.FindMarker(gbr, "M1.GBR", gbrOf(pcsA...))
	if m.MRK != mrk || !strings.HasPrefix(m.How, "по име") {
		t.Fatalf("got %+v", m)
	}
}

func TestFindMarkerOneFolderUp(t *testing.T) {
	root := t.TempDir()
	gbr := write(t, filepath.Join(root, "M1", "GBR", "M1.gbr"), gbrOf(pcsA...))
	mrk := write(t, filepath.Join(root, "M1", "M1.mrk"), mrkOf("", pcsA...))
	a := testApp(t, defaultConfig())
	if m := a.FindMarker(gbr, "M1.gbr", gbrOf(pcsA...)); m.MRK != mrk {
		t.Fatalf("got %+v", m)
	}
}

func TestFindMarkerByContentAndRejectsWrongSameName(t *testing.T) {
	root := t.TempDir()
	gbr := write(t, filepath.Join(root, "cut", "export.GBR"), gbrOf(pcsA...))
	// an old marker with the same name but other pieces must not be used
	write(t, filepath.Join(root, "markers", "old", "export.MRK"), mrkOf("", pcsB...))
	write(t, filepath.Join(root, "markers", "other.MRK"), mrkOf("", pcsB...))
	right := write(t, filepath.Join(root, "markers", "new", "Model 7 S-M-L.MRK"), mrkOf("", pcsA...))
	cfg := defaultConfig()
	cfg.MarkerDirs = []string{filepath.Join(root, "markers")}
	a := testApp(t, cfg)
	m := a.FindMarker(gbr, "export.GBR", gbrOf(pcsA...))
	if m.MRK != right || !strings.HasPrefix(m.How, "по съдържание") {
		t.Fatalf("got %+v", m)
	}
}

func TestFindPatternMovedPath(t *testing.T) {
	root := t.TempDir()
	gbr := write(t, filepath.Join(root, "cut", "M1.GBR"), gbrOf(pcsA...))
	write(t, filepath.Join(root, "markers", "M1.MRK"), mrkOf(`\\otherpc\styles\Jacket 12.PDS`, pcsA...))
	pds := write(t, filepath.Join(root, "styles", "Jacket 12.pds"), "<STYLE></STYLE>")
	cfg := defaultConfig()
	cfg.MarkerDirs = []string{filepath.Join(root, "markers"), filepath.Join(root, "styles")}
	a := testApp(t, cfg)
	if m := a.FindMarker(gbr, "M1.GBR", gbrOf(pcsA...)); m.PDS != pds {
		t.Fatalf("pds: got %+v", m)
	}
}

func TestChosenMarkerIsRemembered(t *testing.T) {
	root := t.TempDir()
	gbr := write(t, filepath.Join(root, "cut", "a.GBR"), gbrOf(pcsA...))
	mrk := write(t, filepath.Join(root, "x", "anything.MRK"), mrkOf("", pcsB...))
	a := testApp(t, defaultConfig())
	if err := a.setPair(gbr, mrk); err != nil {
		t.Fatal(err)
	}
	b := &App{dir: a.dir, cfg: a.cfg}
	b.loadPairs()
	if m := b.FindMarker(gbr, "a.GBR", gbrOf(pcsA...)); m.MRK != mrk || m.How != "избрана ръчно" {
		t.Fatalf("got %+v", m)
	}
}

func TestDriveRootsOfWatchAreNotWalked(t *testing.T) {
	c := defaultConfig()
	c.Watch = []string{string(filepath.Separator), "/data/cut"}
	c.MarkerDirs = []string{"/data/markers"}
	got := searchRoots(c)
	if strings.Join(got, "|") != "/data/markers|/data/cut" {
		t.Fatalf("got %v", got)
	}
}

// A GBR saved before its marker: processed again once the marker appears.
func TestWaitingGBRIsReprocessedWhenMarkerAppears(t *testing.T) {
	root := t.TempDir()
	cfg := defaultConfig()
	cfg.Watch = []string{filepath.Join(root, "cut")}
	cfg.MarkerDirs = []string{filepath.Join(root, "markers")}
	a := testApp(t, cfg)
	gbr := write(t, filepath.Join(root, "cut", "M1.GBR"), gbrOf(pcsA...))
	a.process(gbr, 0)
	if _, ok := a.waitMrk[gbr]; !ok || len(a.events) == 0 || !a.events[0].NoMarker {
		t.Fatalf("not waiting: %v %+v", a.waitMrk, a.events)
	}
	write(t, filepath.Join(root, "markers", "M1.MRK"), mrkOf("", pcsA...))
	a.markerSeen(filepath.Join(root, "markers", "M1.MRK"))
	a.mrkDirty = time.Now().Add(-5 * time.Second)
	a.retryWaiting()
	if len(a.waitMrk) != 0 {
		t.Fatalf("still waiting: %v", a.waitMrk)
	}
	if !strings.Contains(a.events[0].Marker, "M1.MRK") || a.events[0].NoMarker {
		t.Fatalf("reprocessed without marker: %+v", a.events[0])
	}
}
