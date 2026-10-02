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
	"fmt"
	"io/fs"
	"math"
	"os"
	"path/filepath"
	"sort"
	"strconv"
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

// markerIndex is the list of .MRK/.PDS files in the searched folders. A server folder
// can hold tens of thousands of files and walking it over the network takes from
// seconds to minutes, so it is never walked while a GBR waits: the list is built in
// the background (at start, when the folders change and every rescanEvery), and new
// or changed markers are added at once from the folder watcher.
type markerIndex struct {
	mu        sync.Mutex
	key       string // roots + exclusions the list was built for
	roots     []string
	exclude   []string
	files     []markerFile // replaced, never changed in place (callers keep the slice)
	built     time.Time    // end of the last complete walk
	scanning  bool
	scanStart time.Time
	walked    int // entries walked so far by the running walk
	added     map[string]markerFile
	took      time.Duration
	truncated bool
	gen       int // a walk started for older settings is dropped
	onScanned func()
	sync      bool // tests: walk at once instead of in the background

	boxes     map[string]cachedBoxes // piece boxes of markers already read
	cachePath string
	dirty     bool
	saved     time.Time
}

const (
	rescanEvery     = 30 * time.Minute
	indexMaxEntries = 5000000 // safety stop for a whole network drive
	contentMaxFiles = 400     // markers compared by content per GBR
)

func indexKey(roots, exclude []string) string {
	return strings.ToLower(strings.Join(roots, "|") + "#" + strings.Join(exclude, "|"))
}

// configure sets the folders; a change starts a new walk.
func (ix *markerIndex) configure(roots, exclude []string) {
	key := indexKey(roots, exclude)
	ix.mu.Lock()
	if ix.key == key && (ix.scanning || !ix.built.IsZero()) {
		ix.mu.Unlock()
		return
	}
	if ix.key != key {
		ix.files, ix.built = nil, time.Time{}
	}
	ix.key, ix.roots, ix.exclude = key, roots, exclude
	ix.mu.Unlock()
	ix.rescan()
}

// rescan walks the folders again (in the background).
func (ix *markerIndex) rescan() {
	ix.mu.Lock()
	if ix.scanning || ix.key == "" {
		ix.mu.Unlock()
		return
	}
	ix.gen++
	gen, roots, exclude := ix.gen, ix.roots, ix.exclude
	ix.scanning, ix.scanStart, ix.walked, ix.added = true, time.Now(), 0, map[string]markerFile{}
	sync := ix.sync
	ix.mu.Unlock()
	if sync {
		ix.walk(gen, roots, exclude)
	} else {
		go ix.walk(gen, roots, exclude)
	}
}

func (ix *markerIndex) walk(gen int, roots, exclude []string) {
	var files []markerFile
	seen := map[string]bool{}
	entries, truncated := 0, false
	for _, r := range roots {
		_ = filepath.WalkDir(r, func(p string, d fs.DirEntry, err error) error {
			if err != nil {
				if d != nil && d.IsDir() {
					return fs.SkipDir
				}
				return nil
			}
			entries++
			if entries%1000 == 0 {
				ix.mu.Lock()
				ix.walked = entries
				stale := ix.gen != gen
				ix.mu.Unlock()
				if stale {
					return fs.SkipAll
				}
			}
			if entries > indexMaxEntries {
				truncated = true
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
	if ix.gen != gen { // the settings changed meanwhile
		ix.mu.Unlock()
		return
	}
	for lp, f := range ix.added { // markers that appeared during the walk
		if !seen[lp] {
			files = append(files, f)
		}
	}
	ix.files, ix.built, ix.scanning, ix.walked, ix.added = files, time.Now(), false, entries, nil
	ix.took, ix.truncated = time.Since(ix.scanStart), truncated
	done := ix.onScanned
	ix.mu.Unlock()
	if done != nil {
		done()
	}
}

// upsert adds or updates one file reported by the folder watcher.
func (ix *markerIndex) upsert(p string) {
	ext := strings.ToLower(filepath.Ext(p))
	if ext != ".mrk" && ext != ".pds" {
		return
	}
	st, err := os.Stat(p)
	if err != nil || st.IsDir() {
		return
	}
	f := markerFile{path: p, key: baseKey(p), ext: ext, mod: st.ModTime()}
	lp := strings.ToLower(p)
	ix.mu.Lock()
	defer ix.mu.Unlock()
	if excluded(p, ix.exclude) {
		return
	}
	inside := false
	for _, r := range ix.roots {
		rr := strings.ToLower(filepath.Clean(r))
		if strings.HasPrefix(lp, rr+string(filepath.Separator)) || strings.HasPrefix(lp, rr) && strings.HasSuffix(rr, string(filepath.Separator)) {
			inside = true
			break
		}
	}
	if !inside {
		return
	}
	if ix.added != nil {
		ix.added[lp] = f
	}
	files := make([]markerFile, 0, len(ix.files)+1)
	for _, g := range ix.files {
		if strings.ToLower(g.path) != lp {
			files = append(files, g)
		}
	}
	ix.files = append(files, f)
}

// list returns the files known now. Before the first walk has finished it is empty
// (or partial): the GBR then waits and is checked again when the walk is done.
func (ix *markerIndex) list(roots, exclude []string) []markerFile {
	ix.configure(roots, exclude)
	ix.mu.Lock()
	defer ix.mu.Unlock()
	return ix.files
}

// complete: the first walk of the current folders has finished.
func (ix *markerIndex) complete() bool {
	ix.mu.Lock()
	defer ix.mu.Unlock()
	return !ix.built.IsZero()
}

// tick runs from the pump: periodic walk and saving the box cache.
func (ix *markerIndex) tick() {
	ix.mu.Lock()
	due := ix.key != "" && !ix.scanning && !ix.built.IsZero() && time.Since(ix.built) > rescanEvery
	save := ix.dirty && time.Since(ix.saved) > 10*time.Second
	ix.mu.Unlock()
	if due {
		ix.rescan()
	}
	if save {
		ix.saveBoxes()
	}
}

type IndexStatus struct {
	Roots     []string `json:"roots"`
	MRK       int      `json:"mrk"`
	PDS       int      `json:"pds"`
	Scanning  bool     `json:"scanning"`
	Walked    int      `json:"walked"`
	TookSec   float64  `json:"tookSec"`
	Built     string   `json:"built"`
	Truncated bool     `json:"truncated"`
}

func (ix *markerIndex) status() IndexStatus {
	ix.mu.Lock()
	defer ix.mu.Unlock()
	s := IndexStatus{Roots: ix.roots, Scanning: ix.scanning, Walked: ix.walked, TookSec: math.Round(ix.took.Seconds()*10) / 10, Truncated: ix.truncated}
	if !ix.built.IsZero() {
		s.Built = ix.built.Format("15:04:05")
	}
	for _, f := range ix.files {
		if f.ext == ".mrk" {
			s.MRK++
		} else {
			s.PDS++
		}
	}
	return s
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

// markerBoxes reads the piece boxes of a marker. They are kept (also on disk, in
// markers-cache.txt) by modification time, so each marker is read over the network
// only once.
func (ix *markerIndex) markerBoxes(f markerFile) ([]pieceBox, bool) {
	ix.mu.Lock()
	if c, ok := ix.boxes[strings.ToLower(f.path)]; ok && c.mod.Equal(f.mod) {
		ix.mu.Unlock()
		return c.boxes, true
	}
	ix.mu.Unlock()
	if !markerSettled(f.path) {
		return nil, false // Marker is still saving it: not read now
	}
	var boxes []pieceBox
	if d := loadDrawing(f.path); d != nil && d.Kind == "MRK" {
		boxes = drawingBoxes(d)
	}
	ix.mu.Lock()
	if ix.boxes == nil {
		ix.boxes = map[string]cachedBoxes{}
	}
	ix.boxes[strings.ToLower(f.path)] = cachedBoxes{f.mod, boxes}
	ix.dirty = true
	ix.mu.Unlock()
	return boxes, true
}

// Marker may save a marker several times in a row. A .MRK/.PDS is read only when it
// has not changed for markerQuiet, so GBR Fix never reads it in the middle of saving.
var (
	markerQuiet    = 10 * time.Second
	markerQuietMax = 60 * time.Second
)

// markerSettled waits (up to markerQuietMax) until p has not changed for markerQuiet.
// The file's time is used when it is clearly older; otherwise (just saved, or the
// server's clock differs) size and time are watched here.
func markerSettled(p string) bool {
	deadline := time.Now().Add(markerQuietMax)
	var lastSize int64 = -1
	var lastMod, stableSince time.Time
	for {
		st, err := os.Stat(p)
		if err != nil {
			return false
		}
		if time.Since(st.ModTime()) >= markerQuiet {
			return true
		}
		if st.Size() != lastSize || !st.ModTime().Equal(lastMod) {
			lastSize, lastMod, stableSince = st.Size(), st.ModTime(), time.Now()
		} else if time.Since(stableSince) >= markerQuiet {
			return true
		}
		if time.Now().After(deadline) {
			return false
		}
		time.Sleep(min(markerQuiet/5+time.Millisecond, 2*time.Second))
	}
}

func (ix *markerIndex) loadBoxes(path string) {
	ix.mu.Lock()
	defer ix.mu.Unlock()
	ix.cachePath = path
	ix.boxes = map[string]cachedBoxes{}
	f, err := os.Open(path)
	if err != nil {
		return
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 64*1024), 4<<20)
	for sc.Scan() {
		parts := strings.Split(sc.Text(), "\t")
		if len(parts) != 3 {
			continue
		}
		ns, err := strconv.ParseInt(parts[1], 10, 64)
		if err != nil {
			continue
		}
		var boxes []pieceBox
		nums := strings.Fields(parts[2])
		for i := 0; i+3 < len(nums); i += 4 {
			var v [4]int
			for k := range v {
				v[k], _ = strconv.Atoi(nums[i+k])
			}
			boxes = append(boxes, pieceBox{v[0], v[1], v[2], v[3]})
		}
		ix.boxes[parts[0]] = cachedBoxes{time.Unix(0, ns), boxes}
	}
}

func (ix *markerIndex) saveBoxes() {
	ix.mu.Lock()
	path := ix.cachePath
	var b strings.Builder
	for p, c := range ix.boxes {
		b.WriteString(p + "\t" + strconv.FormatInt(c.mod.UnixNano(), 10) + "\t")
		for _, x := range c.boxes {
			fmt.Fprintf(&b, "%d %d %d %d ", x.minX, x.minY, x.maxX, x.maxY)
		}
		b.WriteString("\r\n")
	}
	ix.dirty, ix.saved = false, time.Now()
	ix.mu.Unlock()
	if path != "" {
		_ = writeAtomic(path, b.String())
	}
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
		b, ok := a.mix.markerBoxes(f)
		if !ok {
			a.markerSeen(f.path) // being saved: the GBR waits and is checked again
			return false
		}
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
	// 2b. the marker open in Optitex Marker (its window title)
	if m.MRK == "" {
		a.pollMarker()
		for _, h := range a.recentHints() {
			if h.path {
				if f, ok := statFile(h.text); ok && f.ext == ".mrk" && accept(f, false) {
					m.MRK, m.How = f.path, "отворена в Marker"
					break
				}
				continue
			}
			hk := baseKey(h.text)
			var named []markerFile
			for _, f := range files {
				if f.ext == ".mrk" && f.key == hk {
					named = append(named, f)
				}
			}
			sort.SliceStable(named, func(i, j int) bool { return named[i].mod.After(named[j].mod) })
			for _, f := range named {
				if accept(f, false) {
					m.MRK, m.How = f.path, "отворена в Marker, намерена в "+filepath.Dir(f.path)
					break
				}
			}
			if m.MRK != "" {
				break
			}
		}
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
	if !markerSettled(m.MRK) { // chosen by hand or next to the GBR, and still being saved
		a.markerSeen(m.MRK)
		return MarkerMatch{}
	}
	m.PDS = a.findPattern(m.MRK, gbrPath, files, cfg)
	if m.PDS != "" && !markerSettled(m.PDS) {
		m.PDS = ""
	}
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
	a.mix.upsert(p)
	a.pmu.Lock()
	a.mrkDirty = time.Now()
	a.pmu.Unlock()
}

// retryWaiting runs from the pump: shortly after markers changed, the GBRs that wait
// for one are checked again.
func (a *App) retryWaiting() {
	a.pmu.Lock()
	if a.mrkDirty.IsZero() || time.Since(a.mrkDirty) < markerQuiet {
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
	for _, p := range waiting {
		raw, err := readShared(p)
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
