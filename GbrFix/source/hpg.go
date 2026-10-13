package main

// HP-GL cut files (.HPG) from Optitex 26.
//
// The marker is written in plotter units (with "HPGL resolution: Metric 1/40" one unit is
// 0.025 mm, i.e. 4 units per 0.1 mm of the GBR/MRK), with the same origin and axes as the
// GBR. A notch on the cut line is drawn as a T: from the edge point E the pen goes down
// 4 mm into the piece (I), lifts, draws a 4 mm crossbar through I (C1 -> C2), lifts back
// to E and the contour continues:
//     ... PD E; PD I; PU C1; PD C2; PU E; PD next ...
// Optitex 26 leaves out the last notch of every contour (the one just before the contour
// closes) and, like in the GBR, some others. RestoreHPG puts back, in the same form, the
// notches of the marker (.MRK drawing) that are missing from the file.

import (
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"
)

// isHPGL: content of an HP-GL file (commands like "PU;" / "PD x,y;"), not a GBR.
func isHPGL(s string) bool {
	if strings.Contains(s, "*N") && strings.Contains(s, "M1") {
		return false
	}
	head := s
	if len(head) > 4096 {
		head = head[:4096]
	}
	head = strings.ToUpper(head)
	return strings.Contains(head, "PD") && strings.Contains(head, "PU") && strings.Contains(head, ";")
}

type hpgCmd struct {
	raw string   // the command as in the file, with the line break before it
	op  string   // PU, PD, SP, ... (upper case)
	arg string   // text after the op
	pts [][2]int // coordinates of PU/PD
}

type hpgFile struct {
	cmds []hpgCmd
	sep  string // what follows each ";" in the file (e.g. "\r\n")
	tail string // text after the last ";"
}

func parseHPG(s string) *hpgFile {
	f := &hpgFile{}
	if i := strings.Index(s, ";"); i >= 0 {
		j := i + 1
		for j < len(s) && (s[j] == '\r' || s[j] == '\n') {
			j++
		}
		f.sep = s[i+1 : j]
	}
	parts := strings.Split(s, ";")
	f.tail = parts[len(parts)-1]
	for _, raw := range parts[:len(parts)-1] {
		p := strings.TrimSpace(raw)
		if len(p) < 2 {
			f.cmds = append(f.cmds, hpgCmd{raw: raw, op: p})
			continue
		}
		c := hpgCmd{raw: raw, op: strings.ToUpper(p[:2]), arg: p[2:]}
		if (c.op == "PU" || c.op == "PD" || c.op == "PA") && strings.TrimSpace(c.arg) != "" {
			v := strings.Split(c.arg, ",")
			for k := 0; k+1 < len(v); k += 2 {
				x, e1 := strconv.Atoi(strings.TrimSpace(v[k]))
				y, e2 := strconv.Atoi(strings.TrimSpace(v[k+1]))
				if e1 != nil || e2 != nil {
					c.pts = nil
					break
				}
				c.pts = append(c.pts, [2]int{x, y})
			}
		}
		f.cmds = append(f.cmds, c)
	}
	return f
}

// hpgStep is one pen position: command index, point index, pen state.
type hpgStep struct {
	ci, pi int
	down   bool
	pen    string
	x, y   int
}

func (f *hpgFile) steps() []hpgStep {
	var out []hpgStep
	pen := ""
	down := false
	for ci, c := range f.cmds {
		switch c.op {
		case "SP":
			pen = strings.TrimSpace(c.arg)
		case "PU", "PD":
			down = c.op == "PD"
			for pi, p := range c.pts {
				out = append(out, hpgStep{ci, pi, down, pen, p[0], p[1]})
			}
		}
	}
	return out
}

// hpgNotch is a notch found in the file: E on the edge, I the inner end, optional crossbar.
type hpgNotch struct {
	pen          string
	e, i         [2]int
	c1, c2       [2]int
	t            bool  // T (with crossbar) or I
	ret          bool  // the pen goes back to E (notch inside the contour); false = notch drawn on its own
	idx          []int // step indexes of the notch moves (not part of the contour)
	edgeStep     int
	slit, crossb float64
}

func dist(a, b [2]int) float64 { return math.Hypot(float64(a[0]-b[0]), float64(a[1]-b[1])) }

// isTShape: the crossbar C1–C2 is perpendicular to the slit E–I, centred on I, and about
// as long as the slit (any plotter resolution: slit 2–8 mm is 20–1000 units).
func isTShape(e, i, c1, c2 [2]int) bool {
	slit, bar := dist(e, i), dist(c1, c2)
	if slit < 20 || slit > 1000 || bar < 0.6*slit || bar > 1.7*slit {
		return false
	}
	mx, my := float64(c1[0]+c2[0])/2, float64(c1[1]+c2[1])/2
	if math.Hypot(mx-float64(i[0]), my-float64(i[1])) > 0.03*bar+2 {
		return false
	}
	cos := float64((i[0]-e[0])*(c2[0]-c1[0])+(i[1]-e[1])*(c2[1]-c1[1])) / (slit * bar)
	return math.Abs(cos) <= 0.1
}

// hpgNotches finds the notches of a file. Optitex writes a T in two ways:
//
//	HPG (notch inside the contour):   E; PD I; PU C1; PD C2; PU E   (the pen goes back to E)
//	PLT (notch on its own pen):       PU E; PU E; PD I; PU C1; PD C2 (nothing follows)
//
// and an I notch as E; PD I; PU E.
func hpgNotches(st []hpgStep) []hpgNotch {
	var out []hpgNotch
	same := func(a, b hpgStep) bool { return a.x == b.x && a.y == b.y }
	pt := func(s hpgStep) [2]int { return [2]int{s.x, s.y} }
	for k := 1; k < len(st); k++ {
		e := st[k-1]
		if !st[k].down || st[k].pen != e.pen {
			continue
		}
		if k+2 < len(st) && !st[k+1].down && st[k+2].down && st[k+1].pen == e.pen && st[k+2].pen == e.pen &&
			isTShape(pt(e), pt(st[k]), pt(st[k+1]), pt(st[k+2])) {
			n := hpgNotch{pen: e.pen, e: pt(e), i: pt(st[k]), c1: pt(st[k+1]), c2: pt(st[k+2]), t: true,
				idx: []int{k, k + 1, k + 2}, edgeStep: k - 1}
			if k+3 < len(st) && !st[k+3].down && st[k+3].pen == e.pen && same(st[k+3], e) {
				n.ret = true
				n.idx = append(n.idx, k+3)
			}
			n.slit, n.crossb = dist(n.e, n.i), dist(n.c1, n.c2)
			out = append(out, n)
			k += len(n.idx) - 1
			continue
		}
		if k+1 < len(st) && !st[k+1].down && same(st[k+1], e) && st[k+1].pen == e.pen {
			n := hpgNotch{pen: e.pen, e: pt(e), i: pt(st[k]), ret: true, idx: []int{k, k + 1}, edgeStep: k - 1}
			n.slit = dist(n.e, n.i)
			if n.slit > 0 {
				out = append(out, n)
				k++
			}
		}
	}
	return out
}

// hpgPens: the pen that cuts the contours (the one that draws the most) and the pen that
// carries the notches (the one with most notches). In an HPG they are the same pen, in a
// PLT the notches have a pen of their own.
func hpgPens(st []hpgStep, ns []hpgNotch) (cut, notch string) {
	cnt := map[string]int{}
	for _, n := range ns {
		cnt[n.pen]++
	}
	best := 0
	for p, c := range cnt {
		if c > best || (c == best && p < notch) {
			notch, best = p, c
		}
	}
	length := map[string]float64{}
	for k := 1; k < len(st); k++ {
		if st[k].down && st[k-1].pen == st[k].pen {
			length[st[k].pen] += math.Hypot(float64(st[k].x-st[k-1].x), float64(st[k].y-st[k-1].y))
		}
	}
	var bl float64
	for p, l := range length {
		if l > bl || (l == bl && p < cut) {
			cut, bl = p, l
		}
	}
	if notch == "" {
		notch = cut
	}
	return cut, notch
}

// hpgTransform maps marker coordinates (0.1 mm) to file units.
type hpgTransform struct {
	scale float64
	swap  bool
}

func (t hpgTransform) apply(x, y float64) (float64, float64) {
	if t.swap {
		x, y = y, x
	}
	return x * t.scale, y * t.scale
}

func (t hpgTransform) back(x, y int) (int, int) {
	fx, fy := float64(x)/t.scale, float64(y)/t.scale
	if t.swap {
		fx, fy = fy, fx
	}
	return int(math.Round(fx)), int(math.Round(fy))
}

// plotter resolutions: Metric 1/40 mm (the usual), 1/10, 1/100 mm, 1/1000 inch
var hpgScales = []float64{4, 1, 10, 2, 0.1 / 0.0254}

// hpgFit finds the pen and the transform under which most notches of the file lie on
// marker notches. matched = notches of the marker that the file already has.
func hpgFit(ns []hpgNotch, d *svgDrawing) (pen string, tr hpgTransform, matched int) {
	type key struct {
		pen string
		tr  hpgTransform
	}
	best, bestN := key{}, 0
	for _, sc := range hpgScales {
		for _, sw := range []bool{false, true} {
			tr := hpgTransform{sc, sw}
			tol := 10 * tr.scale // 1 mm
			count := map[string]int{}
			for _, p := range d.Pieces {
				for _, mn := range p.Notches {
					x, y := tr.apply(float64(mn[0]), float64(mn[1]))
					found := map[string]bool{}
					for _, n := range ns {
						if !found[n.pen] && math.Abs(float64(n.e[0])-x) <= tol && math.Abs(float64(n.e[1])-y) <= tol {
							found[n.pen] = true
							count[n.pen]++
						}
					}
				}
			}
			for pen, c := range count {
				if c > bestN {
					best, bestN = key{pen, tr}, c
				}
			}
		}
	}
	return best.pen, best.tr, bestN
}

func median(v []float64) float64 {
	if len(v) == 0 {
		return 0
	}
	s := append([]float64(nil), v...)
	sort.Float64s(s)
	return s[len(s)/2]
}

type hpgInsert struct {
	afterStep int    // the new moves go after this step
	edge      [2]int // on the contour
	inner     [2]int
	c1, c2    [2]int
	t         bool
	sep       bool // notch on its own pen (PLT): no contour point, no return to the edge
	lead      int  // sep: how many times "PU E" is written before PD I (as the file does)
}

// HPGCheck: what the marker expects and what the file has.
type HPGCheck struct {
	Expected int
	Found    int
	NoFit    bool // the file does not line up with the marker
}

// RestoreHPG adds the marker notches that are missing from an HP-GL file, in the file's
// own notch form (T or I, same lengths). It returns the new content, what was added and
// the check of the file before the change.
func RestoreHPG(raw string, d *svgDrawing) (string, *RestoreInfo, HPGCheck) {
	info := &RestoreInfo{ByPiece: map[string]int{}}
	var chk HPGCheck
	if d == nil || d.Kind != "MRK" {
		return raw, info, chk
	}
	for _, p := range d.Pieces {
		chk.Expected += len(p.Notches)
	}
	f := parseHPG(raw)
	st := f.steps()
	ns := hpgNotches(st)
	pen, tr, matched := hpgFit(ns, d)
	if pen == "" || matched*2 < min(len(ns), chk.Expected) {
		chk.NoFit = true
		return raw, info, chk
	}
	chk.Found = matched
	// the notch form used in this file
	var slits, bars []float64
	tCount := 0
	notchStep := map[int]bool{}
	var mine []hpgNotch
	for _, n := range ns {
		if n.pen != pen {
			continue
		}
		mine = append(mine, n)
		slits = append(slits, n.slit)
		if n.t {
			tCount++
			bars = append(bars, n.crossb)
		}
		for _, k := range n.idx {
			notchStep[k] = true
		}
	}
	slit, bar := median(slits), median(bars)
	useT := tCount*2 >= len(mine)
	retN := 0
	for _, n := range mine {
		if n.ret {
			retN++
		}
	}
	sepForm := retN*2 < len(mine) // PLT: the notches are drawn on a pen of their own
	if slit == 0 {
		slit, bar, useT = 40*tr.scale, 40*tr.scale, true // 4 mm
	}
	where := ""
	if sepForm {
		where = fmt.Sprintf(" с перо %s", pen)
	}
	info.Form = fmt.Sprintf("като I-нотч %.1f мм%s – както останалите във файла", slit/tr.scale/10, where)
	if useT {
		info.Form = fmt.Sprintf("като T-нотч %.1f × %.1f мм%s – както останалите във файла", slit/tr.scale/10, bar/tr.scale/10, where)
	}

	tol := 10 * tr.scale // 1 mm: a notch this close is the same notch
	segTol := 15 * tr.scale
	var adds []hpgInsert
	for _, p := range d.Pieces {
		for _, mn := range p.Notches {
			ax, ay := tr.apply(float64(mn[0]), float64(mn[1]))
			bx, by := tr.apply(float64(mn[2]), float64(mn[3]))
			dx, dy := bx-ax, by-ay
			l := math.Hypot(dx, dy)
			// the same notch: at the same place and into the same piece (two pieces that
			// touch can have notches 1 mm apart, pointing in opposite directions)
			same := func(e, i [2]int) bool {
				if math.Abs(float64(e[0])-ax) > tol || math.Abs(float64(e[1])-ay) > tol {
					return false
				}
				ex, ey := float64(i[0]-e[0]), float64(i[1]-e[1])
				el := math.Hypot(ex, ey)
				return l == 0 || el == 0 || (ex*dx+ey*dy)/(el*l) > 0.3
			}
			exists := false
			for _, n := range mine {
				if same(n.e, n.i) {
					exists = true
					break
				}
			}
			for _, a := range adds {
				if same(a.edge, a.inner) {
					exists = true
				}
			}
			if exists {
				continue
			}
			if sepForm {
				if l == 0 {
					info.Unplaced++
					continue
				}
				// drawn like its neighbours: after the nearest notch of the file, with the same lead-in
				tmpl, td := -1, math.Inf(1)
				for j, n := range mine {
					if dd := math.Hypot(float64(n.e[0])-ax, float64(n.e[1])-ay); dd < td {
						tmpl, td = j, dd
					}
				}
				tn := mine[tmpl]
				lead := 0
				for k := tn.idx[0] - 1; k >= 0 && !st[k].down && st[k].pen == tn.pen && st[k].x == tn.e[0] && st[k].y == tn.e[1] && lead < 3; k-- {
					lead++
				}
				ins := hpgInsert{afterStep: tn.idx[len(tn.idx)-1], t: useT, sep: true, lead: max(lead, 1)}
				ux, uy := dx/l, dy/l
				r := func(x, y float64) [2]int { return [2]int{int(math.Round(x)), int(math.Round(y))} }
				ex, ey := ax, ay
				ix, iy := ex+ux*slit, ey+uy*slit
				ins.edge, ins.inner = r(ex, ey), r(ix, iy)
				ins.c1 = r(ix+uy*bar/2, iy-ux*bar/2)
				ins.c2 = r(ix-uy*bar/2, iy+ux*bar/2)
				adds = append(adds, ins)
				info.Restored++
				info.ByPiece[p.Name]++
				x, y := tr.back(ins.edge[0], ins.edge[1])
				info.Coords = append(info.Coords, fmt.Sprintf("%s: X%dY%d", p.Name, x, y))
				continue
			}
			// nearest cut segment (not part of a notch)
			bestK, bestD, bestT := -1, segTol, 0.0
			for k := 1; k < len(st); k++ {
				if !st[k].down || st[k].pen != pen || st[k-1].pen != pen || notchStep[k] {
					continue
				}
				px, py := float64(st[k-1].x), float64(st[k-1].y)
				qx, qy := float64(st[k].x), float64(st[k].y)
				dx, dy := qx-px, qy-py
				l2 := dx*dx + dy*dy
				t := 0.0
				if l2 > 0 {
					t = math.Max(0, math.Min(1, ((ax-px)*dx+(ay-py)*dy)/l2))
				}
				dd := math.Hypot(px+t*dx-ax, py+t*dy-ay)
				if dd < bestD {
					bestK, bestD, bestT = k, dd, t
				}
			}
			if bestK < 0 || l == 0 {
				info.Unplaced++
				continue
			}
			P, Q := st[bestK-1], st[bestK]
			ex := float64(P.x) + bestT*float64(Q.x-P.x)
			ey := float64(P.y) + bestT*float64(Q.y-P.y)
			ins := hpgInsert{afterStep: bestK - 1, t: useT}
			snap := 5 * tr.scale // 0.5 mm: use the corner itself
			switch {
			case math.Hypot(ex-float64(P.x), ey-float64(P.y)) <= snap:
				ex, ey = float64(P.x), float64(P.y)
			case math.Hypot(ex-float64(Q.x), ey-float64(Q.y)) <= snap:
				ex, ey = float64(Q.x), float64(Q.y)
				ins.afterStep = bestK
			}
			ux, uy := dx/l, dy/l
			ix, iy := ex+ux*slit, ey+uy*slit
			r := func(x, y float64) [2]int { return [2]int{int(math.Round(x)), int(math.Round(y))} }
			ins.edge, ins.inner = r(ex, ey), r(ix, iy)
			ins.c1 = r(ix+uy*bar/2, iy-ux*bar/2)
			ins.c2 = r(ix-uy*bar/2, iy+ux*bar/2)
			adds = append(adds, ins)
			info.Restored++
			info.ByPiece[p.Name]++
			x, y := tr.back(ins.edge[0], ins.edge[1])
			info.Coords = append(info.Coords, fmt.Sprintf("%s: X%dY%d", p.Name, x, y))
		}
	}
	chk.Found = chk.Expected - info.Restored - info.Unplaced
	if len(adds) == 0 {
		return raw, info, chk
	}
	return f.withInserts(st, adds), info, chk
}

// withInserts writes the file again; only the commands that get a notch are changed.
func (f *hpgFile) withInserts(st []hpgStep, adds []hpgInsert) string {
	byStep := map[int][]hpgInsert{}
	for _, a := range adds {
		byStep[a.afterStep] = append(byStep[a.afterStep], a)
	}
	split := map[int]bool{} // commands that are written one point per command
	for k := range byStep {
		split[st[k].ci] = true
	}
	stepOf := map[[2]int]int{}
	for k, s := range st {
		stepOf[[2]int{s.ci, s.pi}] = k
	}
	var b strings.Builder
	emit := func(s string) { b.WriteString(f.sep + s + ";") }
	xy := func(p [2]int) string { return strconv.Itoa(p[0]) + "," + strconv.Itoa(p[1]) }
	for ci, c := range f.cmds {
		if !split[ci] {
			b.WriteString(c.raw + ";") // unchanged, byte for byte
			continue
		}
		lead := c.raw[:len(c.raw)-len(strings.TrimLeft(c.raw, " \t\r\n"))]
		for pi, p := range c.pts {
			if pi == 0 {
				b.WriteString(lead + c.op + xy(p) + ";")
			} else {
				emit(c.op + xy(p))
			}
			for _, a := range byStep[stepOf[[2]int{ci, pi}]] {
				if a.sep {
					for j := 0; j < a.lead; j++ {
						emit("PU" + xy(a.edge))
					}
					emit("PD" + xy(a.inner))
					if a.t {
						emit("PU" + xy(a.c1))
						emit("PD" + xy(a.c2))
					}
					continue
				}
				back := p // where the contour was
				if a.edge != p {
					emit("PD" + xy(a.edge))
					back = a.edge
				}
				emit("PD" + xy(a.inner))
				if a.t {
					emit("PU" + xy(a.c1))
					emit("PD" + xy(a.c2))
				}
				emit("PU" + xy(back))
			}
		}
	}
	return b.String() + f.tail
}

// ---------------- preview ----------------

// hpgSim shows an HP-GL file in the viewer: the cut pen (the one with the most notches)
// as cuts, its notches green, the other pens (text, drills, inner lines) grey.
func hpgSim(raw string) *SimResult {
	f := parseHPG(raw)
	st := f.steps()
	ns := hpgNotches(st)
	cut, notchPen := hpgPens(st, ns)
	notchStep := map[int]bool{}
	res := &SimResult{MinX: 1 << 30, MinY: 1 << 30, MaxX: -(1 << 30), MaxY: -(1 << 30), Header: "HP-GL"}
	var cur *SimPiece
	notchAt := map[int]hpgNotch{}
	for _, n := range ns {
		if n.pen == notchPen {
			for _, k := range n.idx {
				notchStep[k] = true
			}
			notchAt[n.idx[0]] = n
		}
	}
	for k := 1; k < len(st); k++ {
		a, s := st[k-1], st[k]
		// Optitex writes each piece as one run of the cut pen (cut line and seam line);
		// text and drills of other pens go with the piece before them
		isMain := func(pen string) bool { return pen == cut || pen == notchPen }
		if cur == nil || (isMain(s.pen) && !isMain(a.pen)) {
			name := ""
			if isMain(s.pen) {
				name = strconv.Itoa(len(res.Pieces) + 1)
				if len(res.Pieces) > 0 && res.Pieces[0].Name == "" {
					name = strconv.Itoa(len(res.Pieces))
				}
			}
			res.Pieces = append(res.Pieces, SimPiece{Name: name})
			cur = &res.Pieces[len(res.Pieces)-1]
		}
		if !s.down {
			continue
		}
		kind := "u"
		if s.pen == cut {
			kind = "c"
		}
		if notchStep[k] {
			kind = "n"
		}
		cur.Moves = append(cur.Moves, Move{a.x, a.y, s.x, s.y, kind})
		if n, ok := notchAt[k]; ok {
			cur.Notches = append(cur.Notches, [4]int{n.e[0], n.e[1], n.i[0], n.i[1]})
			res.Notches++
		}
		for _, p := range [][2]int{{a.x, a.y}, {s.x, s.y}} {
			res.MinX, res.MinY = min(res.MinX, p[0]), min(res.MinY, p[1])
			res.MaxX, res.MaxY = max(res.MaxX, p[0]), max(res.MaxY, p[1])
		}
	}
	return res
}

// hpgBoxes: outlines drawn by the cut pen in 0.1 mm (assuming 1/40 mm units). Besides the
// cut lines they include the seam lines, so they are compared with hpgCoverage.
func hpgBoxes(raw string) []pieceBox {
	f := parseHPG(raw)
	st := f.steps()
	ns := hpgNotches(st)
	notchStep := map[int]bool{}
	for _, n := range ns {
		for _, k := range n.idx {
			notchStep[k] = true
		}
	}
	cut, _ := hpgPens(st, ns)
	if cut == "" {
		return nil
	}
	var boxes []pieceBox
	var cur *pieceBox
	var start [2]int
	for k, s := range st {
		if s.pen != cut || notchStep[k] {
			continue
		}
		if !s.down {
			if cur != nil && [2]int{s.x, s.y} == start {
				continue
			}
			if cur != nil {
				boxes = append(boxes, *cur)
			}
			x, y := s.x/4, s.y/4
			cur, start = &pieceBox{x, y, x, y}, [2]int{s.x, s.y}
			continue
		}
		if cur != nil {
			x, y := s.x/4, s.y/4
			cur.minX, cur.minY = min(cur.minX, x), min(cur.minY, y)
			cur.maxX, cur.maxY = max(cur.maxX, x), max(cur.maxY, y)
		}
	}
	if cur != nil {
		boxes = append(boxes, *cur)
	}
	var out []pieceBox
	for _, b := range boxes {
		if b.w() >= 20 || b.h() >= 20 { // under 2 mm: not an outline
			out = append(out, b)
		}
	}
	return out
}

// hpgCoverage: share of the marker's pieces that have an outline at the same place in the
// HPG file (extra outlines – seam lines – do not count against it).
func hpgCoverage(g, m []pieceBox) float64 {
	if len(m) == 0 {
		return 0
	}
	near := func(a, b int) bool { return a-b <= boxTol && b-a <= boxTol }
	used := make([]bool, len(g))
	n := 0
	for _, b := range m {
		for j, a := range g {
			if !used[j] && near(a.minX, b.minX) && near(a.minY, b.minY) && near(a.maxX, b.maxX) && near(a.maxY, b.maxY) {
				used[j] = true
				n++
				break
			}
		}
	}
	return float64(n) / float64(len(m))
}
