//go:build windows

package main

// System-tray icon, menu and balloon notifications using plain Win32 calls.

import (
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sync"
	"syscall"
	"unicode/utf16"
	"unsafe"
)

var (
	shell32                   = syscall.NewLazyDLL("shell32.dll")
	pShellNotifyIcon          = shell32.NewProc("Shell_NotifyIconW")
	pRegisterClassEx          = user32.NewProc("RegisterClassExW")
	pCreateWindowEx           = user32.NewProc("CreateWindowExW")
	pDefWindowProc            = user32.NewProc("DefWindowProcW")
	pGetMessage               = user32.NewProc("GetMessageW")
	pTranslateMessage         = user32.NewProc("TranslateMessage")
	pDispatchMessage          = user32.NewProc("DispatchMessageW")
	pPostMessage              = user32.NewProc("PostMessageW")
	pPostQuitMessage          = user32.NewProc("PostQuitMessage")
	pCreatePopupMenu          = user32.NewProc("CreatePopupMenu")
	pAppendMenu               = user32.NewProc("AppendMenuW")
	pSetMenuDefaultItem       = user32.NewProc("SetMenuDefaultItem")
	pTrackPopupMenu           = user32.NewProc("TrackPopupMenu")
	pDestroyMenu              = user32.NewProc("DestroyMenu")
	pSetForegroundWindow      = user32.NewProc("SetForegroundWindow")
	pGetCursorPos             = user32.NewProc("GetCursorPos")
	pFindWindow               = user32.NewProc("FindWindowW")
	pShowWindow               = user32.NewProc("ShowWindow")
	pIsIconic                 = user32.NewProc("IsIconic")
	pCreateIconFromResourceEx = user32.NewProc("CreateIconFromResourceEx")
	pGetSystemMetrics         = user32.NewProc("GetSystemMetrics")
	pRegisterWindowMessage    = user32.NewProc("RegisterWindowMessageW")
	pGetModuleHandle          = kernel32.NewProc("GetModuleHandleW")
)

const (
	wmNull          = 0x0000
	wmDestroy       = 0x0002
	wmContextMenu   = 0x007B
	wmRButtonUp     = 0x0205
	wmLButtonDblClk = 0x0203
	wmApp           = 0x8000
	wmTray          = wmApp + 1
	wmNotify        = wmApp + 2
	wmRefresh       = wmApp + 3

	ninSelect           = 0x0400
	ninKeySelect        = 0x0401
	ninBalloonUserClick = 0x0405

	nimAdd        = 0
	nimModify     = 1
	nimDelete     = 2
	nimSetVersion = 4
	nifMessage    = 0x01
	nifIcon       = 0x02
	nifTip        = 0x04
	nifInfo       = 0x10
	nifShowTip    = 0x80
	niifInfo      = 0x01
	niifWarning   = 0x02
	niifUser      = 0x04
	niifLargeIcon = 0x20

	mfString    = 0x0000
	mfGrayed    = 0x0001
	mfChecked   = 0x0008
	mfSeparator = 0x0800

	tpmRightButton = 0x0002
	tpmNoNotify    = 0x0080
	tpmReturnCmd   = 0x0100

	cmdOpen   = 1
	cmdFolder = 2
	cmdPause  = 3
	cmdExit   = 4
)

type wndClassEx struct {
	cbSize        uint32
	style         uint32
	lpfnWndProc   uintptr
	cbClsExtra    int32
	cbWndExtra    int32
	hInstance     uintptr
	hIcon         uintptr
	hCursor       uintptr
	hbrBackground uintptr
	lpszMenuName  *uint16
	lpszClassName *uint16
	hIconSm       uintptr
}

type winMsg struct {
	hwnd     uintptr
	message  uint32
	wParam   uintptr
	lParam   uintptr
	time     uint32
	pt       struct{ x, y int32 }
	lPrivate uint32
}

type notifyIconData struct {
	CbSize           uint32
	HWnd             uintptr
	UID              uint32
	UFlags           uint32
	UCallbackMessage uint32
	HIcon            uintptr
	SzTip            [128]uint16
	DwState          uint32
	DwStateMask      uint32
	SzInfo           [256]uint16
	UVersion         uint32
	SzInfoTitle      [64]uint16
	DwInfoFlags      uint32
	GuidItem         [16]byte
	HBalloonIcon     uintptr
}

var tray struct {
	mu             sync.Mutex
	hwnd           uintptr
	app            *App
	icon, bigIcon  uintptr
	taskbarCreated uintptr
	added          bool
	queue          []Note
}

func u16(dst []uint16, s string) {
	u := utf16.Encode([]rune(s))
	if len(u) > len(dst)-1 {
		u = u[:len(dst)-1]
	}
	copy(dst, u)
	dst[len(u)] = 0
}

func loadPNGIcon(size int) uintptr {
	names := []int{16, 20, 24, 32, 48, 64, 256}
	pick := 256
	for _, n := range names {
		if n >= size {
			pick = n
			break
		}
	}
	b, err := assetFS.ReadFile("assets/icon" + itoa(pick) + ".png")
	if err != nil || len(b) == 0 {
		return 0
	}
	h, _, _ := pCreateIconFromResourceEx.Call(uintptr(unsafe.Pointer(&b[0])), uintptr(len(b)), 1, 0x00030000, uintptr(size), uintptr(size), 0)
	return h
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var b []byte
	for n > 0 {
		b = append([]byte{byte('0' + n%10)}, b...)
		n /= 10
	}
	return string(b)
}

func trayData(flags uint32) *notifyIconData {
	d := &notifyIconData{HWnd: tray.hwnd, UID: 1, UFlags: flags, UCallbackMessage: wmTray, HIcon: tray.icon}
	d.CbSize = uint32(unsafe.Sizeof(*d))
	return d
}

func trayAdd() {
	d := trayData(nifMessage | nifIcon | nifTip | nifShowTip)
	tip := "GBR Fix"
	if tray.app != nil {
		tip = tray.app.trayTip()
	}
	u16(d.SzTip[:], tip)
	r, _, _ := pShellNotifyIcon.Call(nimAdd, uintptr(unsafe.Pointer(d)))
	d.UVersion = 4 // NOTIFYICON_VERSION_4
	pShellNotifyIcon.Call(nimSetVersion, uintptr(unsafe.Pointer(d)))
	tray.mu.Lock()
	tray.added = r != 0
	tray.mu.Unlock()
}

func trayRemove() {
	tray.mu.Lock()
	added := tray.added
	tray.added = false
	tray.mu.Unlock()
	if added {
		d := trayData(0)
		pShellNotifyIcon.Call(nimDelete, uintptr(unsafe.Pointer(d)))
	}
}

func showBalloon(n Note) {
	d := trayData(nifInfo | nifShowTip)
	u16(d.SzInfoTitle[:], n.Title)
	u16(d.SzInfo[:], n.Text)
	if n.Warn {
		d.DwInfoFlags = niifWarning | niifLargeIcon
	} else if tray.bigIcon != 0 {
		d.DwInfoFlags = niifUser | niifLargeIcon
		d.HBalloonIcon = tray.bigIcon
	} else {
		d.DwInfoFlags = niifInfo
	}
	pShellNotifyIcon.Call(nimModify, uintptr(unsafe.Pointer(d)))
}

// trayNotify can be called from any goroutine.
func trayNotify(n Note) {
	tray.mu.Lock()
	tray.queue = append(tray.queue, n)
	h := tray.hwnd
	tray.mu.Unlock()
	if h != 0 {
		pPostMessage.Call(h, wmNotify, 0, 0)
	}
}

func trayRefresh(a *App) {
	tray.mu.Lock()
	h := tray.hwnd
	tray.mu.Unlock()
	if h != 0 {
		pPostMessage.Call(h, wmRefresh, 0, 0)
	}
}

func openLastFolder(a *App) {
	a.mu.Lock()
	n := a.lastNote
	a.mu.Unlock()
	if n.File != "" {
		if _, err := os.Stat(n.File); err == nil {
			revealInExplorer(n.File)
			return
		}
	}
	if n.Folder != "" {
		_ = exec.Command("explorer", n.Folder).Start()
		return
	}
	a.showUI("")
}

func showMenu(hwnd uintptr) {
	a := tray.app
	m, _, _ := pCreatePopupMenu.Call()
	add := func(id uintptr, flags uintptr, text string) {
		p, _ := syscall.UTF16PtrFromString(text)
		pAppendMenu.Call(m, flags, id, uintptr(unsafe.Pointer(p)))
	}
	add(cmdOpen, mfString, "Отвори GBR Fix")
	a.mu.Lock()
	hasLast := a.lastNote.Folder != ""
	paused := a.paused
	a.mu.Unlock()
	fl := uintptr(mfString)
	if !hasLast {
		fl |= mfGrayed
	}
	add(cmdFolder, fl, "Отвори папката на последните файлове")
	fl = mfString
	if paused {
		fl |= mfChecked
	}
	add(cmdPause, fl, "Пауза на автоматичното конвертиране")
	add(0, mfSeparator, "")
	add(cmdExit, mfString, "Изход")
	pSetMenuDefaultItem.Call(m, cmdOpen, 0)
	var pt struct{ x, y int32 }
	pGetCursorPos.Call(uintptr(unsafe.Pointer(&pt)))
	pSetForegroundWindow.Call(hwnd)
	cmd, _, _ := pTrackPopupMenu.Call(m, tpmRightButton|tpmReturnCmd|tpmNoNotify, uintptr(pt.x), uintptr(pt.y), 0, hwnd, 0)
	pPostMessage.Call(hwnd, wmNull, 0, 0)
	pDestroyMenu.Call(m)
	switch cmd {
	case cmdOpen:
		a.showUI("")
	case cmdFolder:
		openLastFolder(a)
	case cmdPause:
		a.setPaused(!paused)
	case cmdExit:
		appQuit()
	}
}

func wndProc(hwnd, msg, wParam, lParam uintptr) uintptr {
	switch {
	case msg == wmTray:
		switch lParam & 0xFFFF {
		case ninSelect, ninKeySelect, wmLButtonDblClk:
			go tray.app.showUI("")
		case wmContextMenu, wmRButtonUp:
			showMenu(hwnd)
		case ninBalloonUserClick:
			go openLastFolder(tray.app)
		}
		return 0
	case msg == wmNotify:
		tray.mu.Lock()
		q := tray.queue
		tray.queue = nil
		tray.mu.Unlock()
		for _, n := range q {
			showBalloon(n)
		}
		return 0
	case msg == wmRefresh:
		d := trayData(nifTip | nifShowTip)
		u16(d.SzTip[:], tray.app.trayTip())
		pShellNotifyIcon.Call(nimModify, uintptr(unsafe.Pointer(d)))
		return 0
	case tray.taskbarCreated != 0 && msg == tray.taskbarCreated:
		trayAdd() // Explorer was restarted
		return 0
	case msg == wmDestroy:
		trayRemove()
		pPostQuitMessage.Call(0)
		return 0
	}
	r, _, _ := pDefWindowProc.Call(hwnd, msg, wParam, lParam)
	return r
}

// runUI creates the tray icon and runs the Windows message loop (blocks).
func runUI(a *App) {
	runtime.LockOSThread()
	tray.app = a
	hInst, _, _ := pGetModuleHandle.Call(0)
	small, _, _ := pGetSystemMetrics.Call(49) // SM_CXSMICON
	if small == 0 {
		small = 16
	}
	tray.icon = loadPNGIcon(int(small))
	tray.bigIcon = loadPNGIcon(48)
	cls, _ := syscall.UTF16PtrFromString("GbrFixTrayWindow")
	wc := wndClassEx{lpfnWndProc: syscall.NewCallback(wndProc), hInstance: hInst, lpszClassName: cls, hIcon: tray.bigIcon, hIconSm: tray.icon}
	wc.cbSize = uint32(unsafe.Sizeof(wc))
	pRegisterClassEx.Call(uintptr(unsafe.Pointer(&wc)))
	title, _ := syscall.UTF16PtrFromString("GbrFixTray")
	hwnd, _, _ := pCreateWindowEx.Call(0, uintptr(unsafe.Pointer(cls)), uintptr(unsafe.Pointer(title)), 0, 0, 0, 0, 0, 0, 0, hInst, 0)
	if hwnd == 0 {
		select {} // no tray possible – keep running in the background
	}
	tb, _ := syscall.UTF16PtrFromString("TaskbarCreated")
	tray.taskbarCreated, _, _ = pRegisterWindowMessage.Call(uintptr(unsafe.Pointer(tb)))
	tray.mu.Lock()
	tray.hwnd = hwnd
	pending := len(tray.queue) > 0
	tray.mu.Unlock()
	trayAdd()
	if pending {
		pPostMessage.Call(hwnd, wmNotify, 0, 0)
	}
	var m winMsg
	for {
		r, _, _ := pGetMessage.Call(uintptr(unsafe.Pointer(&m)), 0, 0, 0)
		if int32(r) <= 0 {
			return
		}
		pTranslateMessage.Call(uintptr(unsafe.Pointer(&m)))
		pDispatchMessage.Call(uintptr(unsafe.Pointer(&m)))
	}
}

func appQuit() {
	trayRemove()
	os.Exit(0)
}

// ---------------- the program window ----------------

// showWindow brings the GBR Fix window to front, or opens it as a separate
// app window (Edge/Chrome --app mode: no tabs, no address bar).
func showWindow(url string) {
	t, _ := syscall.UTF16PtrFromString("GBR Fix")
	if h, _, _ := pFindWindow.Call(0, uintptr(unsafe.Pointer(t))); h != 0 {
		if ic, _, _ := pIsIconic.Call(h); ic != 0 {
			pShowWindow.Call(h, 9) // SW_RESTORE
		}
		pSetForegroundWindow.Call(h)
		return
	}
	if b := findAppBrowser(); b != "" {
		args := []string{"--app=" + url, "--user-data-dir=" + filepath.Join(appDir(), "window"),
			"--no-first-run", "--no-default-browser-check", "--window-size=1440,920", "--disable-features=Translate"}
		if exec.Command(b, args...).Start() == nil {
			return
		}
	}
	openURL(url)
}

func findAppBrowser() string {
	var c []string
	for _, env := range []string{"ProgramFiles(x86)", "ProgramFiles", "LOCALAPPDATA"} {
		if d := os.Getenv(env); d != "" {
			c = append(c, filepath.Join(d, `Microsoft\Edge\Application\msedge.exe`))
		}
	}
	for _, env := range []string{"ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA"} {
		if d := os.Getenv(env); d != "" {
			c = append(c, filepath.Join(d, `Google\Chrome\Application\chrome.exe`))
		}
	}
	for _, p := range c {
		if st, err := os.Stat(p); err == nil && !st.IsDir() {
			return p
		}
	}
	return ""
}
