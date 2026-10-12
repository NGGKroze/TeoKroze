package main

import (
	"fmt"
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
