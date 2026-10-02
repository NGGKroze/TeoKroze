package main

// Port of the GBR notch converter v16 logic (front-loaded Optitex T notches ->
// inline return-to-anchor notches A*M19*B*M15*A*M14), plus near-duplicate removal.
// Files are handled as raw bytes (Go strings), so the cp1251 header is kept as-is.

import (
	"fmt"
	"math"
	"sort"
	"strings"
)

type Options struct {
	RemoveDuplicates bool     // exact duplicate front notches (same A and B)
	NearDupTol       int      // also drop notches with same A and B within this many units (0 = off)
	Shapes           ShapeSel // which V / box / U notches drawn in the contour become I notches
	RecoverBrokenI   bool     // A*B*M15*A*M14 -> A*M19*B*M15*A*M14 (only for files damaged by old converters)
	SegmentTol       float64  // squared distance tolerance for inserting a notch anchor into a segment
}

func DefaultOptions() Options {
	return Options{RemoveDuplicates: true, NearDupTol: 3, RecoverBrokenI: false, SegmentTol: 400, Shapes: ShapeSel{CloseBrokenU: true}}
}

type PieceSummary struct {
	Piece             string         `json:"piece"`
	SourceNotches     int            `json:"sourceNotches"`
	UniqueNotches     int            `json:"uniqueNotches"`
	DuplicatesRemoved int            `json:"duplicatesRemoved"`
	NearDupRemoved    int            `json:"nearDupRemoved"`
	Embedded          int            `json:"embedded"`
	Unmapped          int            `json:"unmapped"`
	ExistingI         int            `json:"existingI"`
	PossibleL         int            `json:"possibleL"`
	RecoveredBrokenI  int            `json:"recoveredBrokenI"`
	SP4TSlits         int            `json:"sp4TSlits"`
	GeomTNotches      int            `json:"geomTNotches"` // T drawn as plain cuts (no M19), Optitex 26.1+
	ShapeNotches      int            `json:"shapeNotches"`
	ShapeKinds        map[string]int `json:"shapeKinds"`
	Warnings          []string       `json:"warnings"`
}

type Result struct {
	Fixed     string         `json:"-"`
	Pieces    []PieceSummary `json:"pieces"`
	InM19     int            `json:"inM19"`
	OutM19    int            `json:"outM19"`
	InM14M19  int            `json:"inM14M19"`
	OutM14M19 int            `json:"outM14M19"`
	Changed   bool           `json:"changed"`
	// NeedsFix: the file contains Optitex structures the cutter misreads.
	NeedsFix bool `json:"needsFix"`
	// HeaderWarn: damaged header (e.g. file re-saved as UTF-8, marker length ZX missing)
	HeaderWarn string `json:"headerWarn"`
}

func (r *Result) Total(f func(p PieceSummary) int) int {
	t := 0
	for _, p := range r.Pieces {
		t += f(p)
	}
	return t
}

// ---------- token helpers ----------

func parseCoord(t string) (int, int, bool) {
	if len(t) < 4 || t[0] != 'X' {
		return 0, 0, false
	}
	i := 1
	x, ok, n := parseInt(t, i)
	if !ok {
		return 0, 0, false
	}
	i = n
	if i >= len(t) || t[i] != 'Y' {
		return 0, 0, false
	}
	y, ok, n := parseInt(t, i+1)
	if !ok || n != len(t) {
		return 0, 0, false
	}
	return x, y, true
}

func parseInt(t string, i int) (int, bool, int) {
	neg := false
	if i < len(t) && t[i] == '-' {
		neg = true
		i++
	}
	st := i
	v := 0
	for i < len(t) && t[i] >= '0' && t[i] <= '9' {
		v = v*10 + int(t[i]-'0')
		i++
	}
	if i == st {
		return 0, false, i
	}
	if neg {
		v = -v
	}
	return v, true, i
}

func isCoord(t string) bool { _, _, ok := parseCoord(t); return ok }

func isPieceTok(t string) bool {
	if len(t) < 2 || t[0] != 'N' {
		return false
	}
	for i := 1; i < len(t); i++ {
		if t[i] < '0' || t[i] > '9' {
			return false
		}
	}
	return true
}

type pt struct{ x, y float64 }

func mustPt(t string) pt { x, y, _ := parseCoord(t); return pt{float64(x), float64(y)} }

func segDist2T(p, a, b pt) (float64, float64) {
	vx, vy := b.x-a.x, b.y-a.y
	wx, wy := p.x-a.x, p.y-a.y
	l2 := vx*vx + vy*vy
	if l2 == 0 {
		dx, dy := p.x-a.x, p.y-a.y
		return dx*dx + dy*dy, 0
	}
	t := (wx*vx + wy*vy) / l2
	if t < 0 {
		t = 0
	}
	if t > 1 {
		t = 1
	}
	qx, qy := a.x+t*vx, a.y+t*vy
	dx, dy := p.x-qx, p.y-qy
	return dx*dx + dy*dy, t
}

// ---------- structure ----------

type notch struct {
	A, B        string
	sourceIndex int
	anchorOut   string
	t           float64
}

func findContourStart(p []string) int {
	for i := 0; i < len(p)-2; i++ {
		if isCoord(p[i]) && p[i+1] == "M14" {
			if i+4 < len(p) && p[i+2] == "M19" && isCoord(p[i+3]) && p[i+4] == "M15" {
				continue
			}
			if i+3 < len(p) && isCoord(p[i+2]) && p[i+3] == "M15" {
				continue
			}
			c := 0
			end := i + 30
			if end > len(p) {
				end = len(p)
			}
			for j := i + 2; j < end; j++ {
				if isCoord(p[j]) {
					c++
				}
			}
			if c >= 2 {
				return i
			}
		}
	}
	return -1
}

func extractFrontNotches(front []string, o Options, s *PieceSummary) ([]string, []notch) {
	var preserved []string
	var ns []notch
	for i := 0; i < len(front); {
		if i+4 < len(front) && isCoord(front[i]) && front[i+1] == "M14" && front[i+2] == "M19" && isCoord(front[i+3]) && front[i+4] == "M15" {
			ns = append(ns, notch{A: front[i], B: front[i+3], sourceIndex: i})
			i += 5
			continue
		}
		if i+3 < len(front) && isCoord(front[i]) && front[i+1] == "M14" && isCoord(front[i+2]) && front[i+3] == "M15" {
			ns = append(ns, notch{A: front[i], B: front[i+2], sourceIndex: i})
			i += 4
			continue
		}
		preserved = append(preserved, front[i])
		i++
	}
	s.SourceNotches = len(ns)
	if o.RemoveDuplicates {
		seen := map[string]bool{}
		var out []notch
		for _, n := range ns {
			k := n.A + "|" + n.B
			if seen[k] {
				s.DuplicatesRemoved++
				continue
			}
			seen[k] = true
			out = append(out, n)
		}
		if s.DuplicatesRemoved > 0 {
			s.Warnings = append(s.Warnings, fmt.Sprintf("Премахнати %d точни дубликата на нотч.", s.DuplicatesRemoved))
		}
		ns = out
		if o.NearDupTol > 0 {
			var out2 []notch
			for _, n := range ns {
				bx, by, _ := parseCoord(n.B)
				dup := false
				for _, k := range out2 {
					if k.A != n.A {
						continue
					}
					kx, ky, _ := parseCoord(k.B)
					if abs(kx-bx) <= o.NearDupTol && abs(ky-by) <= o.NearDupTol {
						dup = true
						break
					}
				}
				if dup {
					s.NearDupRemoved++
					s.Warnings = append(s.Warnings, fmt.Sprintf("%s: почти еднакъв нотч (%s) е премахнат.", n.A, n.B))
					continue
				}
				out2 = append(out2, n)
			}
			ns = out2
		}
	}
	s.UniqueNotches = len(ns)
	return preserved, ns
}

func abs(a int) int {
	if a < 0 {
		return -a
	}
	return a
}

func recoverBrokenInlineI(c []string) ([]string, int) {
	var out []string
	rec := 0
	for i := 0; i < len(c); {
		if i+4 < len(c) && isCoord(c[i]) && isCoord(c[i+1]) && c[i+2] == "M15" && c[i+3] == c[i] && c[i+4] == "M14" {
			out = append(out, c[i], "M19", c[i+1], "M15", c[i+3], "M14")
			rec++
			i += 5
			continue
		}
		out = append(out, c[i])
		i++
	}
	return out, rec
}

// repairGeomTNotches handles notches exported as a drawn "T" without any notch code:
//
//	A*B*M15*C*M14*D*M15*A*M14   (slit A->B, crossbar C->D centred on B, back to A)
//
// -> A*M19*B*M15*A*M14. Geometry is checked so ordinary contour cuts are never touched.
func repairGeomTNotches(c []string) ([]string, int) {
	var out []string
	conv := 0
	for i := 0; i < len(c); {
		if i+8 < len(c) && isCoord(c[i]) && isCoord(c[i+1]) && c[i+2] == "M15" && isCoord(c[i+3]) && c[i+4] == "M14" && isCoord(c[i+5]) && c[i+6] == "M15" && c[i+7] == c[i] && c[i+8] == "M14" && isTNotch(c[i], c[i+1], c[i+3], c[i+5]) {
			out = append(out, c[i], "M19", c[i+1], "M15", c[i], "M14")
			conv++
			i += 9
			continue
		}
		out = append(out, c[i])
		i++
	}
	return out, conv
}

func isTNotch(as, bs, cs, ds string) bool {
	a, b, c, d := mustPt(as), mustPt(bs), mustPt(cs), mustPt(ds)
	ab := math.Hypot(b.x-a.x, b.y-a.y)
	cd := math.Hypot(d.x-c.x, d.y-c.y)
	if ab < 5 || ab > 100 || cd < 5 || cd > 100 {
		return false
	}
	mx, my := (c.x+d.x)/2, (c.y+d.y)/2
	if math.Hypot(mx-b.x, my-b.y) > 3 {
		return false // crossbar must be centred on the slit end
	}
	cos := math.Abs((b.x-a.x)*(d.x-c.x)+(b.y-a.y)*(d.y-c.y)) / (ab * cd)
	return cos < 0.2 // crossbar perpendicular to the slit
}

func repairSP4InlineTSlits(c []string) ([]string, int) {
	var out []string
	conv := 0
	for i := 0; i < len(c); {
		if i+9 < len(c) && isCoord(c[i]) && c[i+1] == "M19" && isCoord(c[i+2]) && c[i+3] == "M15" && isCoord(c[i+4]) && c[i+5] == "M14" && isCoord(c[i+6]) && c[i+7] == "M15" && c[i+8] == c[i] && c[i+9] == "M14" {
			out = append(out, c[i], "M19", c[i+2], "M15", c[i], "M14")
			conv++
			i += 10
			continue
		}
		out = append(out, c[i])
		i++
	}
	return out, conv
}

type skEntry struct {
	coord      string
	idx, after int
}

func skeletonFromContour(c []string) ([]skEntry, int) {
	var sk []skEntry
	blocks := 0
	for i := 0; i < len(c); {
		if i+5 < len(c) && isCoord(c[i]) && c[i+1] == "M19" && isCoord(c[i+2]) && c[i+3] == "M15" && c[i+4] == c[i] && c[i+5] == "M14" {
			sk = append(sk, skEntry{c[i], i, i + 6})
			blocks++
			i += 6
			continue
		}
		if isCoord(c[i]) {
			sk = append(sk, skEntry{c[i], i, i + 1})
		}
		i++
	}
	return sk, blocks
}

func detectPossibleLJogs(sk []skEntry) int {
	n := 0
	for i := 1; i < len(sk)-1; i++ {
		a, b, c := mustPt(sk[i-1].coord), mustPt(sk[i].coord), mustPt(sk[i+1].coord)
		if math.Abs(a.y-c.y) <= 2 && math.Abs(b.y-a.y) >= 15 && math.Abs(b.y-a.y) <= 120 && math.Abs(c.x-a.x) <= 80 {
			n++
		} else if math.Abs(a.x-c.x) <= 2 && math.Abs(b.x-a.x) >= 15 && math.Abs(b.x-a.x) <= 120 && math.Abs(c.y-a.y) <= 80 {
			n++
		}
	}
	return n
}

func mapNotches(ns []notch, sk []skEntry, c []string, tol float64, s *PieceSummary) (map[int][]notch, map[int][]notch) {
	pointEv := map[int][]notch{}
	segEv := map[int][]notch{}
	if len(sk) == 0 {
		s.Unmapped = len(ns)
		return pointEv, segEv
	}
	first := map[string]skEntry{}
	for _, e := range sk {
		if _, ok := first[e.coord]; !ok {
			first[e.coord] = e
		}
	}
	xy := make([]pt, len(sk))
	for i, e := range sk {
		xy[i] = mustPt(e.coord)
	}
	for _, n := range ns {
		if e, ok := first[n.A]; ok {
			n.anchorOut = n.A
			pointEv[e.idx] = append(pointEv[e.idx], n)
			continue
		}
		p := mustPt(n.A)
		bestJ := -1
		var bestD, bestT float64
		for j := 0; j < len(sk)-1; j++ {
			d, t := segDist2T(p, xy[j], xy[j+1])
			if bestJ < 0 || d < bestD {
				bestJ, bestD, bestT = j, d, t
			}
		}
		if bestJ >= 0 && bestD <= tol {
			j := bestJ
			if bestT <= 1e-9 {
				e := sk[j]
				n.anchorOut = e.coord
				pointEv[e.idx] = append(pointEv[e.idx], n)
				if e.coord != n.A {
					s.Warnings = append(s.Warnings, fmt.Sprintf("%s: прихванат към %s (начало на сегмент)", n.A, e.coord))
				}
			} else if bestT >= 1-1e-9 {
				e := sk[j+1]
				n.anchorOut = e.coord
				pointEv[e.idx] = append(pointEv[e.idx], n)
				if e.coord != n.A {
					s.Warnings = append(s.Warnings, fmt.Sprintf("%s: прихванат към %s (край на сегмент)", n.A, e.coord))
				}
			} else {
				pos := sk[j].after
				if sk[j].idx+1 < len(c) && c[sk[j].idx+1] == "M14" {
					pos = sk[j].idx + 2
				}
				n.anchorOut = n.A
				n.t = bestT
				segEv[pos] = append(segEv[pos], n)
				s.Warnings = append(s.Warnings, fmt.Sprintf("%s: вмъкнат в сегмент %s -> %s", n.A, sk[j].coord, sk[j+1].coord))
			}
		} else {
			s.Unmapped++
			s.Warnings = append(s.Warnings, fmt.Sprintf("%s: НЕ Е ВГРАДЕН – няма близък сегмент от контура", n.A))
		}
	}
	for k := range pointEv {
		l := pointEv[k]
		sort.SliceStable(l, func(a, b int) bool { return l[a].sourceIndex < l[b].sourceIndex })
	}
	for k := range segEv {
		l := segEv[k]
		sort.SliceStable(l, func(a, b int) bool {
			if l[a].t != l[b].t {
				return l[a].t < l[b].t
			}
			return l[a].sourceIndex < l[b].sourceIndex
		})
	}
	return pointEv, segEv
}

func rebuildContour(c []string, pointEv, segEv map[int][]notch) []string {
	var out []string
	for i := 0; i < len(c); i++ {
		for _, ev := range segEv[i] {
			out = append(out, ev.anchorOut, "M19", ev.B, "M15", ev.anchorOut, "M14")
		}
		if evs, ok := pointEv[i]; ok && isCoord(c[i]) {
			A := c[i]
			nextIsM14 := i+1 < len(c) && c[i+1] == "M14"
			out = append(out, A)
			for _, ev := range evs {
				anchor := ev.anchorOut
				if anchor == "" {
					anchor = A
				}
				if nextIsM14 {
					out = append(out, "M19", ev.B, "M15", anchor)
				} else {
					out = append(out, "M19", ev.B, "M15", anchor, "M14")
				}
			}
			continue
		}
		out = append(out, c[i])
	}
	for _, ev := range segEv[len(c)] {
		out = append(out, ev.anchorOut, "M19", ev.B, "M15", ev.anchorOut, "M14")
	}
	return out
}

func convertPiece(piece []string, o Options) ([]string, PieceSummary) {
	s := PieceSummary{Piece: "?"}
	if len(piece) > 0 {
		s.Piece = piece[0]
	}
	cs := findContourStart(piece)
	if cs < 0 {
		s.Warnings = append(s.Warnings, "Не е открит начален контур; детайлът е оставен без промяна.")
		return piece, s
	}
	front := piece[:cs]
	contour := append([]string(nil), piece[cs:]...)
	preserved, ns := extractFrontNotches(front, o, &s)
	contour, s.SP4TSlits = repairSP4InlineTSlits(contour)
	if s.SP4TSlits > 0 {
		s.Warnings = append(s.Warnings, fmt.Sprintf("Коригирани %d SP4 T-образни slit нотча към I-форма.", s.SP4TSlits))
	}
	contour, s.GeomTNotches = repairGeomTNotches(contour)
	if s.GeomTNotches > 0 {
		s.Warnings = append(s.Warnings, fmt.Sprintf("Коригирани %d нотча, изрязвани като T (без M19), към I-нотч с M19.", s.GeomTNotches))
	}
	if o.RecoverBrokenI {
		contour, s.RecoveredBrokenI = recoverBrokenInlineI(contour)
	}
	if o.Shapes.any() {
		contour, s.ShapeKinds = repairShapeNotches(contour, o.Shapes)
		for k, v := range s.ShapeKinds {
			s.ShapeNotches += v
			if k == "U затворен" {
				s.Warnings = append(s.Warnings, fmt.Sprintf("%d U нотча довършени до ръба (без отрязана ивица).", v))
			} else {
				s.Warnings = append(s.Warnings, fmt.Sprintf("%d %s нотча (изрязвани като форма) -> I-нотч с M19.", v, k))
			}
		}
	}
	sk, blocks := skeletonFromContour(contour)
	s.ExistingI = blocks
	s.PossibleL = detectPossibleLJogs(sk)
	if len(ns) == 0 {
		return append(append([]string(nil), preserved...), contour...), s
	}
	pe, se := mapNotches(ns, sk, contour, o.SegmentTol, &s)
	for _, l := range pe {
		s.Embedded += len(l)
	}
	for _, l := range se {
		s.Embedded += len(l)
	}
	out := append(append([]string(nil), preserved...), rebuildContour(contour, pe, se)...)
	return out, s
}

func countImmediate(t []string, a, b string) int {
	c := 0
	for i := 0; i+1 < len(t); i++ {
		if t[i] == a && t[i+1] == b {
			c++
		}
	}
	return c
}

func countTok(t []string, a string) int {
	c := 0
	for _, x := range t {
		if x == a {
			c++
		}
	}
	return c
}

// Convert runs the full conversion on raw file content.
func Convert(raw string, o Options) *Result {
	trailing := strings.HasSuffix(raw, "*")
	toks := strings.Split(raw, "*")
	if trailing && len(toks) > 0 && toks[len(toks)-1] == "" {
		toks = toks[:len(toks)-1]
	}
	var starts []int
	for i, t := range toks {
		if isPieceTok(t) {
			starts = append(starts, i)
		}
	}
	r := &Result{Fixed: raw}
	r.InM19 = countTok(toks, "M19")
	r.InM14M19 = countImmediate(toks, "M14", "M19")
	if len(starts) == 0 {
		r.OutM19, r.OutM14M19 = r.InM19, r.InM14M19
		return r
	}
	out := append([]string(nil), toks[:starts[0]]...)
	for k, st := range starts {
		end := len(toks)
		if k+1 < len(starts) {
			end = starts[k+1]
		}
		pt, s := convertPiece(toks[st:end], o)
		out = append(out, pt...)
		r.Pieces = append(r.Pieces, s)
	}
	r.Fixed = strings.Join(out, "*")
	if trailing {
		r.Fixed += "*"
	}
	r.OutM19 = countTok(out, "M19")
	r.OutM14M19 = countImmediate(out, "M14", "M19")
	r.Changed = r.Fixed != raw
	r.NeedsFix = r.Total(func(p PieceSummary) int { return p.SourceNotches + p.SP4TSlits + p.GeomTNotches + p.ShapeNotches }) > 0
	r.HeaderWarn = checkHeader(toks[:starts[0]])
	return r
}

// ReportBG builds a short Bulgarian text report.
func (r *Result) ReportBG(name string) string {
	var b strings.Builder
	t := func(f func(p PieceSummary) int) int { return r.Total(f) }
	fmt.Fprintf(&b, "Файл: %s\n", name)
	fmt.Fprintf(&b, "Детайли: %d\n", len(r.Pieces))
	fmt.Fprintf(&b, "Изнесени отпред (счупени) нотчове: %d\n", t(func(p PieceSummary) int { return p.SourceNotches }))
	fmt.Fprintf(&b, "Вградени обратно в контура: %d\n", t(func(p PieceSummary) int { return p.Embedded }))
	fmt.Fprintf(&b, "SP4 T-slit корекции: %d\n", t(func(p PieceSummary) int { return p.SP4TSlits }))
	fmt.Fprintf(&b, "T-нотчове, изрязвани като T (без M19): %d\n", t(func(p PieceSummary) int { return p.GeomTNotches }))
	fmt.Fprintf(&b, "V / кутия / U нотчове (към I или довършен U): %d\n", t(func(p PieceSummary) int { return p.ShapeNotches }))
	if r.HeaderWarn != "" {
		fmt.Fprintf(&b, "ВНИМАНИЕ – заглавка: %s\n", r.HeaderWarn)
	}
	fmt.Fprintf(&b, "Премахнати дубликати: %d точни, %d почти еднакви\n", t(func(p PieceSummary) int { return p.DuplicatesRemoved }), t(func(p PieceSummary) int { return p.NearDupRemoved }))
	fmt.Fprintf(&b, "Невградени (ПРОВЕРЕТЕ!): %d\n", t(func(p PieceSummary) int { return p.Unmapped }))
	fmt.Fprintf(&b, "M19: %d -> %d | M14*M19: %d -> %d\n", r.InM19, r.OutM19, r.InM14M19, r.OutM14M19)
	for _, p := range r.Pieces {
		if len(p.Warnings) == 0 {
			continue
		}
		fmt.Fprintf(&b, "\n%s:\n", p.Piece)
		for _, w := range p.Warnings {
			fmt.Fprintf(&b, "  - %s\n", w)
		}
	}
	return b.String()
}

// checkHeader looks for signs that the file was edited/re-saved by a text editor.
func checkHeader(h []string) string {
	var w []string
	joined := strings.Join(h, "*")
	if strings.Contains(joined, "\xef\xbf\xbd") {
		w = append(w, "текстът в заглавката е повреден (файлът е презаписан като UTF-8 от текстов редактор/имейл)")
	}
	hasZX := false
	for _, t := range h {
		if strings.HasPrefix(t, "ZX") {
			hasZX = true
		}
	}
	if !hasZX {
		w = append(w, "липсва ZX (дължина на маркировката)")
	}
	return strings.Join(w, "; ")
}
