package main

// Missing-notch check: compares the notches in the GBR with what the marker (.MRK)
// and the pattern (.PDS) say should be cut. Optitex 26.1 sometimes drops notches
// from the cut file although they are marked "cut" in the PDS.

import (
	"fmt"
	"math"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
)

type mrkPiece struct {
	name       string
	sx, sy     float64 // mm
	nested     int
	angles     []float64
	perPieceNC int // cut notches per piece (from PDS), -1 unknown
}

type NotchCheck struct {
	Source   string   `json:"source"`
	Expected int      `json:"expected"`
	Found    int      `json:"found"`
	Missing  int      `json:"missing"`
	Lines    []string `json:"lines"`
}

var (
	reXML      = regexp.MustCompile(`(?s)<\?xml.*?(</MARKER>|</STYLE>)`)
	reMrkCut   = regexp.MustCompile(`(?s)<NOTCHES>\s*<CUT>\s*<QUANTITY>(\d+)</QUANTITY>`)
	rePiece    = regexp.MustCompile(`(?s)<PIECE>(.*?)</PIECE>`)
	reName     = regexp.MustCompile(`<NAME>(.*?)</NAME>`)
	reGeom     = regexp.MustCompile(`SIZE_X="([\d.]+)" SIZE_Y="([\d.]+)"`)
	reNested   = regexp.MustCompile(`<ORDER_INFO NESTED="(\d+)"`)
	reAngle    = regexp.MustCompile(`ANGLE="([-\d.]+)"`)
	reStyleFn  = regexp.MustCompile(`(?s)<STYLE>.*?<FILENAME>(.*?)</FILENAME>`)
	reNotchBlk = regexp.MustCompile(`(?s)<NOTCH>(.*?)</NOTCH>`)
	reCutCount = regexp.MustCompile(`(?s)<CUT>\s*<COUNT>(\d+)</COUNT>`)
)

func findSibling(p, ext string) string {
	dir := filepath.Dir(p)
	base := strings.TrimSuffix(filepath.Base(p), filepath.Ext(p))
	ents, err := os.ReadDir(dir)
	if err != nil {
		return ""
	}
	for _, e := range ents {
		n := e.Name()
		if !e.IsDir() && strings.EqualFold(n, base+ext) {
			return filepath.Join(dir, n)
		}
	}
	return ""
}

func readXMLHead(p string) string {
	b, err := os.ReadFile(p)
	if err != nil {
		return ""
	}
	s := string(b) // latin1 bytes; XML tags are ASCII
	return reXML.FindString(s)
}

// pdsNotchCounts: piece name -> number of cut notches per piece
func pdsNotchCounts(p string) map[string]int {
	x := readXMLHead(p)
	if x == "" {
		return nil
	}
	out := map[string]int{}
	for _, m := range rePiece.FindAllStringSubmatch(x, -1) {
		body := m[1]
		nm := reName.FindStringSubmatch(body)
		if nm == nil {
			continue
		}
		cnt := 0
		if nb := reNotchBlk.FindStringSubmatch(body); nb != nil {
			for _, c := range reCutCount.FindAllStringSubmatch(nb[1], -1) {
				v, _ := strconv.Atoi(c[1])
				cnt += v
			}
		}
		out[nm[1]] = cnt
	}
	return out
}

// gbrPieceNotches: per GBR piece: bbox size in mm and number of notches (M19 + shape notches)
type gbrPieceInfo struct {
	name    string
	w, h    float64
	notches int
}

func gbrPieces(raw string) []gbrPieceInfo {
	toks := strings.Split(raw, "*")
	var out []gbrPieceInfo
	var cur *gbrPieceInfo
	var body []string
	flush := func() {
		if cur == nil {
			return
		}
		minX, minY, maxX, maxY := math.Inf(1), math.Inf(1), math.Inf(-1), math.Inf(-1)
		for i, t := range body {
			if i > 0 && body[i-1] == "M19" {
				cur.notches++
				continue
			}
			if x, y, ok := parseCoord(t); ok {
				minX, minY = math.Min(minX, float64(x)), math.Min(minY, float64(y))
				maxX, maxY = math.Max(maxX, float64(x)), math.Max(maxY, float64(y))
			}
		}
		_, kinds := repairShapeNotches(body, ShapeSel{CountOnly: true})
		for _, v := range kinds {
			cur.notches += v
		}
		cur.w, cur.h = (maxX-minX)/10, (maxY-minY)/10
		out = append(out, *cur)
	}
	for _, t := range toks {
		if isPieceTok(t) {
			flush()
			cur = &gbrPieceInfo{name: t}
			body = nil
			continue
		}
		if cur != nil {
			body = append(body, t)
		}
	}
	flush()
	return out
}

// CheckMissingNotches looks for NAME.MRK (and the PDS it refers to) next to the GBR.
func CheckMissingNotches(gbrPath, gbrContent string) *NotchCheck {
	mrk := findSibling(gbrPath, ".mrk")
	if mrk == "" {
		return nil
	}
	x := readXMLHead(mrk)
	if x == "" {
		return nil
	}
	nc := &NotchCheck{Source: filepath.Base(mrk)}
	var pieces []mrkPiece
	for _, m := range rePiece.FindAllStringSubmatch(x, -1) {
		body := m[1]
		nm, g := reName.FindStringSubmatch(body), reGeom.FindStringSubmatch(body)
		if nm == nil || g == nil {
			continue
		}
		mp := mrkPiece{name: nm[1], perPieceNC: -1}
		mp.sx, _ = strconv.ParseFloat(g[1], 64)
		mp.sy, _ = strconv.ParseFloat(g[2], 64)
		if n := reNested.FindStringSubmatch(body); n != nil {
			mp.nested, _ = strconv.Atoi(n[1])
		}
		for _, a := range reAngle.FindAllStringSubmatch(body, -1) {
			v, _ := strconv.ParseFloat(a[1], 64)
			mp.angles = append(mp.angles, v)
		}
		pieces = append(pieces, mp)
	}
	// PDS: next to the GBR, or the path written in the marker
	pds := findSibling(gbrPath, ".pds")
	if pds == "" {
		if m := reStyleFn.FindStringSubmatch(x); m != nil {
			if _, err := os.Stat(m[1]); err == nil {
				pds = m[1]
			}
		}
	}
	var perName map[string]int
	if pds != "" {
		perName = pdsNotchCounts(pds)
		for i := range pieces {
			if v, ok := perName[pieces[i].name]; ok {
				pieces[i].perPieceNC = v
			}
		}
	}
	gp := gbrPieces(gbrContent)
	for _, p := range gp {
		nc.Found += p.notches
	}
	// expected total
	if perName != nil {
		for _, p := range pieces {
			if p.perPieceNC >= 0 {
				nc.Expected += p.perPieceNC * p.nested
			}
		}
		nc.Source += " + " + filepath.Base(pds)
	} else if m := reMrkCut.FindStringSubmatch(x); m != nil {
		nc.Expected, _ = strconv.Atoi(m[1])
	}
	if nc.Expected == 0 {
		return nil
	}
	nc.Missing = nc.Expected - nc.Found
	// per piece name (match GBR pieces to marker pieces by size)
	if perName != nil {
		type agg struct{ copies, found, min, max int }
		byName := map[string]*agg{}
		for _, g := range gp {
			for _, p := range pieces {
				if (math.Abs(g.w-p.sx) < 2 && math.Abs(g.h-p.sy) < 2) || (math.Abs(g.w-p.sy) < 2 && math.Abs(g.h-p.sx) < 2) {
					a := byName[p.name]
					if a == nil {
						a = &agg{min: 1 << 30}
						byName[p.name] = a
					}
					a.copies++
					a.found += g.notches
					if g.notches < a.min {
						a.min = g.notches
					}
					if g.notches > a.max {
						a.max = g.notches
					}
					break
				}
			}
		}
		for _, p := range pieces {
			a := byName[p.name]
			if a == nil || p.perPieceNC < 0 {
				continue
			}
			if a.min < p.perPieceNC {
				got := fmt.Sprint(a.min)
				if a.min != a.max {
					got = fmt.Sprintf("%d–%d", a.min, a.max)
				}
				nc.Lines = append(nc.Lines, fmt.Sprintf("%s: в GBR %s от %d нотча на детайл (%d бр. детайли)", p.name, got, p.perPieceNC, a.copies))
			}
		}
	}
	return nc
}

func (n *NotchCheck) Text() string {
	if n == nil {
		return ""
	}
	if n.Missing <= 0 {
		return fmt.Sprintf("Нотчове: %d от %d според %s – всички са налице.", n.Found, n.Expected, n.Source)
	}
	s := fmt.Sprintf("ЛИПСВАТ %d нотча: в GBR има %d, а според %s трябва да са %d.", n.Missing, n.Found, n.Source, n.Expected)
	if len(n.Lines) > 0 {
		s += " " + strings.Join(n.Lines, "; ") + "."
	}
	return s
}
