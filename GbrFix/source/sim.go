package main

// Simulation of how ViewCut (ModIso2Struct.iso2struct) interprets an ISO/GBR cut file.
// Reconstructed from its IL for interoperability. Key rule found there:
//   after a notch end point (M19 target), the NEXT move is executed as a CUT even when
//   the file says M15 (knife up) – unless the file returns to the notch anchor.
// Moves classified as cuts while the file had the knife up are "phantom" cuts (red).

import "strings"

type Move struct {
	X1 int    `json:"a"`
	Y1 int    `json:"b"`
	X2 int    `json:"c"`
	Y2 int    `json:"d"`
	K  string `json:"k"` // c=cut u=up(travel) n=notch recognised p=phantom cut
}

type SimPiece struct {
	Name    string   `json:"name"`
	Moves   []Move   `json:"moves"`
	Notches [][4]int `json:"notches"` // file-level notches A->B
	Drills  [][2]int `json:"drills"`
	Start   *[2]int  `json:"start"` // start point of the main contour (longest knife-down run)
}

type SimResult struct {
	Pieces  []SimPiece `json:"pieces"`
	Phantom int        `json:"phantom"`
	Notches int        `json:"notches"`
	Drills  int        `json:"drills"`
	MinX    int        `json:"minX"`
	MinY    int        `json:"minY"`
	MaxX    int        `json:"maxX"`
	MaxY    int        `json:"maxY"`
	Header  string     `json:"header"`
}

type tokInfo struct {
	hasXY bool
	x, y  int
	com   string
}

func readTok(t string) tokInfo {
	var ti tokInfo
	if strings.HasSuffix(strings.ToUpper(t), "M31") {
		ti.com = "M31"
	}
	if len(t) > 0 && (t[0] == 'X' || t[0] == 'x') {
		i := 1
		x, ok, n := parseInt(t, i)
		if ok && n < len(t) && (t[n] == 'Y' || t[n] == 'y') {
			y, ok2, n2 := parseInt(t, n+1)
			if ok2 {
				ti.hasXY, ti.x, ti.y = true, x, y
				if n2 < len(t) && ti.com == "" {
					ti.com = strings.ToUpper(t[n2:])
				}
				return ti
			}
		}
		return ti
	}
	if ti.com == "" {
		ti.com = strings.ToUpper(strings.TrimSpace(t))
	}
	return ti
}

func Simulate(raw string) *SimResult {
	toks := strings.Split(raw, "*")
	res := &SimResult{MinX: 1 << 30, MinY: 1 << 30, MaxX: -(1 << 30), MaxY: -(1 << 30)}
	var hdr []string
	var cur *SimPiece
	started := false
	pos := 0 // 1 down, 2 up
	imp := false
	type P struct{ x, y, tag int }
	var pts []P
	grow := func(x, y int) {
		if x < res.MinX {
			res.MinX = x
		}
		if y < res.MinY {
			res.MinY = y
		}
		if x > res.MaxX {
			res.MaxX = x
		}
		if y > res.MaxY {
			res.MaxY = y
		}
	}
	type run struct{ x, y, n int }
	var runs []run
	finishPiece := func() {
		if cur == nil {
			return
		}
		best := -1
		for i, r := range runs { // first knife-down run that cuts real contour
			if r.n >= 2 {
				best = i
				break
			}
		}
		if best < 0 {
			for i, r := range runs {
				if best < 0 || r.n > runs[best].n {
					best = i
				}
			}
		}
		if best >= 0 && runs[best].n > 0 {
			cur.Start = &[2]int{runs[best].x, runs[best].y}
		}
		runs = nil
	}
	add := func(cut bool, tag int, x, y int) {
		if len(pts) > 0 {
			a := pts[len(pts)-1]
			k := "u"
			if cut {
				k = "c"
				if a.tag == 1 {
					k = "n"
				}
				if pos == 2 {
					k = "p"
					res.Phantom++
				}
			}
			if k == "c" && len(runs) > 0 {
				runs[len(runs)-1].n++
			}
			if !(a.x == x && a.y == y && k == "u") {
				cur.Moves = append(cur.Moves, Move{a.x, a.y, x, y, k})
			}
		}
		pts = append(pts, P{x, y, tag})
		grow(x, y)
	}
	xy := func(x, y int) {
		if !started {
			return
		}
		switch pos {
		case 1:
			if imp {
				add(true, 2, x, y)
				imp = false
			} else {
				add(true, 0, x, y)
			}
		case 2:
			if imp {
				add(false, 2, x, y)
				imp = false
			} else if len(pts) == 0 || pts[len(pts)-1].tag == 0 {
				add(false, 0, x, y)
			} else {
				add(true, 0, x, y) // phantom: file says knife up, ViewCut cuts
			}
		}
	}
	nextXY := func(from int) (int, tokInfo) {
		for j := from; j < len(toks); j++ {
			if ti := readTok(toks[j]); ti.hasXY {
				return j, ti
			}
		}
		return -1, tokInfo{}
	}
	for v := 0; v < len(toks); v++ {
		ti := readTok(toks[v])
		if !started && !isPieceTok(toks[v]) {
			if strings.TrimSpace(toks[v]) != "" {
				hdr = append(hdr, toks[v])
			}
		}
		if strings.HasPrefix(ti.com, "N") && len(ti.com) < 7 && isPieceTok(toks[v]) {
			finishPiece()
			started = true
			res.Pieces = append(res.Pieces, SimPiece{Name: toks[v]})
			cur = &res.Pieces[len(res.Pieces)-1]
			pts = nil
			imp = false
		}
		switch ti.com {
		case "M14":
			if started {
				pos = 1
				if len(pts) > 0 {
					runs = append(runs, run{pts[len(pts)-1].x, pts[len(pts)-1].y, 0})
				}
			}
		case "M15":
			if started {
				pos = 2
			}
		case "M43", "M31", "DRILL", "DRILL2", "PUNCH":
			if started {
				x, y := 0, 0
				if ti.hasXY {
					x, y = ti.x, ti.y
				} else if len(pts) > 0 {
					x, y = pts[len(pts)-1].x, pts[len(pts)-1].y
				}
				cur.Drills = append(cur.Drills, [2]int{x, y})
				res.Drills++
				grow(x, y)
			}
		case "M19":
			if !started || len(pts) == 0 {
				break
			}
			A := pts[len(pts)-1]
			// B: first coordinate after M19 that differs from A
			bj, bi := -1, tokInfo{}
			for j := v + 1; j < len(toks); j++ {
				t := readTok(toks[j])
				if t.hasXY && !(t.x == A.x && t.y == A.y) {
					bj, bi = j, t
					break
				}
			}
			if bj < 0 {
				break
			}
			cur.Notches = append(cur.Notches, [4]int{A.x, A.y, bi.x, bi.y})
			res.Notches++
			cj, ci := nextXY(bj + 1)
			if cj < 0 {
				break
			}
			mark := false
			if ci.x != A.x || ci.y != A.y {
				mark = true
			} else if len(pts) >= 2 {
				Pp := pts[len(pts)-2]
				_, di := nextXY(v + 1)
				allEq := Pp.x == A.x && Pp.y == A.y && A.x == di.x && A.y == di.y
				if (Pp.x != di.x || Pp.y != di.y) || allEq {
					// ViewCut: token after M19 is read as an ordinary point
					if v+1 < len(toks) {
						v++
						if di.hasXY {
							xy(di.x, di.y)
						}
					}
					continue
				}
				mark = true
			} else {
				// first point of the piece: ViewCut processes C as a point here
				xy(ci.x, ci.y)
				continue
			}
			if mark {
				pts[len(pts)-1].tag = 1
				if v+1 < len(toks) {
					v++
					imp = true
					n := readTok(toks[v])
					if n.hasXY {
						xy(n.x, n.y)
					}
				}
				continue
			}
		}
		if ti.hasXY && ti.com != "M19" {
			xy(ti.x, ti.y)
		}
	}
	finishPiece()
	res.Header = strings.Join(hdr, "*")
	if res.MinX > res.MaxX {
		res.MinX, res.MinY, res.MaxX, res.MaxY = 0, 0, 1, 1
	}
	return res
}
