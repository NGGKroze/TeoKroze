package main

import (
	"bufio"
	"embed"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

const appVersion = "2.6"

const restoredTag = "_restored"

const (
	defaultMarkerQuiet = 3   // s
	maxMarkerQuiet     = 120 // s
)

//go:embed web/index.html
var webFS embed.FS

//go:embed assets/*.png
var assetFS embed.FS

// ---------------- config ----------------

type Config struct {
	Suffix         string   `json:"suffix"`
	OutMode        string   `json:"outMode"`    // "suffix": NAME_fixed.GBR next to the file; "folder": FOLDER\FOLDER_fixed\NAME.GBR
	Watch          []string `json:"watch"`      // folders/drives watched with all subfolders
	MarkerDirs     []string `json:"markerDirs"` // where the .MRK/.PDS files are saved (searched with all subfolders)
	Exclude        []string `json:"exclude"`
	NearDupTol     int      `json:"neardup"`
	RecoverBrokenI bool     `json:"recoverBrokenI"`
	ShapeV         bool     `json:"shapeV"`
	ShapeBox       bool     `json:"shapeBox"`
	ShapeU         bool     `json:"shapeU"`
	CloseBrokenU   bool     `json:"closeBrokenU"`
	CheckMissing   bool     `json:"checkMissing"`
	RestoreMode    string   `json:"restoreMode"` // off | same | separate
	SegmentTol     float64  `json:"segmentTol"`
	Notify         bool     `json:"notify"`
	Port           int      `json:"port"`
	ReportNextTo   bool     `json:"reportNextTo"`
	MarkerQuiet    int      `json:"markerQuiet"` // seconds a .MRK/.PDS must be unchanged before it is read
	path           string
}

func defaultConfig() Config {
	return Config{
		Suffix:     "_fixed",
		OutMode:    "suffix",
		Watch:      nil, // the user chooses the folder(s)
		Exclude:    []string{`\Windows\`, `\$Recycle.Bin\`, `\System Volume Information\`, `\AppData\Local\Temp\`, `\AppData\Local\Microsoft\`, `\GbrFix\`},
		NearDupTol: 3, SegmentTol: 400, MarkerQuiet: defaultMarkerQuiet, Notify: true, Port: 8765, CloseBrokenU: true, CheckMissing: true, RestoreMode: "separate",
	}
}

func splitList(v string) []string {
	var out []string
	for _, e := range strings.Split(v, ";") {
		if e = strings.TrimSpace(e); e != "" {
			out = append(out, e)
		}
	}
	return out
}

func b01(b bool) string {
	if b {
		return "1"
	}
	return "0"
}

func (c Config) save() error {
	ini := "; GBR Fix – настройки (могат да се променят и от прозореца на програмата -> Настройки)\n" +
		"; Наставка към името на коригирания файл: ИМЕ" + c.Suffix + ".GBR\n" +
		"suffix=" + c.Suffix + "\n" +
		"; Къде да се записва: suffix = ИМЕ" + c.Suffix + ".GBR до оригинала; folder = в подпапка ПАПКА" + c.Suffix + " с оригиналните имена\n" +
		"out_mode=" + c.OutMode + "\n" +
		"; Папки/дискове за автоматично конвертиране (с всички подпапки), разделени с ;\n" +
		"watch=" + strings.Join(c.Watch, ";") + "\n" +
		"; Папки, в които Marker записва .MRK и .PDS файловете (търсят се с всички подпапки), разделени с ;\n" +
		";   търсят се и в следените папки, до GBR файла и в горната му папка\n" +
		"marker_dirs=" + strings.Join(c.MarkerDirs, ";") + "\n" +
		"; Пътища, съдържащи тези части, се пропускат (разделени с ;)\n" +
		"exclude=" + strings.Join(c.Exclude, ";") + "\n" +
		"; Премахване на почти еднакви нотчове (разлика до N единици = N*0.1 мм). 0 = изключено\n" +
		"neardup=" + strconv.Itoa(c.NearDupTol) + "\n" +
		"; Възстановяване на I-нотчове, повредени от стари конвертори (само за стари файлове!) 0/1\n" +
		"recover_broken_i=" + b01(c.RecoverBrokenI) + "\n" +
		"; T нотчовете винаги стават I с M19. Другите форми по избор (0 = остават форма, 1 = I с M19):\n" +
		"shape_v_to_i=" + b01(c.ShapeV) + "\n" +
		"shape_box_to_i=" + b01(c.ShapeBox) + "\n" +
		"shape_u_to_i=" + b01(c.ShapeU) + "\n" +
		"; Довършване на U нотча на 26.1, който не се връща до ръба (отрязва ивица) 0/1\n" +
		"close_broken_u=" + b01(c.CloseBrokenU) + "\n" +
		"; Проверка за липсващи нотчове спрямо .MRK/.PDS на маркировката 0/1\n" +
		"check_missing=" + b01(c.CheckMissing) + "\n" +
		"; Липсващи в GBR нотчове (взимат се от .MRK файла на маркировката, като I-нотч с M19):\n" +
		";   off = не се добавят; same = добавят се в коригирания файл;\n" +
		";   separate = коригираният файл остава без тях + втори файл ..._restored с добавените\n" +
		"restore_mode=" + c.RestoreMode + "\n" +
		"; Толеранс (квадрат на разстоянието) за вмъкване на нотч в сегмент от контура\n" +
		"segment_tol=" + strconv.FormatFloat(c.SegmentTol, 'f', -1, 64) + "\n" +
		"; Известие в ъгъла на екрана при конвертиране 0/1\n" +
		"notify=" + b01(c.Notify) + "\n" +
		"; Порт на локалния прозорец (http://127.0.0.1:ПОРТ) – изисква рестарт\n" +
		"port=" + strconv.Itoa(c.Port) + "\n" +
		"; Записвай и отчет .txt до коригирания файл 0/1\n" +
		"report_next_to_file=" + b01(c.ReportNextTo) + "\n" +
		"; Секунди, през които .MRK/.PDS трябва да е без промяна, преди да се прочете (Marker да е завършил записа)\n" +
		"marker_quiet=" + strconv.Itoa(c.MarkerQuiet) + "\n" +
		"cfgver=2\n"
	return os.WriteFile(c.path, []byte(strings.ReplaceAll(ini, "\n", "\r\n")), 0644)
}

func loadConfig(dir string) Config {
	c := defaultConfig()
	c.path = filepath.Join(dir, "gbrfix.ini")
	f, err := os.Open(c.path)
	if err != nil {
		_ = c.save()
		return c
	}
	hasWatch := false
	cfgver := 0
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		l := strings.TrimSpace(sc.Text())
		if l == "" || l[0] == ';' || l[0] == '#' {
			continue
		}
		k, v, ok := strings.Cut(l, "=")
		if !ok {
			continue
		}
		k, v = strings.ToLower(strings.TrimSpace(k)), strings.TrimSpace(v)
		switch k {
		case "suffix":
			if v != "" {
				c.Suffix = v
			}
		case "out_mode":
			if v == "folder" || v == "suffix" {
				c.OutMode = v
			}
		case "cfgver":
			cfgver, _ = strconv.Atoi(v)
		case "watch":
			hasWatch = true
			c.Watch = splitList(v)
		case "marker_dirs":
			c.MarkerDirs = splitList(v)
		case "exclude":
			c.Exclude = splitList(v)
		case "neardup":
			c.NearDupTol, _ = strconv.Atoi(v)
		case "shape_v_to_i":
			c.ShapeV = v == "1"
		case "shape_box_to_i":
			c.ShapeBox = v == "1"
		case "shape_u_to_i":
			c.ShapeU = v == "1"
		case "close_broken_u":
			c.CloseBrokenU = v != "0"
		case "restore_missing": // 1.9
			if v == "0" {
				c.RestoreMode = "off"
			}
		case "restore_mode":
			if v == "off" || v == "same" || v == "separate" {
				c.RestoreMode = v
			}
		case "check_missing":
			c.CheckMissing = v != "0"
		case "recover_broken_i":
			c.RecoverBrokenI = v == "1"
		case "segment_tol":
			if f, err := strconv.ParseFloat(v, 64); err == nil {
				c.SegmentTol = f
			}
		case "notify":
			c.Notify = v != "0"
		case "port":
			if p, err := strconv.Atoi(v); err == nil && p > 0 {
				c.Port = p
			}
		case "marker_quiet":
			if n, err := strconv.Atoi(v); err == nil && n >= 0 && n <= maxMarkerQuiet {
				c.MarkerQuiet = n
			}
		case "report_next_to_file":
			c.ReportNextTo = v == "1"
		}
	}
	f.Close()
	if cfgver < 2 {
		// older versions watched the whole C:\ by default – now the user picks the folder
		if !hasWatch || (len(c.Watch) == 1 && strings.EqualFold(strings.TrimRight(c.Watch[0], `\`), "C:")) {
			c.Watch = nil
		}
		_ = c.save()
	}
	return c
}

// normWatch cleans a list of watch folders; also returns the ones that do not exist now.
func normWatch(in []string) (out []string, missing []string) {
	seen := map[string]bool{}
	for _, p := range in {
		p = strings.TrimSpace(strings.Trim(p, `"`))
		if p == "" {
			continue
		}
		if len(p) == 2 && p[1] == ':' {
			p += `\`
		}
		warn := ""
		if st, err := os.Stat(p); err != nil || !st.IsDir() {
			warn = p
		}
		k := strings.ToLower(filepath.Clean(p))
		if seen[k] {
			continue
		}
		seen[k] = true
		out = append(out, p)
		if warn != "" {
			missing = append(missing, warn)
		}
	}
	return out, missing
}

func (c Config) options() Options {
	return Options{RemoveDuplicates: true, NearDupTol: c.NearDupTol, RecoverBrokenI: c.RecoverBrokenI, SegmentTol: c.SegmentTol,
		Shapes: ShapeSel{V: c.ShapeV, Box: c.ShapeBox, U: c.ShapeU, CloseBrokenU: c.CloseBrokenU}}
}

// ---------------- events ----------------

type Event struct {
	Time          string `json:"time"`
	Src           string `json:"src"`
	Out           string `json:"out"`
	Out2          string `json:"out2"`   // second file with the restored notches
	Status        string `json:"status"` // ok, warn, error, info
	Msg           string `json:"msg"`
	Notches       int    `json:"notches"`
	Embedded      int    `json:"embedded"`
	Dups          int    `json:"dups"`
	Unmapped      int    `json:"unmapped"`
	PhantomBefore int    `json:"phantomBefore"`
	PhantomAfter  int    `json:"phantomAfter"`
	Report        string `json:"report"`
	Marker        string `json:"marker"`       // .MRK used for the notch check, and how it was found
	NoMarker      bool   `json:"noMarker"`     // no .MRK was found: the user can choose one
	RestoredFrom  string `json:"restoredFrom"` // .MRK the missing notches were taken from
	RestoredN     int    `json:"restoredN"`
}

type App struct {
	cfg     Config
	dir     string
	mu      sync.Mutex
	events  []Event
	watched []string
	logf    *os.File

	wmu       sync.Mutex
	stopWatch func()

	mix          markerIndex
	hmu          sync.Mutex
	hints        []markerHint // markers seen open in Optitex Marker
	markerTitles []string
	pairs        map[string]string // GBR path (lower case) -> .MRK chosen by the user

	mrks     map[string]*svgDrawing
	notes    *notifier
	paused   bool
	viewReq  string
	lastNote Note
	baseURL  string

	pmu      sync.Mutex
	pending  map[string]time.Time
	done     map[string]string    // path -> size|mtime already handled
	waitMrk  map[string]time.Time // GBRs processed without a marker
	mrkDirty time.Time            // a .MRK/.PDS changed in a searched folder
}

func (a *App) logEvent(e Event) {
	a.mu.Lock()
	a.events = append([]Event{e}, a.events...)
	if len(a.events) > 300 {
		a.events = a.events[:300]
	}
	a.mu.Unlock()
	log.Printf("[%s] %s -> %s %s", e.Status, e.Src, e.Out, e.Msg)
}

// markers opened in the window are remembered by name, so that a GBR opened with
// the same name can get its missing notches back
func baseKey(name string) string {
	b := filepath.Base(strings.ReplaceAll(name, "\\", "/"))
	return strings.ToLower(strings.TrimSuffix(b, filepath.Ext(b)))
}

func (a *App) rememberMRK(name string, d *svgDrawing) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.mrks == nil {
		a.mrks = map[string]*svgDrawing{}
	}
	a.mrks[baseKey(name)] = d
}

func (a *App) recallMRK(name string) *svgDrawing {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.mrks[baseKey(name)]
}

func (a *App) conf() Config {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.cfg
}

// applyWatch (re)starts folder watching with the current config.
func (a *App) applyWatch() {
	a.wmu.Lock()
	defer a.wmu.Unlock()
	if a.stopWatch != nil {
		a.stopWatch()
	}
	cfg := a.conf()
	roots := append([]string(nil), cfg.Watch...)
	onErr := func(msg string) { a.logEvent(Event{Time: now(), Status: "error", Msg: msg}) }
	stopGBR := startWatchers(roots, a.schedule, onErr)
	// marker folders: only to notice new markers (GBRs there are not converted unless watched too)
	var mdirs []string
	for _, d := range cfg.MarkerDirs {
		if st, err := os.Stat(d); err == nil && st.IsDir() {
			mdirs = append(mdirs, d)
		}
	}
	stopMrk := startWatchers(mdirs, a.markerSeen, func(string) {})
	a.stopWatch = func() { stopGBR(); stopMrk() }
	a.mix.configure(searchRoots(cfg), cfg.Exclude) // walks the folders in the background if they changed
	a.mu.Lock()
	a.watched = roots
	a.mu.Unlock()
}

// ---------------- file processing ----------------

var gbrExts = map[string]bool{".gbr": true}

func (a *App) candidate(p string) bool {
	ext := strings.ToLower(filepath.Ext(p))
	if !gbrExts[ext] {
		return false
	}
	sfx := strings.ToLower(a.conf().Suffix)
	base := strings.TrimSuffix(filepath.Base(p), filepath.Ext(p))
	for _, own := range []string{sfx, sfx + restoredTag} {
		if strings.HasSuffix(strings.ToLower(base), own) {
			return false // our own output (suffix mode)
		}
		if strings.HasSuffix(strings.ToLower(filepath.Base(filepath.Dir(p))), own) {
			return false // inside an output folder (folder mode)
		}
	}
	lp := strings.ToLower(p)
	for _, e := range a.conf().Exclude {
		if strings.Contains(lp, strings.ToLower(e)) {
			return false
		}
	}
	return true
}

func (a *App) isPaused() bool { a.mu.Lock(); defer a.mu.Unlock(); return a.paused }

func (a *App) setPaused(v bool) {
	a.mu.Lock()
	a.paused = v
	a.mu.Unlock()
	if v {
		a.logEvent(Event{Time: now(), Status: "info", Msg: "Автоматичното конвертиране е на ПАУЗА."})
	} else {
		a.logEvent(Event{Time: now(), Status: "info", Msg: "Автоматичното конвертиране е пуснато отново."})
	}
	trayRefresh(a)
}

// trayTip is the tooltip text of the tray icon.
func (a *App) trayTip() string {
	c := a.conf()
	t := "GBR Fix"
	if a.isPaused() {
		return t + " – ПАУЗА"
	}
	if len(c.Watch) == 0 {
		return t + " – няма избрани папки"
	}
	return t + " – следи " + strings.Join(c.Watch, ", ")
}

func (a *App) showUI(viewPath string) {
	if viewPath != "" {
		a.mu.Lock()
		a.viewReq = viewPath
		a.mu.Unlock()
	}
	showWindow(a.baseURL)
}

func (a *App) schedule(p string) {
	if ext := strings.ToLower(filepath.Ext(p)); ext == ".mrk" || ext == ".pds" {
		a.markerSeen(p)
		return
	}
	if a.isPaused() || !a.candidate(p) {
		return
	}
	a.pmu.Lock()
	a.pending[p] = time.Now()
	a.pmu.Unlock()
}

func (a *App) pump() {
	tick := 0
	for range time.Tick(500 * time.Millisecond) {
		var ready []string
		a.pmu.Lock()
		for p, t := range a.pending {
			if time.Since(t) > 2*time.Second {
				ready = append(ready, p)
				delete(a.pending, p)
			}
		}
		a.pmu.Unlock()
		for _, p := range ready {
			a.process(p, 0)
		}
		a.mix.tick()
		if tick++; tick%4 == 0 { // every 2 s
			a.pollMarker()
		}
		if !a.isPaused() {
			a.retryWaiting()
		}
	}
}

func (a *App) process(p string, attempt int) {
	st, err := os.Stat(p)
	if err != nil || st.IsDir() {
		return
	}
	if st.Size() > 64<<20 {
		return
	}
	sig := fmt.Sprintf("%d|%d", st.Size(), st.ModTime().UnixNano())
	time.Sleep(700 * time.Millisecond)
	st2, err := os.Stat(p)
	if err != nil {
		return
	}
	if fmt.Sprintf("%d|%d", st2.Size(), st2.ModTime().UnixNano()) != sig {
		a.pmu.Lock()
		a.pending[p] = time.Now()
		a.pmu.Unlock()
		return
	}
	a.pmu.Lock()
	if a.done[p] == sig {
		a.pmu.Unlock()
		return
	}
	a.pmu.Unlock()
	raw, err := readShared(p)
	if err != nil {
		if attempt < 20 {
			time.AfterFunc(3*time.Second, func() { a.process(p, attempt+1) })
		} else {
			a.logEvent(Event{Time: now(), Src: p, Status: "error", Msg: "Файлът не може да бъде прочетен: " + err.Error()})
		}
		return
	}
	a.pmu.Lock()
	a.done[p] = sig
	a.pmu.Unlock()
	a.convertFile(p, raw)
}

func now() string { return time.Now().Format("2006-01-02 15:04:05") }

func (a *App) outPath(p string) string { return a.outPathTag(p, "") }

// restoredPath is the second file that also has the notches taken from the marker.
func (a *App) restoredPath(p string) string { return a.outPathTag(p, restoredTag) }

func (a *App) outPathTag(p, tag string) string {
	c := a.conf()
	if c.OutMode == "folder" {
		dir := filepath.Dir(p)
		name := filepath.Base(dir)
		if name == "" || name == "." || name == `\` || name == "/" || strings.HasSuffix(name, ":") || strings.HasSuffix(name, `:\`) {
			name = "GBR" // file directly in a drive root
		}
		return filepath.Join(dir, name+c.Suffix+tag, filepath.Base(p))
	}
	ext := filepath.Ext(p)
	return strings.TrimSuffix(p, ext) + c.Suffix + tag + ext
}

func writeAtomic(path, content string) error {
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, []byte(content), 0644); err != nil {
		return err
	}
	if err := os.Rename(tmp, path); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	return nil
}

func (a *App) convertFile(p string, raw []byte) {
	s := string(raw)
	if !strings.Contains(s, "*N") || !strings.Contains(s, "M1") {
		return // not a cutter file
	}
	cfg := a.conf()
	r := Convert(s, cfg.options())
	var mm MarkerMatch
	if cfg.CheckMissing || cfg.RestoreMode != "off" {
		mm = a.FindMarker(p, filepath.Base(p), s)
		if mm.MRK == "" {
			a.waitForMarker(p)
		} else {
			a.pmu.Lock()
			delete(a.waitMrk, p)
			a.pmu.Unlock()
		}
	}
	plan := planOutputs(r, cfg, func() *svgDrawing {
		if mm.MRK != "" {
			return loadDrawing(mm.MRK)
		}
		return nil
	})
	if plan.rest != nil && mm.MRK != "" {
		plan.rest.SourceName = mm.MRK // full path: the user sees which file the notches came from
	}
	markerNote, noMarker := "", false
	if mm.MRK != "" {
		markerNote = "Маркировка: " + mm.MRK + " (" + mm.How + ")"
		if mm.PDS != "" {
			markerNote += " · модел: " + mm.PDS
		}
	} else if cfg.CheckMissing || cfg.RestoreMode != "off" {
		noMarker = true
	}
	noMrkHint := " .MRK на маркировката не е намерен – липсващи нотчове не са проверени (посочете го с „Посочи .MRK…“ или добавете папката с маркировките в „Настройки“)."
	if noMarker && !a.mix.complete() {
		noMrkHint = " Папките с маркировки още се обхождат – файлът ще се провери отново, щом обхождането завърши."
	}
	// what is still missing in the best file we can produce
	best := plan.main
	if plan.second != "" {
		best = plan.second
	}
	var miss, missMain *NotchCheck
	if cfg.CheckMissing {
		miss = CheckMissingNotches(mm, best)
		if plan.second != "" {
			missMain = CheckMissingNotches(mm, plan.main)
		}
	}
	missing := miss != nil && miss.Missing > 0
	if !plan.writeMain && plan.second == "" {
		switch {
		case missing:
			hint := " Включете добавянето на липсващи нотчове от „Настройки“ или експортирайте отново."
			if cfg.RestoreMode != "off" {
				hint = " Не могат да се върнат автоматично – проверете в Optitex и експортирайте отново."
			}
			a.logEvent(Event{Time: now(), Src: p, Status: "warn", Msg: "Нотчовете в файла са наред, но " + miss.Text() + hint, Report: miss.Text(), Marker: markerNote})
			a.note(p, "warn")
		case r.HeaderWarn != "":
			a.logEvent(Event{Time: now(), Src: p, Status: "warn", Msg: "Нотчовете са наред, но заглавката е повредена: " + r.HeaderWarn + ". Експортирайте файла наново от Marker.", Marker: markerNote, NoMarker: noMarker})
			a.note(p, "warn")
		default:
			msg := "Няма счупени нотчове – файлът не е променян."
			if miss != nil {
				msg += " " + miss.Text()
			} else if noMarker {
				msg += noMrkHint
			}
			a.logEvent(Event{Time: now(), Src: p, Status: "info", Msg: msg, Marker: markerNote, NoMarker: noMarker})
		}
		return
	}
	before, after := Simulate(s), Simulate(best)
	e := Event{Time: now(), Src: p, Marker: markerNote, NoMarker: noMarker,
		Notches:       r.Total(func(x PieceSummary) int { return x.SourceNotches + x.SP4TSlits + x.GeomTNotches + x.ShapeNotches }),
		Embedded:      r.Total(func(x PieceSummary) int { return x.Embedded + x.SP4TSlits + x.GeomTNotches + x.ShapeNotches }),
		Dups:          r.Total(func(x PieceSummary) int { return x.DuplicatesRemoved + x.NearDupRemoved }),
		Unmapped:      r.Total(func(x PieceSummary) int { return x.Unmapped }),
		PhantomBefore: before.Phantom, PhantomAfter: after.Phantom,
	}
	if plan.rest != nil && plan.rest.Restored > 0 {
		e.RestoredFrom, e.RestoredN = mm.MRK, plan.rest.Restored
	}
	e.Report = r.ReportBG(filepath.Base(p)) + fmt.Sprintf("\nФантомни (червени) реза: преди %d, след %d\n", before.Phantom, after.Phantom)
	if t := plan.rest.Text(); t != "" {
		e.Report += "\n" + t + "\n  " + strings.Join(plan.rest.Coords, "\n  ") + "\n"
	}
	fail := func(path string, err error) {
		e.Status, e.Msg = "error", "Грешка при запис на "+filepath.Base(path)+" (отворен ли е?): "+err.Error()
		a.logEvent(e)
		a.note(path, "error")
	}
	var msg []string
	if plan.writeMain {
		e.Out = a.outPath(p)
		if err := writeAtomic(e.Out, plan.main); err != nil {
			fail(e.Out, err)
			return
		}
		if e.Embedded > 0 || e.PhantomBefore > 0 {
			msg = append(msg, fmt.Sprintf("Коригирани %d нотча (премахнати дубликати: %d), червени реза %d → %d.", e.Embedded, e.Dups, e.PhantomBefore, Simulate(plan.main).Phantom))
		}
		if plan.mainRestored {
			msg = append(msg, plan.rest.Text())
		}
	}
	if plan.second != "" {
		e.Out2 = a.restoredPath(p)
		if err := writeAtomic(e.Out2, plan.second); err != nil {
			fail(e.Out2, err)
			return
		}
		first := "Първият файл е без тях."
		if !plan.writeMain {
			first = "Оригиналът няма нужда от друга корекция."
		}
		shown := filepath.Base(e.Out2)
		if cfg.OutMode == "folder" {
			shown = filepath.Base(filepath.Dir(e.Out2)) + string(filepath.Separator) + shown
		}
		msg = append(msg, fmt.Sprintf("Втори файл с върнати %d липсващи нотча: %s. %s Прегледайте го преди рязане.", plan.rest.Restored, shown, first))
		if missMain != nil {
			e.Report += "\nФайл без върнати нотчове: " + missMain.Text() + "\nФайл с върнати нотчове: " + miss.Text() + "\n"
		}
	} else if miss != nil {
		e.Report += "\n" + miss.Text() + "\n"
	}
	rp := filepath.Join(a.dir, "reports", time.Now().Format("20060102_150405_")+filepath.Base(p)+".txt")
	_ = os.WriteFile(rp, []byte(strings.ReplaceAll(e.Report, "\n", "\r\n")), 0644)
	if cfg.ReportNextTo {
		o := e.Out
		if o == "" {
			o = e.Out2
		}
		_ = os.WriteFile(strings.TrimSuffix(o, filepath.Ext(o))+".txt", []byte(strings.ReplaceAll(e.Report, "\n", "\r\n")), 0644)
	}
	e.Status = "ok"
	if missing {
		e.Status = "warn"
		hint := ""
		if cfg.RestoreMode == "off" {
			hint = " Добавянето на липсващи нотчове е изключено в „Настройки“."
		} else if mm.MRK == "" {
			hint = " Няма .MRK на маркировката, затова не могат да се върнат."
		}
		msg = append(msg, "ВНИМАНИЕ: "+miss.Text()+hint)
	} else if miss == nil && noMarker {
		msg = append(msg, noMrkHint)
	}
	if r.HeaderWarn != "" {
		e.Status = "warn"
		msg = append(msg, "ПРОВЕРЕТЕ заглавката: "+r.HeaderWarn+". Експортирайте файла наново от Marker.")
	}
	if e.Unmapped > 0 || e.PhantomAfter > 0 {
		e.Status = "warn"
		msg = append(msg, fmt.Sprintf("ПРОВЕРЕТЕ: %d невградени нотча, %d червени реза след корекция.", e.Unmapped, e.PhantomAfter))
	}
	e.Msg = strings.Join(msg, " ")
	if e.Out2 != "" {
		a.note(e.Out2, e.Status)
	} else {
		a.note(e.Out, e.Status)
	}
	a.logEvent(e)
}

// outPlan: which files a conversion produces.
type outPlan struct {
	main         string // corrected file (with the restored notches when mode = same)
	writeMain    bool
	mainRestored bool
	second       string // separate copy that also has the restored notches (mode = separate)
	rest         *RestoreInfo
}

func planOutputs(r *Result, cfg Config, drawing func() *svgDrawing) outPlan {
	pl := outPlan{main: r.Fixed, writeMain: r.NeedsFix}
	if cfg.RestoreMode == "off" {
		return pl
	}
	d := drawing()
	if d == nil {
		return pl
	}
	fx, info := RestoreMissing(r.Fixed, d, cfg.SegmentTol)
	pl.rest = info
	if info.Restored == 0 {
		return pl
	}
	if cfg.RestoreMode == "same" {
		pl.main, pl.writeMain, pl.mainRestored = fx, true, true
	} else {
		pl.second = fx
	}
	return pl
}

func (a *App) note(out, status string) {
	if a.conf().Notify && a.notes != nil {
		a.notes.add(noteItem{out: out, status: status})
	}
}

// ---------------- http ----------------

func (a *App) handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/" {
			http.NotFound(w, r)
			return
		}
		b, _ := webFS.ReadFile("web/index.html")
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store")
		_, _ = w.Write(b)
	})
	mux.HandleFunc("/icon.png", func(w http.ResponseWriter, r *http.Request) {
		b, _ := assetFS.ReadFile("assets/icon64.png")
		w.Header().Set("Content-Type", "image/png")
		_, _ = w.Write(b)
	})
	mux.HandleFunc("/api/status", func(w http.ResponseWriter, r *http.Request) {
		a.mu.Lock()
		ev := append([]Event(nil), a.events...)
		watched := append([]string(nil), a.watched...)
		cfg := a.cfg
		paused := a.paused
		openView := a.viewReq
		a.viewReq = ""
		a.mu.Unlock()
		writeJSON(w, map[string]any{"version": appVersion, "watched": watched, "events": ev, "paused": paused, "openView": openView,
			"config": cfg, "iniPath": cfg.path, "dir": a.dir, "autostart": autostartEnabled(), "index": a.mix.status(), "markerTitles": a.currentMarkerTitles()})
	})
	mux.HandleFunc("/api/config", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "POST", 405)
			return
		}
		var in struct {
			Watch      []string  `json:"watch"`
			Exclude    []string  `json:"exclude"`
			Suffix     string    `json:"suffix"`
			Notify     bool      `json:"notify"`
			NearDup    int       `json:"neardup"`
			Autostart  bool      `json:"autostart"`
			OutMode    string    `json:"outMode"`
			ShapeV     *bool     `json:"shapeV"`
			ShapeBox   *bool     `json:"shapeBox"`
			ShapeU     *bool     `json:"shapeU"`
			CloseU     *bool     `json:"closeBrokenU"`
			CheckMiss  *bool     `json:"checkMissing"`
			Restore    string    `json:"restoreMode"`
			MarkerDirs *[]string `json:"markerDirs"`
			Quiet      *int      `json:"markerQuiet"`
		}
		if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&in); err != nil {
			http.Error(w, "Невалидни данни", 400)
			return
		}
		watch, missing := normWatch(in.Watch)
		sfx := strings.TrimSpace(in.Suffix)
		if sfx == "" || strings.ContainsAny(sfx, `\/:*?"<>|`) {
			http.Error(w, "Невалидна наставка за името", 400)
			return
		}
		a.mu.Lock()
		watchChanged := strings.Join(a.cfg.Watch, "|") != strings.Join(watch, "|")
		var mdMissing []string
		if in.MarkerDirs != nil {
			var md []string
			md, mdMissing = normWatch(*in.MarkerDirs)
			if strings.Join(a.cfg.MarkerDirs, "|") != strings.Join(md, "|") {
				watchChanged = true
			}
			a.cfg.MarkerDirs = md
		}
		a.cfg.Watch, a.cfg.Suffix, a.cfg.Notify = watch, sfx, in.Notify
		for _, f := range []struct {
			v   *bool
			dst *bool
		}{{in.ShapeV, &a.cfg.ShapeV}, {in.ShapeBox, &a.cfg.ShapeBox}, {in.ShapeU, &a.cfg.ShapeU}, {in.CloseU, &a.cfg.CloseBrokenU}} {
			if f.v != nil {
				*f.dst = *f.v
			}
		}
		if in.CheckMiss != nil {
			a.cfg.CheckMissing = *in.CheckMiss
		}
		if in.Restore == "off" || in.Restore == "same" || in.Restore == "separate" {
			a.cfg.RestoreMode = in.Restore
		}
		if in.OutMode == "folder" || in.OutMode == "suffix" {
			a.cfg.OutMode = in.OutMode
		}
		if in.Quiet != nil && *in.Quiet >= 0 && *in.Quiet <= maxMarkerQuiet {
			a.cfg.MarkerQuiet = *in.Quiet
			setMarkerQuiet(time.Duration(*in.Quiet) * time.Second)
		}
		if in.NearDup >= 0 && in.NearDup <= 50 {
			a.cfg.NearDupTol = in.NearDup
		}
		if in.Exclude != nil {
			a.cfg.Exclude = splitList(strings.Join(in.Exclude, ";"))
		}
		cfg := a.cfg
		a.mu.Unlock()
		if err := cfg.save(); err != nil {
			http.Error(w, "Настройките не могат да се запишат: "+err.Error(), 500)
			return
		}
		if watchChanged {
			a.applyWatch()
			trayRefresh(a)
		}
		logIt := watchChanged
		msg := "Настройките са запазени. Следени папки: " + strings.Join(watch, ", ")
		if len(cfg.MarkerDirs) > 0 {
			msg += ". Папки с маркировки: " + strings.Join(cfg.MarkerDirs, ", ")
		}
		if len(missing) > 0 {
			msg += ". ВНИМАНИЕ: в момента не съществува(т): " + strings.Join(missing, ", ") + " – ще се следи(ят), когато станат достъпни."
		}
		if len(mdMissing) > 0 {
			msg += ". ВНИМАНИЕ: папката с маркировки не съществува в момента: " + strings.Join(mdMissing, ", ")
		}
		if len(watch) == 0 {
			msg = "Настройките са запазени. Автоматичното конвертиране е ИЗКЛЮЧЕНО (няма избрани папки)."
		}
		if watchChanged {
			a.pmu.Lock()
			a.mrkDirty = time.Now() // new marker folders: GBRs waiting for a marker are checked again
			a.pmu.Unlock()
		}
		if in.Autostart != autostartEnabled() {
			if err := setAutostart(in.Autostart); err != nil {
				http.Error(w, "Стартирането с Windows не можа да се промени: "+err.Error(), 500)
				return
			}
			if in.Autostart {
				msg += " Програмата ще стартира с Windows."
			} else {
				msg += " Стартирането с Windows е изключено."
			}
			logIt = true
		}
		if logIt { // settings are saved automatically – only log what matters
			a.logEvent(Event{Time: now(), Status: "info", Msg: msg})
		}
		writeJSON(w, map[string]any{"ok": true, "msg": msg})
	})
	mux.HandleFunc("/api/show", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "POST", 405)
			return
		}
		a.showUI(r.URL.Query().Get("path"))
		w.WriteHeader(204)
	})
	mux.HandleFunc("/api/pause", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "POST", 405)
			return
		}
		a.setPaused(r.URL.Query().Get("on") == "1")
		w.WriteHeader(204)
	})
	mux.HandleFunc("/api/pickfolder", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "POST", 405)
			return
		}
		desc := "Изберете папка за автоматично конвертиране на .GBR"
		if r.URL.Query().Get("for") == "mrk" {
			desc = "Изберете папката, в която Marker записва .MRK и .PDS файловете"
		}
		p, err := pickFolder(desc)
		if err != nil {
			http.Error(w, err.Error(), 500)
			return
		}
		writeJSON(w, map[string]any{"path": p})
	})
	mux.HandleFunc("/api/reindex", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "POST", 405)
			return
		}
		a.mix.rescan()
		w.WriteHeader(204)
	})
	mux.HandleFunc("/api/pickmrk", func(w http.ResponseWriter, r *http.Request) {
		// the user chooses the marker of a GBR; it is remembered and the GBR is processed again
		if r.Method != http.MethodPost {
			http.Error(w, "POST", 405)
			return
		}
		src := r.URL.Query().Get("src")
		if !gbrExts[strings.ToLower(filepath.Ext(src))] {
			http.Error(w, "само за .GBR файлове", 400)
			return
		}
		start := filepath.Dir(src)
		if md := a.conf().MarkerDirs; len(md) > 0 {
			start = md[0]
		}
		p, err := pickFile("Изберете маркировката (.MRK) за "+filepath.Base(src), "Маркировка Optitex (*.mrk)|*.mrk", start)
		if err != nil {
			http.Error(w, err.Error(), 500)
			return
		}
		if p == "" {
			writeJSON(w, map[string]any{"path": ""})
			return
		}
		if !strings.EqualFold(filepath.Ext(p), ".mrk") || loadDrawing(p) == nil {
			http.Error(w, "Файлът не е маркировка на Optitex (.MRK с чертеж): "+filepath.Base(p), 400)
			return
		}
		if err := a.setPair(src, p); err != nil {
			http.Error(w, "Изборът не може да се запише: "+err.Error(), 500)
			return
		}
		a.logEvent(Event{Time: now(), Src: src, Status: "info", Msg: "Избрана маркировка " + p + " – файлът се обработва отново."})
		go a.reprocess(src)
		writeJSON(w, map[string]any{"path": p})
	})
	mux.HandleFunc("/api/analyze", func(w http.ResponseWriter, r *http.Request) {
		raw, name, err := a.readInput(r)
		if err != nil {
			http.Error(w, err.Error(), 400)
			return
		}
		if d := parseDrawing(raw); d != nil { // .MRK / .PDS: show the drawing with its notch coordinates
			if d.Kind == "MRK" {
				a.rememberMRK(name, d)
			}
			writeJSON(w, map[string]any{"name": name, "drawing": true, "kind": d.Kind, "sim": d.toSim(), "report": d.coordReport(name)})
			return
		}
		sim := Simulate(raw)
		conv := Convert(raw, a.conf().options())
		writeJSON(w, map[string]any{"name": name, "sim": sim, "needsFix": conv.NeedsFix})
	})
	mux.HandleFunc("/api/convert", func(w http.ResponseWriter, r *http.Request) {
		raw, name, err := a.readInput(r)
		if err != nil {
			http.Error(w, err.Error(), 400)
			return
		}
		cfg := a.conf()
		conv := Convert(raw, cfg.options())
		srcName := "MRK файла"
		plan := planOutputs(conv, cfg, func() *svgDrawing {
			if d := a.recallMRK(name); d != nil {
				return d
			}
			// not opened in the window: look for it in the marker folders (by name or content)
			if m := a.FindMarker(r.URL.Query().Get("path"), name, raw); m.MRK != "" {
				srcName = filepath.Base(m.MRK)
				return loadDrawing(m.MRK)
			}
			return nil
		})
		before := Simulate(raw)
		rep := conv.ReportBG(name)
		resp := map[string]any{"name": name, "needsFix": plan.writeMain, "before": before, "after": Simulate(plan.main),
			"fixed": base64.StdEncoding.EncodeToString([]byte(plan.main))}
		if plan.rest != nil {
			plan.rest.SourceName = srcName
			if t := plan.rest.Text(); t != "" {
				rep += "\n" + t + "\n  " + strings.Join(plan.rest.Coords, "\n  ") + "\n"
			}
		}
		if plan.second != "" {
			resp["restored"] = base64.StdEncoding.EncodeToString([]byte(plan.second))
			resp["afterRestored"] = Simulate(plan.second)
			resp["restoredCount"] = plan.rest.Restored
		}
		resp["report"] = rep + fmt.Sprintf("\nФантомни (червени) реза: преди %d, след %d\n", before.Phantom, Simulate(plan.main).Phantom)
		writeJSON(w, resp)
	})
	mux.HandleFunc("/api/reveal", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "POST", 405)
			return
		}
		p := r.URL.Query().Get("path")
		if gbrExts[strings.ToLower(filepath.Ext(p))] {
			revealInExplorer(p)
		}
		w.WriteHeader(204)
	})
	mux.HandleFunc("/api/quit", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "POST", 405)
			return
		}
		w.WriteHeader(204)
		go func() { time.Sleep(300 * time.Millisecond); appQuit() }()
	})
	port := strconv.Itoa(a.cfg.Port)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := r.Host
		if h != "127.0.0.1:"+port && h != "localhost:"+port {
			http.Error(w, "forbidden", 403) // DNS-rebinding protection
			return
		}
		if r.Method == http.MethodPost && r.Header.Get("X-GbrFix") != "1" {
			http.Error(w, "forbidden", 403) // CSRF protection
			return
		}
		mux.ServeHTTP(w, r)
	})
}

// readInput: GET ?path=  (only .gbr files) or POST body.
func (a *App) readInput(r *http.Request) (string, string, error) {
	if r.Method == http.MethodPost {
		if r.Header.Get("X-GbrFix") != "1" {
			return "", "", fmt.Errorf("forbidden")
		}
		b, err := io.ReadAll(io.LimitReader(r.Body, 64<<20))
		return string(b), r.URL.Query().Get("name"), err
	}
	p := r.URL.Query().Get("path")
	if ext := strings.ToLower(filepath.Ext(p)); !gbrExts[ext] && ext != ".mrk" && ext != ".pds" {
		return "", "", fmt.Errorf("разрешени са само .GBR, .MRK и .PDS файлове")
	}
	b, err := readShared(p)
	return string(b), filepath.Base(p), err
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	_ = json.NewEncoder(w).Encode(v)
}

// ---------------- main ----------------

func main() {
	args := os.Args[1:]
	background := false
	var fileArg string
	for i := 0; i < len(args); i++ {
		switch strings.ToLower(args[i]) {
		case "-background", "/background":
			background = true
		case "-convert":
			if i+1 < len(args) {
				in := args[i+1]
				raw, err := os.ReadFile(in)
				if err != nil {
					fmt.Println(err)
					os.Exit(1)
				}
				c := loadConfig(appDir())
				a := &App{cfg: c}
				r := Convert(string(raw), c.options())
				out := a.outPath(in)
				if i+2 < len(args) {
					out = args[i+2]
				}
				_ = os.WriteFile(out, []byte(r.Fixed), 0644)
				fmt.Print(r.ReportBG(in))
			}
			return
		default:
			fileArg = args[i]
		}
	}

	dir := appDir()
	_ = os.MkdirAll(filepath.Join(dir, "reports"), 0755)
	_, iniErr := os.Stat(filepath.Join(dir, "gbrfix.ini"))
	firstRun := iniErr != nil
	cfg := loadConfig(dir)
	setMarkerQuiet(time.Duration(cfg.MarkerQuiet) * time.Second)
	base := fmt.Sprintf("http://127.0.0.1:%d/", cfg.Port)
	if fileArg != "" {
		if abs, err := filepath.Abs(fileArg); err == nil {
			fileArg = abs
		}
	}

	addr := fmt.Sprintf("127.0.0.1:%d", cfg.Port)
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		hc := &http.Client{Timeout: 5 * time.Second}
		post := func(path string) error {
			req, _ := http.NewRequest(http.MethodPost, base+path, nil)
			req.Header.Set("X-GbrFix", "1")
			resp, err := hc.Do(req)
			if err == nil {
				resp.Body.Close()
			}
			return err
		}
		// a copy is already running: if it is another version, replace it with this one
		running := ""
		if resp, err := hc.Get(base + "api/status"); err == nil {
			var st struct {
				Version string `json:"version"`
			}
			_ = json.NewDecoder(resp.Body).Decode(&st)
			resp.Body.Close()
			running = st.Version
		}
		if running != "" && running != appVersion {
			_ = post("api/quit")
			for i := 0; i < 40 && err != nil; i++ {
				time.Sleep(150 * time.Millisecond)
				ln, err = net.Listen("tcp", addr)
			}
		}
		if err != nil {
			// same version (or it would not stop): just show its window (and the file)
			if perr := post("api/show?path=" + url.QueryEscape(fileArg)); perr != nil {
				fatalBox("GBR Fix вече работи, но не отговаря (порт " + strconv.Itoa(cfg.Port) + ").")
			}
			return
		}
	}
	lf, _ := os.OpenFile(filepath.Join(dir, "log.txt"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0644)
	if lf != nil {
		log.SetOutput(lf)
	}
	a := &App{cfg: cfg, dir: dir, pending: map[string]time.Time{}, done: map[string]string{}, waitMrk: map[string]time.Time{}, logf: lf, baseURL: base}
	a.loadPairs()
	a.mix.loadBoxes(filepath.Join(dir, "markers-cache.txt"))
	a.mix.onScanned = func() { // GBRs that wait for a marker are checked against the new list
		a.pmu.Lock()
		a.mrkDirty = time.Now()
		a.pmu.Unlock()
	}
	a.notes = newNotifier(func(n Note) {
		a.mu.Lock()
		a.lastNote = n
		a.mu.Unlock()
		trayNotify(n)
	})
	log.Printf("GBR Fix %s старт, конфигурация %s", appVersion, cfg.path)
	a.applyWatch()
	startMsg := "Програмата стартира. Следени папки: " + strings.Join(cfg.Watch, ", ")
	if len(cfg.Watch) == 0 {
		startMsg = "Програмата стартира. Не е избрана папка – изберете я от Настройки (или от бутона горе)."
	}
	a.logEvent(Event{Time: now(), Status: "info", Msg: startMsg})
	if firstRun {
		// the user asked for start with Windows; it can be switched off in Settings
		if err := setAutostart(true); err == nil {
			a.logEvent(Event{Time: now(), Status: "info", Msg: "Включено е стартиране с Windows (може да се изключи от Настройки)."})
		}
	} else if autostartEnabled() {
		_ = setAutostart(true) // keep the path current if the exe was moved
	}
	go a.pump()
	srv := &http.Server{Handler: a.handler(), ReadHeaderTimeout: 10 * time.Second}
	go func() { log.Println(srv.Serve(ln)) }()
	if !background || fileArg != "" {
		go func() { time.Sleep(300 * time.Millisecond); a.showUI(fileArg) }()
	}
	if len(cfg.Watch) == 0 {
		trayNotify(Note{Title: "GBR Fix – не е избрана папка", Text: "Кликнете тук и изберете папката, в която Marker записва .GBR файловете.", Warn: true})
	}
	runUI(a) // tray icon + message loop (blocks until "Изход")
	appQuit()
}
