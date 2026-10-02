package main

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestMain(m *testing.M) {
	setMarkerQuiet(0) // test files are written just before they are read
	os.Exit(m.Run())
}

func TestMarkerReadOnlyWhenSettled(t *testing.T) {
	defer func(q, mx time.Duration) { setMarkerQuiet(q); markerQuietMax = mx }(markerQuiet(), markerQuietMax)
	setMarkerQuiet(400 * time.Millisecond)
	markerQuietMax = 1500 * time.Millisecond
	p := write(t, filepath.Join(t.TempDir(), "M.MRK"), "x")

	// just saved: waits until it has been quiet for markerQuiet
	t0 := time.Now()
	if !markerSettled(p) {
		t.Fatal("not settled")
	}
	if d := time.Since(t0); d < 300*time.Millisecond {
		t.Fatalf("read without waiting (%v)", d)
	}

	// Marker keeps saving: not read at all
	stop := make(chan bool)
	go func() {
		for i := 0; ; i++ {
			select {
			case <-stop:
				return
			case <-time.After(100 * time.Millisecond):
				_ = os.WriteFile(p, []byte(time.Now().String()), 0644)
			}
		}
	}()
	time.Sleep(250 * time.Millisecond) // saving has started
	if markerSettled(p) {
		t.Fatal("read while being saved")
	}
	close(stop)

	// an old file is read at once
	old := time.Now().Add(-time.Hour)
	_ = os.Chtimes(p, old, old)
	t0 = time.Now()
	if !markerSettled(p) || time.Since(t0) > 100*time.Millisecond {
		t.Fatal("old file should be read at once")
	}
}

// A marker that is still being saved is not used; the GBR waits for it.
func TestMarkerBeingSavedIsNotRead(t *testing.T) {
	defer func(q, mx time.Duration) { setMarkerQuiet(q); markerQuietMax = mx }(markerQuiet(), markerQuietMax)
	root := t.TempDir()
	gbr := write(t, filepath.Join(root, "cut", "M1.GBR"), gbrOf(pcsA...))
	write(t, filepath.Join(root, "markers", "M1.MRK"), mrkOf("", pcsA...))
	cfg := defaultConfig()
	cfg.MarkerDirs = []string{filepath.Join(root, "markers")}
	a := testApp(t, cfg)
	setMarkerQuiet(300 * time.Millisecond)
	markerQuietMax = 300 * time.Millisecond
	stop := make(chan bool)
	go func() { // Marker keeps saving it
		for {
			select {
			case <-stop:
				return
			case <-time.After(80 * time.Millisecond):
				_ = os.WriteFile(filepath.Join(root, "markers", "M1.MRK"), []byte(mrkOf("", pcsA...)), 0644)
			}
		}
	}()
	time.Sleep(150 * time.Millisecond)
	m := a.FindMarker(gbr, "M1.GBR", gbrOf(pcsA...))
	close(stop)
	if m.MRK != "" {
		t.Fatalf("read a marker that is being saved: %+v", m)
	}
	if a.mrkDirty.IsZero() {
		t.Fatal("no new check scheduled")
	}
	setMarkerQuiet(0)
	if m := a.FindMarker(gbr, "M1.GBR", gbrOf(pcsA...)); m.MRK == "" {
		t.Fatal("not found once saved")
	}
}
