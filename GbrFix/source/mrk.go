package main

// Optitex .MRK and .PDS files carry a small drawing (SVG) of the marker / pattern
// in plain text: every piece outline and every notch as a line A -> B, in 0.1 mm.
// This file reads that drawing so that
//   - the files can be shown in the viewer with their coordinates, and
//   - notches that Optitex dropped from the GBR can be put back (as I notches).

import (
	"fmt"
	"math"
	"regexp"
	"strconv"
	"strings"
)

type svgPiece struct {
	Name    string
	Poly    [][2]int
	Seam    [][2]int
	Notches [][4]int // ax, ay, bx, by
	Drills  [][2]int
}

type svgDrawing struct {
	Kind   string // "MRK" or "PDS"
	W, H   int
	Pieces []svgPiece
}

var (
	reSVG      = regexp.MustCompile(`(?s)<svg.*?</svg>`)
	reViewBox  = regexp.MustCompile(`viewBox="\s*[-\d.]+\s+[-\d.]+\s+([\d.]+)\s+([\d.]+)"`)
	rePolygon  = regexp.MustCompile(`<polygon[^>]*?points="([^"]*)"[^>]*>`)
	reComment  = regexp.MustCompile(`comment="([^"]*)"`)
	rePathD    = regexp.MustCompile(`<path d="([^"]*)"`)
	rePair     = regexp.MustCompile(`(-?[\d.]+),(-?[\d.]+)`)
	reXMLPiece = regexp.MustCompile(`(?s)<PIECE>\s*<NAME>(.*?)</NAME>`)
)

func pairs(s string) [][2]float64 {
	var out [][2]float64
	for _, m := range rePair.FindAllStringSubmatch(s, -1) {
		x, _ := strconv.ParseFloat(m[1], 64)
		y, _ := strconv.ParseFloat(m[2], 64)
		out = append(out, [2]float64{x, y})
	}
	return out
}

// parseDrawing reads the SVG inside MRK/PDS content. Coordinates are converted so
// that an MRK drawing lines up with the GBR file of the same marker.
func parseDrawing(content string) *svgDrawing {
	svg := reSVG.FindString(content)
	if svg == "" {
		return nil
	}
	d := &svgDrawing{Kind: "PDS"}
	if m, st := strings.Index(content, "<MARKER>"), strings.Index(content, "<STYLE>"); m >= 0 && (st < 0 || m < st) {
		d.Kind = "MRK" // a marker file starts with <MARKER>; a pattern file with <STYLE>
	}
	if vb := reViewBox.FindStringSubmatch(svg); vb != nil {
		w, _ := strconv.ParseFloat(vb[1], 64)
		h, _ := strconv.ParseFloat(vb[2], 64)
		d.W, d.H = int(w), int(h)
	}
	conv := func(p [2]float64) [2]int { // SVG has y downwards and starts at 1
		return [2]int{int(math.Round(p[0])) - 1, d.H - 1 - int(math.Round(p[1]))}
	}
	// names for PDS pieces come from the XML piece list (same order)
	var names []string
	for _, m := range reXMLPiece.FindAllStringSubmatch(content, -1) {
		names = append(names, m[1])
	}
	locs := rePolygon.FindAllStringSubmatchIndex(svg, -1)
	pi := 0
	for k, loc := range locs {
		tag := svg[loc[0]:loc[1]]
		pts := pairs(svg[loc[2]:loc[3]])
		// the page background is the first polygon in a PDS drawing
		if d.Kind == "PDS" && k == 0 && len(pts) == 4 {
			continue
		}
		p := svgPiece{}
		if c := reComment.FindStringSubmatch(tag); c != nil {
			p.Name = c[1]
		} else if pi < len(names) {
			p.Name = names[pi]
		}
		pi++
		for _, q := range pts {
			p.Poly = append(p.Poly, conv(q))
		}
		end := len(svg)
		if k+1 < len(locs) {
			end = locs[k+1][0]
		}
		for _, pm := range rePathD.FindAllStringSubmatch(svg[loc[1]:end], -1) {
			dstr := pm[1]
			q := pairs(dstr)
			switch {
			case strings.Contains(dstr, "Z") && len(q) > 2:
				for _, v := range q {
					p.Seam = append(p.Seam, conv(v))
				}
			case strings.Count(dstr, "M") == 2 && len(q) == 4: // small cross = drill hole
				a, b := conv(q[0]), conv(q[1])
				p.Drills = append(p.Drills, [2]int{(a[0] + b[0]) / 2, (a[1] + b[1]) / 2})
			case len(q) == 2:
				a, b := conv(q[0]), conv(q[1])
				p.Notches = append(p.Notches, [4]int{a[0], a[1], b[0], b[1]})
			}
		}
		d.Pieces = append(d.Pieces, p)
	}
	if len(d.Pieces) == 0 {
		return nil
	}
	return d
}

// toSim turns the drawing into the structure the viewer shows.
func (d *svgDrawing) toSim() *SimResult {
	res := &SimResult{MinX: 1 << 30, MinY: 1 << 30, MaxX: -(1 << 30), MaxY: -(1 << 30)}
	grow := func(x, y int) {
		res.MinX, res.MinY = min(res.MinX, x), min(res.MinY, y)
		res.MaxX, res.MaxY = max(res.MaxX, x), max(res.MaxY, y)
	}
	cnt := map[string]int{}
	for _, p := range d.Pieces {
		cnt[p.Name]++
		sp := SimPiece{Name: p.Name}
		for i := range p.Poly {
			a, b := p.Poly[i], p.Poly[(i+1)%len(p.Poly)]
			sp.Moves = append(sp.Moves, Move{a[0], a[1], b[0], b[1], "c"})
			grow(a[0], a[1])
		}
		for i := 0; i+1 < len(p.Seam); i++ {
			a, b := p.Seam[i], p.Seam[i+1]
			sp.Moves = append(sp.Moves, Move{a[0], a[1], b[0], b[1], "u"})
		}
		sp.Notches = p.Notches
		sp.Drills = p.Drills
		res.Notches += len(p.Notches)
		res.Drills += len(p.Drills)
		res.Pieces = append(res.Pieces, sp)
	}
	return res
}

// coordReport lists every notch with its coordinates.
func (d *svgDrawing) coordReport(name string) string {
	var b strings.Builder
	what := "маркировка (MRK) – координатите са същите като в GBR файла"
	if d.Kind == "PDS" {
		what = "модел (PDS) – координати в чертежа на модела, не в маркировката"
	}
	fmt.Fprintf(&b, "Файл: %s – %s\nЕдиници: 0,1 мм. A = точка на ръба, B = край на нотча.\n", name, what)
	seen := map[string]int{}
	for _, p := range d.Pieces {
		seen[p.Name]++
		fmt.Fprintf(&b, "\n%s (№%d) – %d нотча\n", p.Name, seen[p.Name], len(p.Notches))
		for i, n := range p.Notches {
			l := math.Hypot(float64(n[2]-n[0]), float64(n[3]-n[1])) / 10
			fmt.Fprintf(&b, "  %2d.  A X%dY%d  ->  B X%dY%d   (%.1f мм)\n", i+1, n[0], n[1], n[2], n[3], l)
		}
		for _, h := range p.Drills {
			fmt.Fprintf(&b, "  пробиване  X%dY%d\n", h[0], h[1])
		}
	}
	return b.String()
}

func loadDrawing(path string) *svgDrawing {
	b, err := readShared(path)
	if err != nil {
		return nil
	}
	return parseDrawing(string(b))
}

// ---------------- restoring notches that are missing from the GBR ----------------

type RestoreInfo struct {
	Restored   int            `json:"restored"`
	ByPiece    map[string]int `json:"byPiece"`
	Unplaced   int            `json:"unplaced"`
	Coords     []string       `json:"coords"`
	SourceName string         `json:"source"`
}

func (r *RestoreInfo) Text() string {
	if r == nil || (r.Restored == 0 && r.Unplaced == 0) {
		return ""
	}
	s := fmt.Sprintf("Възстановени %d липсващи нотча от %s (като I-нотч с M19)", r.Restored, r.SourceName)
	if len(r.ByPiece) > 0 {
		var parts []string
		for _, k := range sortedKeys(r.ByPiece) {
			parts = append(parts, fmt.Sprintf("%s: %d", k, r.ByPiece[k]))
		}
		s += " – " + strings.Join(parts, ", ")
	}
	s += "."
	if r.Unplaced > 0 {
		s += fmt.Sprintf(" %d нотча от маркировката не можаха да се поставят (не лежат на контур в GBR).", r.Unplaced)
	}
	return s
}

func sortedKeys(m map[string]int) []string {
	var k []string
	for x := range m {
		k = append(k, x)
	}
	for i := range k {
		for j := i + 1; j < len(k); j++ {
			if k[j] < k[i] {
				k[i], k[j] = k[j], k[i]
			}
		}
	}
	return k
}

// existing notch anchors of a contour: M19 anchors and centres of shape notches
func notchAnchors(c []string) []fpt {
	var out []fpt
	for i, t := range c {
		if t == "M19" && i > 0 {
			if p, ok := tokPt(c[i-1]); ok {
				out = append(out, p)
			}
		}
	}
	for i := 0; i < len(c); i++ {
		if h, ok := brokenUAt(c, i); ok && insideCheck(c, h) {
			out = append(out, h.a)
			continue
		}
		for k := 1; k <= 5; k++ {
			if h, ok := dentAt(c, i, k); ok && insideCheck(c, h) {
				out = append(out, h.a)
				break
			}
		}
	}
	return out
}

// RestoreMissing adds, as I notches, the marker notches that have no counterpart in the GBR.
func RestoreMissing(gbr string, d *svgDrawing, segTol float64) (string, *RestoreInfo) {
	info := &RestoreInfo{ByPiece: map[string]int{}}
	if d == nil || d.Kind != "MRK" {
		return gbr, info
	}
	trailing := strings.HasSuffix(gbr, "*")
	toks := strings.Split(gbr, "*")
	if trailing && toks[len(toks)-1] == "" {
		toks = toks[:len(toks)-1]
	}
	var starts []int
	for i, t := range toks {
		if isPieceTok(t) {
			starts = append(starts, i)
		}
	}
	if len(starts) == 0 {
		return gbr, info
	}
	type gpiece struct {
		front, contour []string
		sk             []skEntry
		anchors        []fpt
		add            []notch
	}
	pcs := make([]*gpiece, len(starts))
	for k, st := range starts {
		end := len(toks)
		if k+1 < len(starts) {
			end = starts[k+1]
		}
		piece := toks[st:end]
		g := &gpiece{front: piece}
		if cs := findContourStart(piece); cs >= 0 {
			g.front, g.contour = piece[:cs], append([]string(nil), piece[cs:]...)
			g.sk, _ = skeletonFromContour(g.contour)
			g.anchors = notchAnchors(g.contour)
		}
		pcs[k] = g
	}
	const present = 20.0 // 2 mm: a GBR notch this close counts as the same notch
	for _, sp := range d.Pieces {
		for _, n := range sp.Notches {
			a := fpt{float64(n[0]), float64(n[1])}
			b := fpt{float64(n[2]), float64(n[3])}
			// already in the GBR (as a notch or as a V / box / U shape)?
			exists := false
			for _, g := range pcs {
				for _, e := range g.anchors {
					if norm(sub(e, a)) <= present {
						exists = true
					}
				}
			}
			if exists {
				continue
			}
			// nearest contour
			best, bestD := -1, math.Inf(1)
			var snap *skEntry
			for k, g := range pcs {
				for j := 0; j+1 < len(g.sk); j++ {
					d2, _ := segDist2T(pt{a.x, a.y}, mustPt(g.sk[j].coord), mustPt(g.sk[j+1].coord))
					if d2 < bestD {
						best, bestD = k, d2
					}
				}
			}
			if best < 0 || bestD > segTol {
				info.Unplaced++
				continue
			}
			g := pcs[best]
			// use an existing contour point when the notch sits on one (±0.3 mm)
			snapD := 3.5
			for j := range g.sk {
				if p, ok := tokPt(g.sk[j].coord); ok && norm(sub(p, a)) <= snapD {
					snapD = norm(sub(p, a))
					snap = &g.sk[j]
				}
			}
			A, B := coordTok(a), coordTok(b)
			if snap != nil {
				p, _ := tokPt(snap.coord)
				A = snap.coord
				B = coordTok(fpt{b.x + p.x - a.x, b.y + p.y - a.y})
			}
			g.add = append(g.add, notch{A: A, B: B, sourceIndex: len(g.add)})
			g.anchors = append(g.anchors, a)
			info.Restored++
			info.ByPiece[sp.Name]++
			info.Coords = append(info.Coords, fmt.Sprintf("%s: A %s -> B %s", sp.Name, A, B))
		}
	}
	if info.Restored == 0 {
		return gbr, info
	}
	out := append([]string(nil), toks[:starts[0]]...)
	for _, g := range pcs {
		out = append(out, g.front...)
		if len(g.add) == 0 {
			out = append(out, g.contour...)
			continue
		}
		var dummy PieceSummary
		pe, se := mapNotches(g.add, g.sk, g.contour, segTol, &dummy)
		out = append(out, rebuildContour(g.contour, pe, se)...)
	}
	res := strings.Join(out, "*")
	if trailing {
		res += "*"
	}
	return res, info
}
