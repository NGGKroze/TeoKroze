package main

// Shape notches (V, box, U) that Optitex 26.1 writes as part of the contour
// without any notch code. They are cut out of the fabric as shapes. With the
// ShapesToI option they are rewritten as a normal notch A*M19*B*M15*A*M14 where
// A is the middle of the notch on the edge and B is its deepest point – exactly
// where Optitex puts an I notch.

import (
	"fmt"
	"math"
)

const (
	shapeMinW     = 20.0 // 2 mm   width of the notch on the edge
	shapeMaxW     = 100  // 10 mm
	shapeMinDepth = 15.0 // 1.5 mm
	shapeMaxDepth = 80.0 // 8 mm
	shapeMaxTurn  = 25.0 // degrees: the edge must continue straight on both sides
)

type fpt struct{ x, y float64 }

func tokPt(t string) (fpt, bool) {
	x, y, ok := parseCoord(t)
	return fpt{float64(x), float64(y)}, ok
}
func sub(a, b fpt) fpt      { return fpt{a.x - b.x, a.y - b.y} }
func dot(a, b fpt) float64  { return a.x*b.x + a.y*b.y }
func norm(a fpt) float64    { return math.Hypot(a.x, a.y) }
func coordTok(p fpt) string { return fmt.Sprintf("X%dY%d", int(math.Round(p.x)), int(math.Round(p.y))) }
func angleDeg(a, b fpt) float64 { // angle between two direction vectors
	na, nb := norm(a), norm(b)
	if na == 0 || nb == 0 {
		return 180
	}
	c := dot(a, b) / (na * nb)
	if c > 1 {
		c = 1
	}
	if c < -1 {
		c = -1
	}
	return math.Acos(c) * 180 / math.Pi
}

// polygon of the piece outline (M19 targets excluded)
func contourPolygon(c []string, skip map[int]bool) []fpt {
	var poly []fpt
	for i, t := range c {
		if skip[i] || (i > 0 && c[i-1] == "M19") {
			continue
		}
		if p, ok := tokPt(t); ok {
			poly = append(poly, p)
		}
	}
	return poly
}

func pointInPoly(p fpt, poly []fpt) bool {
	in := false
	for i, j := 0, len(poly)-1; i < len(poly); j, i = i, i+1 {
		a, b := poly[i], poly[j]
		if (a.y > p.y) != (b.y > p.y) && p.x < (b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x {
			in = !in
		}
	}
	return in
}

type shapeHit struct {
	start, end int // token range [start,end) to replace
	a, b       fpt
	e2         fpt // broken U: where the U should end on the edge
	kind       string
}

// dentAt checks E1=c[s], inner c[s+1..s+k], E2=c[s+k+1]
func dentAt(c []string, s, k int) (shapeHit, bool) {
	var h shapeHit
	if s+k+1 >= len(c) {
		return h, false
	}
	e1, ok1 := tokPt(c[s])
	e2, ok2 := tokPt(c[s+k+1])
	if !ok1 || !ok2 {
		return h, false
	}
	inner := make([]fpt, k)
	for j := 0; j < k; j++ {
		p, ok := tokPt(c[s+1+j])
		if !ok {
			return h, false
		}
		inner[j] = p
	}
	edge := sub(e2, e1)
	w := norm(edge)
	if w < shapeMinW || w > shapeMaxW {
		return h, false
	}
	u := fpt{edge.x / w, edge.y / w}
	n := fpt{-u.y, u.x}
	maxD, side := 0.0, 0.0
	for _, p := range inner {
		v := sub(p, e1)
		t := dot(v, u)
		d := dot(v, n)
		if t < -0.15*w || t > 1.15*w || math.Abs(d) > shapeMaxDepth {
			return h, false
		}
		if side == 0 && math.Abs(d) > 1 {
			side = math.Copysign(1, d)
		}
		if side != 0 && d*side < -3 { // all inner points on the same side
			return h, false
		}
		if math.Abs(d) > maxD {
			maxD = math.Abs(d)
		}
	}
	if maxD < shapeMinDepth || side == 0 {
		return h, false
	}
	// the edge must continue straight on both sides of the notch
	if s > 0 {
		if pv, ok := tokPt(c[s-1]); ok && angleDeg(sub(e1, pv), edge) > shapeMaxTurn {
			return h, false
		}
	}
	if s+k+2 < len(c) {
		if nx, ok := tokPt(c[s+k+2]); ok && angleDeg(sub(nx, e2), edge) > shapeMaxTurn {
			return h, false
		}
	}
	mid := fpt{(e1.x + e2.x) / 2, (e1.y + e2.y) / 2}
	b := fpt{mid.x + n.x*side*maxD, mid.y + n.y*side*maxD}
	if k == 1 {
		b = inner[0] // V: Optitex's own I notch ends at the apex
	}
	kind := map[int]string{1: "V", 2: "box"}[k]
	if kind == "" {
		kind = "U"
	}
	return shapeHit{start: s, end: s + k + 2, a: mid, b: b, kind: kind}, true
}

// brokenUAt: Optitex 26.1 U notch that does not return to the edge:
// E1*M15*Q*E1*M14*u1*..*uk  (uk ends ~1.5 mm inside, contour then goes on to the next corner)
func brokenUAt(c []string, s int) (shapeHit, bool) {
	var h shapeHit
	if s < 1 || s+6 >= len(c) || c[s+1] != "M15" || c[s+3] != c[s] || c[s+4] != "M14" {
		return h, false
	}
	e1, ok := tokPt(c[s])
	pv, ok2 := tokPt(c[s-1])
	q, ok3 := tokPt(c[s+2])
	if !ok || !ok2 || !ok3 || norm(sub(q, e1)) > 30 {
		return h, false
	}
	dir := sub(e1, pv)
	if norm(dir) == 0 {
		return h, false
	}
	u := fpt{dir.x / norm(dir), dir.y / norm(dir)}
	n := fpt{-u.y, u.x}
	var inner []fpt
	j := s + 5
	for ; j < len(c) && len(inner) < 6; j++ {
		p, ok := tokPt(c[j])
		if !ok {
			break
		}
		if norm(sub(p, e1)) > shapeMaxW+20 {
			break
		}
		inner = append(inner, p)
	}
	if len(inner) < 2 {
		return h, false
	}
	maxD, side := 0.0, 0.0
	for _, p := range inner {
		d := dot(sub(p, e1), n)
		if side == 0 && math.Abs(d) > 1 {
			side = math.Copysign(1, d)
		}
		if math.Abs(d) > maxD {
			maxD = math.Abs(d)
		}
	}
	last := inner[len(inner)-1]
	w := dot(sub(last, e1), u)
	if maxD < shapeMinDepth || maxD > shapeMaxDepth || w < shapeMinW || w > shapeMaxW || math.Abs(dot(sub(last, e1), n)) > 25 {
		return h, false
	}
	mid := fpt{e1.x + u.x*w/2, e1.y + u.y*w/2}
	b := fpt{mid.x + n.x*side*maxD, mid.y + n.y*side*maxD}
	e2 := fpt{e1.x + u.x*w, e1.y + u.y*w}
	return shapeHit{start: s, end: s + 5 + len(inner), a: mid, b: b, e2: e2, kind: "U"}, true
}

// ShapeSel says which shape notches become I notches.
type ShapeSel struct {
	V, Box, U    bool
	CloseBrokenU bool // keep the U shape but finish it on the edge (26.1 bug)
	CountOnly    bool // only count, do not change anything
}

func (s ShapeSel) any() bool { return s.V || s.Box || s.U || s.CloseBrokenU || s.CountOnly }

func (s ShapeSel) wants(kind string) bool {
	if s.CountOnly {
		return true
	}
	switch kind {
	case "V":
		return s.V
	case "box":
		return s.Box
	}
	return s.U
}

// repairShapeNotches rewrites the selected V / box / U notches as I notches with M19.
func repairShapeNotches(c []string, sel ShapeSel) ([]string, map[string]int) {
	counts := map[string]int{}
	var out []string
	for i := 0; i < len(c); {
		if h, ok := brokenUAt(c, i); ok && insideCheck(c, h) {
			switch {
			case sel.U || sel.CountOnly:
				out = append(out, coordTok(h.a), "M19", coordTok(h.b), "M15", coordTok(h.a), "M14")
				counts[h.kind]++
			case sel.CloseBrokenU:
				// keep the U, add the missing end point on the edge
				out = append(out, c[i:h.end]...)
				out = append(out, coordTok(h.e2))
				counts["U затворен"]++
			default:
				out = append(out, c[i:h.end]...)
			}
			i = h.end
			continue
		}
		matched := false
		for k := 1; k <= 5 && !matched; k++ {
			if h, ok := dentAt(c, i, k); ok && sel.wants(h.kind) && insideCheck(c, h) {
				// keep E1 so the contour is unchanged up to the notch
				out = append(out, c[i], coordTok(h.a), "M19", coordTok(h.b), "M15", coordTok(h.a), "M14")
				counts[h.kind]++
				i = h.end - 1 // E2 is emitted as a normal contour point
				matched = true
			}
		}
		if matched {
			continue
		}
		out = append(out, c[i])
		i++
	}
	return out, counts
}

// insideCheck: the notch must go INTO the piece (not a bump outwards).
func insideCheck(c []string, h shapeHit) bool {
	skip := map[int]bool{}
	for i := h.start + 1; i < h.end-1; i++ {
		skip[i] = true
	}
	poly := contourPolygon(c, skip)
	if len(poly) < 3 {
		return false
	}
	// test a point slightly inside from the edge towards B
	v := sub(h.b, h.a)
	l := norm(v)
	if l == 0 {
		return false
	}
	p := fpt{h.a.x + v.x/l*math.Min(10, l/2), h.a.y + v.y/l*math.Min(10, l/2)}
	return pointInPoly(p, poly)
}
