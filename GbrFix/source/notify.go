package main

import (
	"fmt"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

// Batches conversion notifications: one file -> file + folder,
// many files within a few seconds -> one summary ("12 файла в папка ...").

type noteItem struct {
	out    string
	status string // ok, warn, error
}

type Note struct {
	Title string
	Text  string
	Warn  bool
	// what a click on the notification opens
	Folder string
	File   string
}

type notifier struct {
	mu    sync.Mutex
	items []noteItem
	first time.Time
	timer *time.Timer
	quiet time.Duration
	max   time.Duration
	send  func(Note)
}

func newNotifier(send func(Note)) *notifier {
	return &notifier{quiet: 4 * time.Second, max: 20 * time.Second, send: send}
}

func (n *notifier) add(it noteItem) {
	n.mu.Lock()
	defer n.mu.Unlock()
	if len(n.items) == 0 {
		n.first = time.Now()
	}
	n.items = append(n.items, it)
	wait := n.quiet
	if left := n.max - time.Since(n.first); left < wait {
		wait = left
	}
	if wait < 0 {
		wait = 0
	}
	if n.timer == nil {
		n.timer = time.AfterFunc(wait, n.flush)
	} else {
		n.timer.Reset(wait)
	}
}

func (n *notifier) flush() {
	n.mu.Lock()
	items := n.items
	n.items = nil
	n.timer = nil
	n.mu.Unlock()
	if len(items) > 0 {
		n.send(buildNote(items))
	}
}

func shortPath(p string, max int) string {
	r := []rune(p)
	if len(r) <= max {
		return p
	}
	keep := max - 1
	head := keep / 3
	return string(r[:head]) + "…" + string(r[len(r)-(keep-head):])
}

func plural(n int, one, many string) string {
	if n == 1 {
		return one
	}
	return many
}

func buildNote(items []noteItem) Note {
	// de-duplicate same output (file saved twice in a batch)
	seen := map[string]int{}
	var list []noteItem
	for _, it := range items {
		k := strings.ToLower(it.out)
		if i, ok := seen[k]; ok {
			list[i] = it
			continue
		}
		seen[k] = len(list)
		list = append(list, it)
	}
	var ok, warn, errs int
	folders := map[string]int{}
	var order []string
	for _, it := range list {
		switch it.status {
		case "warn":
			warn++
		case "error":
			errs++
		default:
			ok++
		}
		d := filepath.Dir(it.out)
		if _, f := folders[d]; !f {
			order = append(order, d)
		}
		folders[d]++
	}
	total := len(list)
	nt := Note{Warn: warn+errs > 0}
	var problems string
	if warn > 0 {
		problems += fmt.Sprintf("\n⚠ %d %s за проверка", warn, plural(warn, "файл", "файла"))
	}
	if errs > 0 {
		problems += fmt.Sprintf("\n✖ %d %s", errs, plural(errs, "грешка", "грешки"))
	}
	if total == 1 {
		it := list[0]
		switch it.status {
		case "error":
			nt.Title = "GBR Fix – грешка при запис"
		case "warn":
			nt.Title = "GBR Fix – коригиран, ПРОВЕРЕТЕ го"
		default:
			nt.Title = "GBR Fix – коригиран файл"
		}
		nt.Text = shortPath(filepath.Base(it.out), 90) + "\nПапка: " + shortPath(filepath.Dir(it.out), 110)
		nt.Folder, nt.File = filepath.Dir(it.out), it.out
		return nt
	}
	if len(folders) == 1 {
		nt.Title = fmt.Sprintf("GBR Fix – коригирани %d файла", total)
		nt.Text = "Папка: " + shortPath(order[0], 150) + problems
		nt.Folder = order[0]
		return nt
	}
	nt.Title = fmt.Sprintf("GBR Fix – коригирани %d файла в %d папки", total, len(folders))
	sort.SliceStable(order, func(i, j int) bool { return folders[order[i]] > folders[order[j]] })
	var lines []string
	for i, d := range order {
		if i == 3 {
			lines = append(lines, fmt.Sprintf("… и още %d %s", len(order)-3, plural(len(order)-3, "папка", "папки")))
			break
		}
		lines = append(lines, fmt.Sprintf("%s (%d)", shortPath(d, 50), folders[d]))
	}
	nt.Text = strings.Join(lines, "\n") + problems
	return nt
}
