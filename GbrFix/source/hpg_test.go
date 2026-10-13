package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// a square piece 40x40 mm at (100,100) in 1/40 mm with T notches (4 mm slit, 4 mm bar)
// at the middle of the bottom and left sides; Optitex left out the one on the top side.
func hpgSample() string {
	cmds := []string{"IN", "SP2",
		"PU4000,4000",
		"PD4800,4000", "PD4800,4160", "PU4720,4160", "PD4880,4160", "PU4800,4000", // bottom notch
		"PD5600,4000", "PD5600,5600", "PD4000,5600",
		"PD4000,4800", "PD4160,4800", "PU4160,4720", "PD4160,4880", "PU4000,4800", // left notch
		"PD4000,4000", "PU", "SP0", "PG"}
	return strings.Join(cmds, ";\r\n") + ";\r\n"
}

func sampleMarker() *svgDrawing {
	return &svgDrawing{Kind: "MRK", Pieces: []svgPiece{{
		Name: "p",
		Poly: [][2]int{{1000, 1000}, {1400, 1000}, {1400, 1400}, {1000, 1400}},
		Notches: [][4]int{
			{1200, 1000, 1200, 1040}, // bottom (in the file)
			{1000, 1200, 1040, 1200}, // left (in the file)
			{1200, 1400, 1200, 1360}, // top: missing
		},
	}}}
}

func TestRestoreHPG(t *testing.T) {
	in := hpgSample()
	out, info, chk := RestoreHPG(in, sampleMarker())
	if chk.Expected != 3 || chk.Found != 2 || info.Restored != 1 || info.Unplaced != 0 {
		t.Fatalf("check %+v, info %+v", chk, info)
	}
	// the T is drawn from the top edge downwards, with the same lengths, and the contour goes on
	want := "PD5600,5600;\r\nPD4800,5600;\r\nPD4800,5440;\r\nPU4720,5440;\r\nPD4880,5440;\r\nPU4800,5600;\r\nPD4000,5600;"
	if !strings.Contains(out, want) {
		t.Fatalf("restored T not found:\n%s", out)
	}
	if len(out) <= len(in) || !strings.HasSuffix(out, "PG;\r\n") || !strings.HasPrefix(out, "IN;\r\nSP2;\r\n") {
		t.Fatalf("file changed beyond the notch:\n%q", out)
	}
	if fmt.Sprint(info.Coords) != "[p: X1200Y1400]" || !strings.Contains(info.Form, "T-нотч 4.0 × 4.0 мм") {
		t.Fatalf("info %+v", info)
	}
	// once restored, nothing more to add; the file is not touched again
	out2, info2, _ := RestoreHPG(out, sampleMarker())
	if info2.Restored != 0 || out2 != out {
		t.Fatalf("second pass changed the file: %+v", info2)
	}
	// preview: the cut pen with its notches
	if s := Simulate(out); s.Notches != 3 {
		t.Fatalf("preview notches %d", s.Notches)
	}
}

func TestHPGNotMatchingMarker(t *testing.T) {
	d := sampleMarker()
	for i := range d.Pieces[0].Notches {
		d.Pieces[0].Notches[i][0] += 3000 // elsewhere on the marker
		d.Pieces[0].Notches[i][2] += 3000
	}
	out, info, chk := RestoreHPG(hpgSample(), d)
	if !chk.NoFit || info.Restored != 0 || out != hpgSample() {
		t.Fatalf("changed a file that does not fit: %+v %+v", chk, info)
	}
}

func TestIsHPGL(t *testing.T) {
	if !isHPGL(hpgSample()) || isHPGL(gbrOf(pcsA...)) {
		t.Fatal("wrong file type")
	}
}

// A notch at the very start of a contour (written before the knife goes down) is already
// there: restoring must not add it again (that gave a red cut in 2.0–2.6).
func TestRestoreKeepsNotchAtContourStart(t *testing.T) {
	gbr := "H1*ZX5000*N1*X100Y100*M19*X100Y140*M15*X100Y100*M14*X1100Y100*X1100Y600*X100Y600*X100Y100*M15*M0*"
	d := &svgDrawing{Kind: "MRK", Pieces: []svgPiece{{Name: "p",
		Poly:    [][2]int{{100, 100}, {1100, 100}, {1100, 600}, {100, 600}},
		Notches: [][4]int{{100, 100, 100, 140}}}}}
	out, info := RestoreMissing(gbr, d, 400)
	if info.Restored != 0 || out != gbr {
		t.Fatalf("notch at the contour start added again: %+v\n%s", info, out)
	}
}

// ---- the app: where the restored HPG goes, and the message for notches that cannot be placed ----

// mrkWithNotches: a marker file whose drawing has the given pieces with notch lines.
func mrkWithNotches(t *testing.T, d *svgDrawing) string {
	const h = 2000
	var b strings.Builder
	b.WriteString(`<?xml version="1.0"?><MARKER><STYLE><FILENAME></FILENAME></STYLE></MARKER>`)
	fmt.Fprintf(&b, `<svg viewBox="0 0 5000 %d">`, h)
	sx := func(x int) int { return x + 1 }
	sy := func(y int) int { return h - 1 - y }
	for _, p := range d.Pieces {
		pts := ""
		for _, q := range p.Poly {
			pts += fmt.Sprintf("%d,%d ", sx(q[0]), sy(q[1]))
		}
		fmt.Fprintf(&b, `<polygon comment="%s" points="%s"/>`, p.Name, pts)
		for _, n := range p.Notches {
			fmt.Fprintf(&b, `<path d="M%d,%d L%d,%d"/>`, sx(n[0]), sy(n[1]), sx(n[2]), sy(n[3]))
		}
	}
	b.WriteString("</svg>")
	return b.String()
}

func hpgApp(t *testing.T, mode, out string) (*App, string, string) {
	root := t.TempDir()
	hp := write(t, filepath.Join(root, "cut", "M1.HPG"), hpgSample())
	write(t, filepath.Join(root, "cut", "M1.MRK"), mrkWithNotches(t, sampleMarker()))
	cfg := defaultConfig()
	cfg.RestoreMode, cfg.OutMode = mode, out
	return testApp(t, cfg), hp, root
}

func exists(p string) bool { _, err := os.Stat(p); return err == nil }

func TestHPGSeparateWritesOnlyRestoredFile(t *testing.T) {
	a, hp, root := hpgApp(t, "separate", "suffix")
	a.process(hp, 0)
	rs := filepath.Join(root, "cut", "M1_fixed_restored.HPG")
	if !exists(rs) || exists(filepath.Join(root, "cut", "M1_fixed.HPG")) {
		t.Fatalf("files: %v", a.events)
	}
	if e := a.events[0]; e.Out2 != rs || e.Out != "" || e.Status != "ok" {
		t.Fatalf("event %+v", e)
	}
	if b, _ := os.ReadFile(hp); string(b) != hpgSample() {
		t.Fatal("original changed")
	}
}

func TestHPGSeparateInFolder(t *testing.T) {
	a, hp, root := hpgApp(t, "separate", "folder")
	a.process(hp, 0)
	if !exists(filepath.Join(root, "cut", "cut_fixed_restored", "M1.HPG")) || exists(filepath.Join(root, "cut", "cut_fixed", "M1.HPG")) {
		t.Fatalf("%v", a.events)
	}
}

func TestHPGSameWritesFixedFile(t *testing.T) {
	a, hp, root := hpgApp(t, "same", "suffix")
	a.process(hp, 0)
	if !exists(filepath.Join(root, "cut", "M1_fixed.HPG")) || exists(filepath.Join(root, "cut", "M1_fixed_restored.HPG")) {
		t.Fatalf("%v", a.events)
	}
	if e := a.events[0]; e.Out == "" || e.Out2 != "" {
		t.Fatalf("event %+v", e)
	}
}

func TestHPGOffWritesNothing(t *testing.T) {
	a, hp, root := hpgApp(t, "off", "suffix")
	a.process(hp, 0)
	if exists(filepath.Join(root, "cut", "M1_fixed.HPG")) || exists(filepath.Join(root, "cut", "M1_fixed_restored.HPG")) || a.events[0].Status != "warn" {
		t.Fatalf("%v", a.events)
	}
}

// Notches of pieces that are not in the GBR at all (Optitex left them out) cannot be put
// back; the message must say so and name the pieces instead of just "missing".
func TestGBRUnplacedNotchesAreExplained(t *testing.T) {
	root := t.TempDir()
	gbr := write(t, filepath.Join(root, "cut", "M1.GBR"), gbrOf(pcsA[0]))
	m := &svgDrawing{Kind: "MRK", Pieces: []svgPiece{
		{Name: "in-gbr", Poly: [][2]int{{100, 100}, {1100, 100}, {1100, 600}, {100, 600}}, Notches: [][4]int{{600, 100, 600, 140}}},
		{Name: "not-in-gbr", Poly: [][2]int{{3000, 3000}, {3500, 3000}, {3500, 3400}, {3000, 3400}}, Notches: [][4]int{{3250, 3000, 3250, 3040}, {3000, 3200, 3040, 3200}}},
	}}
	write(t, filepath.Join(root, "cut", "M1.MRK"), mrkWithNotches(t, m))
	a := testApp(t, defaultConfig())
	a.process(gbr, 0)
	msg := a.events[0].Msg
	for _, want := range []string{"2 нотча от маркировката НЕ могат да се върнат", "not-in-gbr: 2", "Втори файл с върнати 1"} {
		if !strings.Contains(msg, want) {
			t.Fatalf("missing %q in: %s", want, msg)
		}
	}
	if !exists(filepath.Join(root, "cut", "M1_fixed_restored.GBR")) {
		t.Fatal("the placeable notch was not restored")
	}
}

// ---- PLT: the notches are drawn on a pen of their own (pen 4), before the contour (pen 2) ----

// the same square piece as hpgSample; a T is  PU E; PU E; PD I; PU C1; PD C2
func pltSample(withTop bool) string {
	cmds := []string{"PU", "SP3", "LT", "PU0,0", "PD0,300",
		"SP4",
		"PU4800,4000", "PU4800,4000", "PD4800,4160", "PU4720,4160", "PD4880,4160", // bottom
		"PU4000,4800", "PU4000,4800", "PD4160,4800", "PU4160,4720", "PD4160,4880", // left
	}
	if withTop {
		cmds = append(cmds, "PU4800,5600", "PU4800,5600", "PD4800,5440", "PU4720,5440", "PD4880,5440") // top
	}
	cmds = append(cmds, "PU", "SP2", "PU4000,4000", "PD5600,4000", "PD5600,5600", "PD4000,5600", "PD4000,4000", "PU", "SP0", "PG")
	return strings.Join(cmds, ";\r\n") + ";\r\n"
}

func TestPLTNotchesAreFoundOnTheirOwnPen(t *testing.T) {
	st := parseHPG(pltSample(true)).steps()
	ns := hpgNotches(st)
	cut, notch := hpgPens(st, ns)
	if len(ns) != 3 || cut != "2" || notch != "4" || ns[0].ret {
		t.Fatalf("notches %d, cut pen %q, notch pen %q", len(ns), cut, notch)
	}
}

func TestRestorePLTKeepsTheFilesOwnForm(t *testing.T) {
	in := pltSample(false) // the top notch is missing
	out, info, chk := RestoreHPG(in, sampleMarker())
	if chk.Expected != 3 || chk.Found != 2 || info.Restored != 1 || chk.NoFit {
		t.Fatalf("check %+v info %+v", chk, info)
	}
	// written like the other notches: two "PU E", PD I, the crossbar – after the nearest notch (the left one)
	want := "PD4160,4880;\r\nPU4800,5600;\r\nPU4800,5600;\r\nPD4800,5440;\r\nPU4720,5440;\r\nPD4880,5440;\r\nPU;"
	if !strings.Contains(out, want) {
		t.Fatalf("restored T not found:\n%s", out)
	}
	if want := pltSample(true); strings.ReplaceAll(out, "\r\n", "") == "" || len(out) != len(want) {
		t.Fatalf("size differs from the complete file (%d vs %d):\n%s", len(out), len(want), out)
	}
	if !strings.Contains(info.Form, "T-нотч 4.0 × 4.0 мм с перо 4") {
		t.Fatalf("form %q", info.Form)
	}
	// nothing but added lines, and a second run adds nothing
	if out2, i2, _ := RestoreHPG(out, sampleMarker()); i2.Restored != 0 || out2 != out {
		t.Fatalf("second pass: %+v", i2)
	}
	if s := Simulate(out); s.Notches != 3 {
		t.Fatalf("preview notches %d", s.Notches)
	}
}

func TestCompletePLTIsLeftAlone(t *testing.T) {
	in := pltSample(true)
	out, info, chk := RestoreHPG(in, sampleMarker())
	if out != in || info.Restored != 0 || chk.Found != 3 || chk.Expected != 3 {
		t.Fatalf("%+v %+v", chk, info)
	}
}

func TestPLTFileIsWatchedAndWrittenWithItsExtension(t *testing.T) {
	root := t.TempDir()
	pl := write(t, filepath.Join(root, "cut", "M1.PLT"), pltSample(false))
	write(t, filepath.Join(root, "cut", "M1.MRK"), mrkWithNotches(t, sampleMarker()))
	a := testApp(t, defaultConfig())
	if !a.candidate(pl) {
		t.Fatal(".PLT is not a watched extension")
	}
	a.process(pl, 0)
	if !exists(filepath.Join(root, "cut", "M1_fixed_restored.PLT")) {
		t.Fatalf("%v", a.events)
	}
	if e := a.events[0]; !strings.HasPrefix(e.Msg, "PLT файл:") || e.Status != "ok" {
		t.Fatalf("event %+v", e)
	}
	// the files it wrote are not processed again
	if a.candidate(filepath.Join(root, "cut", "M1_fixed_restored.PLT")) {
		t.Fatal("own output would be processed again")
	}
}
