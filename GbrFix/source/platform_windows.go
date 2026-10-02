//go:build windows

package main

import (
	"encoding/base64"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"time"
	"unicode/utf16"
	"unsafe"
)

const (
	createNoWindow        = 0x08000000
	fileShareRead         = 0x1
	fileShareWrite        = 0x2
	fileShareDelete       = 0x4
	fileListDirectory     = 0x1
	openExisting          = 3
	fileFlagBackupSemants = 0x02000000
	notifyFileName        = 0x1
	notifyLastWrite       = 0x10
	notifySize            = 0x8
	driveRemovable        = 2
	driveFixed            = 3
	driveRemote           = 4
)

var (
	kernel32    = syscall.NewLazyDLL("kernel32.dll")
	pCancelIoEx = kernel32.NewProc("CancelIoEx")
	user32      = syscall.NewLazyDLL("user32.dll")
	pMessageBox = user32.NewProc("MessageBoxW")
)

func appDir() string {
	d := os.Getenv("LOCALAPPDATA")
	if d == "" {
		d = os.TempDir()
	}
	d = filepath.Join(d, "GbrFix")
	_ = os.MkdirAll(d, 0755)
	return d
}

func hidden(cmd *exec.Cmd) *exec.Cmd {
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: createNoWindow}
	return cmd
}

func openURL(u string) {
	letForeground()
	_ = hidden(exec.Command("rundll32", "url.dll,FileProtocolHandler", u)).Start()
}

func revealInExplorer(p string) {
	letForeground() // otherwise Explorer may open behind the GBR Fix window
	cmd := exec.Command("explorer")
	cmd.SysProcAttr = &syscall.SysProcAttr{CmdLine: `explorer /select,"` + p + `"`}
	_ = cmd.Start()
}

func msgBox(text, title string, flags uintptr) {
	t, _ := syscall.UTF16PtrFromString(text)
	c, _ := syscall.UTF16PtrFromString(title)
	pMessageBox.Call(0, uintptr(unsafe.Pointer(t)), uintptr(unsafe.Pointer(c)), flags)
}

func fatalBox(msg string) { msgBox(msg, "GBR Fix", 0x10) }

// ---------------- folder watching ----------------

type watcher struct {
	buf     []uint64 // heap-allocated and 8-byte aligned (ReadDirectoryChangesW needs DWORD alignment)
	mu      sync.Mutex
	stopped bool
	h       syscall.Handle
}

func (w *watcher) stop() {
	w.mu.Lock()
	w.stopped = true
	h := w.h
	w.mu.Unlock()
	if h != 0 {
		pCancelIoEx.Call(uintptr(h), 0)
	}
}

func (w *watcher) isStopped() bool { w.mu.Lock(); defer w.mu.Unlock(); return w.stopped }

// startWatchers watches every root (with all subfolders) and returns a stop function.
func startWatchers(roots []string, onFile func(string), onErr func(string)) func() {
	var ws []*watcher
	for _, r := range roots {
		w := &watcher{}
		ws = append(ws, w)
		go w.run(r, onFile, onErr)
	}
	return func() {
		for _, w := range ws {
			w.stop()
		}
	}
}

func (w *watcher) run(root string, onFile func(string), onErr func(string)) {
	failures := 0
	for !w.isStopped() {
		p, _ := syscall.UTF16PtrFromString(root)
		h, err := syscall.CreateFile(p, fileListDirectory, fileShareRead|fileShareWrite|fileShareDelete, nil, openExisting, fileFlagBackupSemants, 0)
		if err != nil {
			failures++
			if failures == 1 {
				onErr(fmt.Sprintf("Не мога да следя %s: %v (ще опитвам отново)", root, err))
			}
			for k := 0; k < 30 && !w.isStopped(); k++ {
				time.Sleep(time.Second)
			}
			continue
		}
		w.mu.Lock()
		w.h = h
		stopped := w.stopped
		w.mu.Unlock()
		if w.buf == nil {
			w.buf = make([]uint64, 32*1024/8)
		}
		base := unsafe.Pointer(&w.buf[0])
		bufLen := uint32(len(w.buf) * 8)
		for !stopped {
			var n uint32
			err := syscall.ReadDirectoryChanges(h, (*byte)(base), bufLen, true, notifyFileName|notifyLastWrite|notifySize, &n, nil, 0)
			if w.isStopped() {
				break
			}
			if err != nil {
				failures++
				if failures == 1 { // report once, not on every retry
					onErr(fmt.Sprintf("Следенето на %s прекъсна: %v (опитва се отново)", root, err))
				}
				break
			}
			failures = 0
			if n == 0 {
				continue // buffer overflow – too many changes at once
			}
			off := uint32(0)
			for {
				if off+12 > bufLen {
					break
				}
				info := (*syscall.FileNotifyInformation)(unsafe.Add(base, off))
				nameU := unsafe.Slice((*uint16)(unsafe.Pointer(&info.FileName)), info.FileNameLength/2)
				name := string(utf16.Decode(nameU))
				switch info.Action {
				case syscall.FILE_ACTION_ADDED, syscall.FILE_ACTION_MODIFIED, syscall.FILE_ACTION_RENAMED_NEW_NAME:
					switch strings.ToLower(filepath.Ext(name)) {
					case ".gbr", ".mrk", ".pds":
						onFile(filepath.Join(root, name))
					}
				}
				if info.NextEntryOffset == 0 {
					break
				}
				off += info.NextEntryOffset
			}
		}
		w.mu.Lock()
		w.h = 0
		w.mu.Unlock()
		syscall.CloseHandle(h)
		for k := 0; k < 10 && !w.isStopped(); k++ {
			time.Sleep(time.Second)
		}
	}
}

// ---------------- start with Windows (user setting) ----------------

const runKey = `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`

func autostartEnabled() bool {
	return hidden(exec.Command("reg", "query", runKey, "/v", "GbrFix")).Run() == nil
}

func setAutostart(on bool) error {
	if !on {
		if !autostartEnabled() {
			return nil
		}
		return hidden(exec.Command("reg", "delete", runKey, "/v", "GbrFix", "/f")).Run()
	}
	self, err := os.Executable()
	if err != nil {
		return err
	}
	return hidden(exec.Command("reg", "add", runKey, "/v", "GbrFix", "/t", "REG_SZ", "/d", `"`+self+`" -background`, "/f")).Run()
}

// psQuote makes a PowerShell single-quoted string.
func psQuote(s string) string { return "'" + strings.ReplaceAll(s, "'", "''") + "'" }

// pickFile shows the standard Windows "Open" dialog in front of the GBR Fix window.
// filter is "Name|*.ext".
func pickFile(title, filter, startDir string) (string, error) {
	name, spec, _ := strings.Cut(filter, "|")
	if p, err := fileDialog(title, name, spec, startDir, false); err == nil {
		return p, nil
	}
	return pickFilePS(title, filter, startDir)
}

func pickFilePS(title, filter, startDir string) (string, error) {
	script := `Add-Type -AssemblyName System.Windows.Forms; $f = New-Object System.Windows.Forms.OpenFileDialog; ` +
		`$f.Title = ` + psQuote(title) + `; $f.Filter = ` + psQuote(filter) + `; $f.InitialDirectory = ` + psQuote(startDir) + `; ` +
		`$o = New-Object System.Windows.Forms.Form; $o.TopMost = $true; ` +
		`if ($f.ShowDialog($o) -eq 'OK') { [Console]::OutputEncoding = [Text.Encoding]::UTF8; [Console]::Write($f.FileName) }`
	return runPS(script)
}

func runPS(script string) (string, error) {
	u := utf16.Encode([]rune(script))
	b := make([]byte, len(u)*2)
	for i, v := range u {
		b[2*i], b[2*i+1] = byte(v), byte(v>>8)
	}
	out, err := hidden(exec.Command("powershell", "-NoProfile", "-STA", "-NonInteractive", "-EncodedCommand", base64.StdEncoding.EncodeToString(b))).Output()
	return strings.TrimSpace(string(out)), err
}

// pickFolder shows the standard Windows folder dialog in front of the GBR Fix window.
func pickFolder(desc string) (string, error) {
	if p, err := fileDialog(desc, "", "", "", true); err == nil {
		return p, nil
	}
	return pickFolderPS(desc)
}

func pickFolderPS(desc string) (string, error) {
	script := `Add-Type -AssemblyName System.Windows.Forms; $f = New-Object System.Windows.Forms.FolderBrowserDialog; ` +
		`$f.Description = ` + psQuote(desc) + `; $f.ShowNewFolderButton = $false; ` +
		`$o = New-Object System.Windows.Forms.Form; $o.TopMost = $true; ` +
		`if ($f.ShowDialog($o) -eq 'OK') { [Console]::OutputEncoding = [Text.Encoding]::UTF8; [Console]::Write($f.SelectedPath) }`
	return runPS(script)
}
