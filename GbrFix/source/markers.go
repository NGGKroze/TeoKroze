package main

// Finding the marker (.MRK) and the pattern (.PDS) of a GBR. Marker usually saves them
// in a different folder than the cut file, so they are looked up in this order:
//   1. the .MRK the user chose for this GBR in the window (remembered)
//   2. NAME.MRK next to the GBR or in its parent folder
//   3. NAME.MRK in the marker folders (Settings) and in the watched folders
//   4. any .MRK in those folders whose drawing has the pieces at the same places as
//      the GBR (the cut file may have been renamed)
// A marker with the same name is only taken when its pieces match the GBR, so an old
// marker that happens to share the name is not used.

import (
	"bufio"
	"io/fs"
	"math"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

type MarkerMatch struct {
	MRK string // path of the marker, "" = not found
	PDS string // path of the pattern, "" = not found
	How string // how the marker was found (shown to the user)
}

// pieceBox is a piece outline's bounding box in 0.1 mm.
type pieceBox struct{ minX, minY, maxX, maxY int }

func (b pieceBox) w() int { return b.maxX - b.minX }
func (b pieceBox) h() int { return b.maxY - b.minY }

func drawingBoxes(d *svgDrawing) []pieceBox {
	var out []pieceBox
	for _, p := range d.Pieces {
		if len(p.Poly) == 0 {
			continue
		}
		b := pieceBox{1 << 30, 1 << 30, -(1 << 30), -(1 << 30)}
		for _, q := range p.Poly {
			b.minX, b.minY = min(b.minX, q[0]), min(b.minY, q[1])
			b.maxX, b.maxY = max(b.maxX, q[0]), max(b.maxY, q[1])
		}
		out = append(out, b)
	}
	return out
}

func gbrBoxes(raw string) []pieceBox {
	var out []pieceBox
	for _, p := range gbrPieces(raw) {
		if p.box.maxX >= p.box.minX {
			out = append(out, p.box)
		}
	}
	return out
}

const boxTol = 20 // 2 mm

// matchScore: share of pieces that have a partner in the other file.
// pos = same place on the marker; size = same size anywhere (rotated too).
func matchScore(g, m []pieceBox) (pos, size float64) {
	if len(g) == 0 || len(m) == 0 {
		return 0, 0
	}
	near := func(a, b int) bool { return a-b <= boxTol && b-a <= boxTol }
	count := func(same func(a, b pieceBox) bool) float64 {
		used := make([]bool, len(m))
		n := 0
		for _, a := range g {
			for j, b := range m {
				if !used[j] && same(a, b) {
					used[j] = true
					n++
					break
				}
			}
		}
		return float64(n) / float64(max(len(g), len(m)))
	}
	pos = count(func(a, b pieceBox) bool {
		return near(a.minX, b.minX) && near(a.minY, b.minY) && near(a.maxX, b.maxX) && near(a.maxY, b.maxY)
	})
	size = count(func(a, b pieceBox) bool {
		return (near(a.w(), b.w()) && near(a.h(), b.h())) || (near(a.w(), b.h()) && near(a.h(), b.w()))
	})
	return pos, size
}

// ---------------- index of the .MRK / .PDS files in the search folders ----------------

type markerFile struct {
	path string
	key  string // lower-case name without extension
	ext  string // ".mrk" or ".pds"
	mod  time.Time
}

type cachedBoxes struct {
	mod   time.Time
	boxes []pieceBox
}

type markerIndex struct {
	mu      sync.Mutex
	key     string
	built   time.Time
	files   []markerFile
	boxes   map[string]cachedBoxes
	exclude []string
}

const (
	indexTTL        = 2 * time.Minute
	indexMaxEntries = 300000 // stop walking huge trees (a whole network drive)
	contentMaxFiles = 400    // markers compared by content per GBR
)

func (ix *markerIndex) invalidate() {
	ix.mu.Lock()
	ix.built = time.Time{}
	ix.mu.Unlock()
}

// list returns the marker/pattern files under roots (cached for a short while).
func (ix *markerIndex) list(roots, exclude []string) []markerFile {
	key := strings.ToLower(strings.Join(roots, "|") + "#" + strings.Join(exclude, "|"))
	ix.mu.Lock()
	if ix.key == key && time.Since(ix.built) < indexTTL {
		f := ix.files
		ix.mu.Unlock()
		return f
	}
	ix.mu.Unlock()
	var files []markerFile
	seen := map[string]bool{}
	entries := 0
	for _, r := range roots {
		_ = filepath.WalkDir(r, func(p string, d fs.DirEntry, err error) error {
			if err != nil {
				if d != nil && d.IsDir() {
					return fs.SkipDir
				}
				return nil
			}
			entries++
			if entries > indexMaxEntries {
				return fs.SkipAll
			}
			if excluded(p, exclude) {
				if d.IsDir() {
					return fs.SkipDir
				}
				return nil
			}
			if d.IsDir() {
				return nil
			}
			ext := strings.ToLower(filepath.Ext(p))
			if ext != ".mrk" && ext != ".pds" {
				return nil
			}
			lp := strings.ToLower(p)
			if seen[lp] {
				return nil
			}
			seen[lp] = true
			info, err := d.Info()
			if err != nil {
				return nil
			}
			files = append(files, markerFile{path: p, key: baseKey(p), ext: ext, mod: info.ModTime()})
			return nil
		})
	}
	ix.mu.Lock()
	ix.key, ix.built, ix.files = key, time.Now(), files
	ix.mu.Unlock()
	return files
}

func excluded(p string, exclude []string) bool {
	lp := strings.ToLower(p)
	for _, e := range exclude {
		if e != "" && strings.Contains(lp, strings.ToLower(e)) {
			return true
		}
	}
	return false
}

// markerBoxes reads the piece boxes of a marker (cached by modification time).
func (ix *markerIndex) markerBoxes(f markerFile) []pieceBox {
	ix.mu.Lock()
	if c, ok := ix.boxes[f.path]; ok && c.mod.Equal(f.mod) {
		ix.mu.Unlock()
		return c.boxes
	}
	ix.mu.Unlock()
	var boxes []pieceBox
	if d := loadDrawing(f.path); d != nil && d.Kind == "MRK" {
		boxes = drawingBoxes(d)
	}
	ix.mu.Lock()
	if ix.boxes == nil {
		ix.boxes = map[string]cachedBoxes{}
	}
	ix.boxes[f.path] = cachedBoxes{f.mod, boxes}
	ix.mu.Unlock()
	return boxes
}

// ---------------- the search ----------------

// searchRoots: the marker folders and the watched folders (not whole drives: walking
// C:\ for every file would be too slow; a drive can still be added as a marker folder).
func searchRoots(c Config) []string {
	var out []string
	seen := map[string]bool{}
	add := func(p string, allowDrive bool) {
		p = strings.TrimSpace(p)
		if p == "" {
			return
		}
		clean := filepath.Clean(p)
		if !allowDrive && (filepath.Dir(clean) == clean) {
			return
		}
		k := strings.ToLower(clean)
		if !seen[k] {
			seen[k] = true
			out = append(out, p)
		}
	}
	for _, p := range c.MarkerDirs {
		add(p, true)
	}
	for _, p := range c.Watch {
		add(p, false)
	}
	return out
}

func closeInTime(ref time.Time) func(a, b markerFile) bool {
	return func(a, b markerFile) bool {
		if ref.IsZero() {
			return a.mod.After(b.mod)
		}
		return math.Abs(float64(a.mod.Sub(ref))) < math.Abs(float64(b.mod.Sub(ref)))
	}
}

// FindMarker looks for the .MRK (and .PDS) of a GBR. gbrPath may be "" (a file dropped
// into the window): then only name and content are used.
func (a *App) FindMarker(gbrPath, name, gbrContent string) MarkerMatch {
	cfg := a.conf()
	var m MarkerMatch
	key := baseKey(name)
	g := gbrBoxes(gbrContent)
	var ref time.Time
	if gbrPath != "" {
		if st, err := os.Stat(gbrPath); err == nil {
			ref = st.ModTime()
		}
	}
	accept := func(f markerFile, strict bool) bool {
		b := a.mix.markerBoxes(f)
		if b == nil {
			return !strict // no drawing to compare: a marker with the right name is still taken
		}
		pos, size := matchScore(g, b)
		if strict {
			return pos >= 0.9 && len(g) >= 2
		}
		return pos >= 0.9 || size >= 0.9
	}
	statFile := func(p string) (markerFile, bool) {
		st, err := os.Stat(p)
		if err != nil || st.IsDir() {
			return markerFile{}, false
		}
		return markerFile{path: p, key: baseKey(p), ext: strings.ToLower(filepath.Ext(p)), mod: st.ModTime()}, true
	}
	// 1. chosen by the user
	if gbrPath != "" {
		if p := a.pairedMarker(gbrPath); p != "" {
			if _, ok := statFile(p); ok {
				m.MRK, m.How = p, "избрана ръчно"
			}
		}
	}
	// 2. same name next to the GBR or one folder up
	if m.MRK == "" && gbrPath != "" {
		dir := filepath.Dir(gbrPath)
		for i, d := range []string{dir, filepath.Dir(dir)} {
			if i == 1 && d == dir {
				break
			}
			if p := findSibling(filepath.Join(d, filepath.Base(gbrPath)), ".mrk"); p != "" {
				if f, ok := statFile(p); ok && (i == 0 || accept(f, false)) {
					m.MRK, m.How = p, "до GBR файла"
					if i == 1 {
						m.How = "в горната папка"
					}
					break
				}
			}
		}
	}
	var files []markerFile
	if m.MRK == "" {
		files = a.mix.list(searchRoots(cfg), cfg.Exclude)
	}
	// 3. same name in the search folders – newest/closest in time first
	if m.MRK == "" && key != "" {
		var named []markerFile
		for _, f := range files {
			if f.ext == ".mrk" && f.key == key {
				named = append(named, f)
			}
		}
		sort.SliceStable(named, func(i, j int) bool { return closeInTime(ref)(named[i], named[j]) })
		for _, f := range named {
			if accept(f, false) {
				m.MRK, m.How = f.path, "по име в "+filepath.Dir(f.path)
				break
			}
		}
	}
	// 4. by content: the pieces lie at the same places
	if m.MRK == "" && len(g) >= 2 {
		var mrks []markerFile
		for _, f := range files {
			if f.ext == ".mrk" {
				mrks = append(mrks, f)
			}
		}
		sort.SliceStable(mrks, func(i, j int) bool { return closeInTime(ref)(mrks[i], mrks[j]) })
		if len(mrks) > contentMaxFiles {
			mrks = mrks[:contentMaxFiles]
		}
		for _, f := range mrks {
			if accept(f, true) {
				m.MRK, m.How = f.path, "по съдържание (детайлите съвпадат) в "+filepath.Dir(f.path)
				break
			}
		}
	}
	if m.MRK == "" {
		// no marker: a pattern next to the GBR can still give the expected notch count
		if gbrPath != "" {
			m.PDS = findSibling(gbrPath, ".pds")
		}
		return m
	}
	m.PDS = a.findPattern(m.MRK, gbrPath, files, cfg)
	return m
}

// findPattern: the PDS the marker was made from. The marker stores its full path, but
// that path is often on another computer or drive letter, so the file name is also
// looked up next to the marker, next to the GBR and in the search folders.
func (a *App) findPattern(mrk, gbrPath string, files []markerFile, cfg Config) string {
	if gbrPath != "" {
		if p := findSibling(gbrPath, ".pds"); p != "" {
			return p
		}
	}
	x := readXMLHead(mrk)
	fm := reStyleFn.FindStringSubmatch(x)
	if fm == nil {
		return findSibling(mrk, ".pds")
	}
	orig := strings.TrimSpace(fm[1])
	if st, err := os.Stat(orig); err == nil && !st.IsDir() {
		return orig
	}
	base := filepath.Base(strings.ReplaceAll(orig, `\`, string(filepath.Separator)))
	if base == "" || base == "." {
		return ""
	}
	if p := findSibling(filepath.Join(filepath.Dir(mrk), base), filepath.Ext(base)); p != "" {
		return p
	}
	if files == nil {
		files = a.mix.list(searchRoots(cfg), cfg.Exclude)
	}
	key := baseKey(base)
	var best *markerFile
	for i, f := range files {
		if f.ext == ".pds" && f.key == key && (best == nil || f.mod.After(best.mod)) {
			best = &files[i]
		}
	}
	if best != nil {
		return best.path
	}
	return ""
}

// ---------------- markers chosen by the user ----------------

func (a *App) pairsFile() string { return filepath.Join(a.dir, "markers.txt") }

func (a *App) loadPairs() {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.pairs = map[string]string{}
	f, err := os.Open(a.pairsFile())
	if err != nil {
		return
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		if g, m, ok := strings.Cut(sc.Text(), "\t"); ok && g != "" && m != "" {
			a.pairs[strings.ToLower(g)] = m
		}
	}
}

func (a *App) pairedMarker(gbr string) string {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.pairs[strings.ToLower(gbr)]
}

func (a *App) setPair(gbr, mrk string) error {
	a.mu.Lock()
	if a.pairs == nil {
		a.pairs = map[string]string{}
	}
	a.pairs[strings.ToLower(gbr)] = mrk
	var b strings.Builder
	keys := make([]string, 0, len(a.pairs))
	for k := range a.pairs {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	if len(keys) > 2000 { // keep the file small
		keys = keys[len(keys)-2000:]
	}
	for _, k := range keys {
		b.WriteString(k + "\t" + a.pairs[k] + "\r\n")
	}
	a.mu.Unlock()
	return os.WriteFile(a.pairsFile(), []byte(b.String()), 0644)
}

// ---------------- GBRs waiting for their marker ----------------

// Marker often writes the GBR before the marker is saved. A GBR processed without a
// marker waits (up to waitMarkerMax); when a .MRK appears in the searched folders it
// is processed again.
const waitMarkerMax = 24 * time.Hour

func (a *App) waitForMarker(gbr string) {
	a.pmu.Lock()
	a.waitMrk[gbr] = time.Now()
	a.pmu.Unlock()
}

func (a *App) markerSeen(p string) {
	if ext := strings.ToLower(filepath.Ext(p)); ext != ".mrk" && ext != ".pds" {
		return
	}
	a.pmu.Lock()
	a.mrkDirty = time.Now()
	a.pmu.Unlock()
}

// retryWaiting runs from the pump: shortly after markers changed, the GBRs that wait
// for one are checked again.
func (a *App) retryWaiting() {
	a.pmu.Lock()
	if a.mrkDirty.IsZero() || time.Since(a.mrkDirty) < 3*time.Second {
		a.pmu.Unlock()
		return
	}
	a.mrkDirty = time.Time{}
	var waiting []string
	for p, t := range a.waitMrk {
		if time.Since(t) > waitMarkerMax {
			delete(a.waitMrk, p)
			continue
		}
		waiting = append(waiting, p)
	}
	a.pmu.Unlock()
	if len(waiting) == 0 {
		return
	}
	a.mix.invalidate()
	for _, p := range waiting {
		raw, err := os.ReadFile(p)
		if err != nil {
			a.pmu.Lock()
			delete(a.waitMrk, p)
			a.pmu.Unlock()
			continue
		}
		if m := a.FindMarker(p, filepath.Base(p), string(raw)); m.MRK != "" {
			a.logEvent(Event{Time: now(), Src: p, Status: "info", Msg: "Намерена е маркировката " + filepath.Base(m.MRK) + " (" + m.How + ") – файлът се обработва отново."})
			a.reprocess(p)
		}
	}
}

// reprocess handles a GBR again even if it has not changed.
func (a *App) reprocess(p string) {
	a.pmu.Lock()
	delete(a.waitMrk, p)
	delete(a.done, p)
	a.pmu.Unlock()
	a.process(p, 0)
}
