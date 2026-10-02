package main

import (
	"path/filepath"
	"strings"
	"testing"
)

func hintTexts(hs []markerHint) []string {
	var out []string
	for _, h := range hs {
		out = append(out, h.text)
	}
	return out
}

func TestParseMarkerTitle(t *testing.T) {
	cases := []struct{ title, want string }{
		{`Marker 26 - [D:\Markers\City\City-New-Lice-38.mrk]`, `D:\Markers\City\City-New-Lice-38.mrk`},
		{`Optitex Marker - \\server\markers\City-New-Hastar-40.MRK *`, `\\server\markers\City-New-Hastar-40.MRK`},
		{`City-New-Lice-40.mrk - Marker`, `City-New-Lice-40.mrk`},
		{`City-New-Lice-40 - Optitex Marker 26`, `City-New-Lice-40`},
	}
	for _, c := range cases {
		got := hintTexts(parseMarkerTitle(c.title))
		if len(got) == 0 || got[0] != c.want {
			t.Errorf("%q: got %q, want first %q", c.title, got, c.want)
		}
	}
	// a full path gives its name too (the drive letter may differ on this PC)
	got := hintTexts(parseMarkerTitle(`Marker - [D:\M\A-1.mrk]`))
	if strings.Join(got, "|") != `D:\M\A-1.mrk|A-1.mrk|Marker` {
		t.Errorf("got %q", got)
	}
}

func TestFindMarkerOpenInMarker(t *testing.T) {
	root := t.TempDir()
	gbr := write(t, filepath.Join(root, "cut", "export.GBR"), gbrOf(pcsA...))
	mrk := write(t, filepath.Join(root, "srv", "City", "City-New-Lice-38.MRK"), mrkOf("", pcsA...))
	write(t, filepath.Join(root, "srv", "City", "City-New-Lice-40.MRK"), mrkOf("", pcsB...))
	cfg := defaultConfig()
	cfg.MarkerDirs = []string{filepath.Join(root, "srv")}
	a := testApp(t, cfg)
	titles := []string{`Marker 26 - [X:\other pc\City-New-Lice-38.mrk]`}
	readMarkerTitles = func() []string { return titles }
	defer func() { readMarkerTitles = markerWindowTitles }()
	m := a.FindMarker(gbr, "export.GBR", gbrOf(pcsA...))
	if m.MRK != mrk || !strings.HasPrefix(m.How, "отворена в Marker") {
		t.Fatalf("got %+v", m)
	}
	// Marker now shows another marker whose pieces do not fit: not taken from the title
	titles = []string{`Marker 26 - [City-New-Lice-40.mrk]`}
	a2 := testApp(t, cfg)
	if m := a2.FindMarker(gbr, "export.GBR", gbrOf(pcsA...)); m.MRK != mrk || strings.HasPrefix(m.How, "отворена") {
		t.Fatalf("got %+v", m)
	}
}
