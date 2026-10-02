//go:build !windows

package main

import (
	"fmt"
	"os"
	"path/filepath"
)

func appDir() string {
	d := filepath.Join(os.TempDir(), "GbrFix")
	_ = os.MkdirAll(d, 0755)
	return d
}
func openURL(u string)          { fmt.Println("open", u) }
func revealInExplorer(p string) {}
func fatalBox(msg string)       { fmt.Println(msg) }
func showWindow(url string)     { fmt.Println("show", url) }
func runUI(a *App)              { select {} }
func trayNotify(n Note)         { fmt.Printf("NOTIFY %s | %s\n", n.Title, n.Text) }
func trayRefresh(a *App)        {}
func appQuit()                  { os.Exit(0) }
func startWatchers(roots []string, onFile func(string), onErr func(string)) func() {
	return func() {}
}

var fakeAutostart bool

func autostartEnabled() bool                 { return fakeAutostart }
func setAutostart(on bool) error             { fakeAutostart = on; return nil }
func pickFolder(desc string) (string, error) { return os.TempDir(), nil }

func pickFile(title, filter, startDir string) (string, error) { return "", nil }

func markerWindowTitles() []string { return nil }

func readShared(p string) ([]byte, error) { return os.ReadFile(p) }
