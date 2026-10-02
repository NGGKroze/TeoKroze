//go:build windows

package main

// Folder / file dialogs in front of the GBR Fix window.
//
// The window belongs to Edge, GBR Fix only runs in the tray, and Windows does not let
// a background process put its windows in front of the active one: a dialog started
// from here (formerly via PowerShell) opened behind the GBR Fix window. Now the
// standard Windows dialog (IFileOpenDialog) is shown in this process with the GBR Fix
// window as its owner, so it always lies above it, and for the time of the dialog this
// thread shares the input of the window the user just clicked, so it also gets focus.

import (
	"errors"
	"runtime"
	"syscall"
	"unsafe"
)

var (
	ole32                    = syscall.NewLazyDLL("ole32.dll")
	pCoInitializeEx          = ole32.NewProc("CoInitializeEx")
	pCoUninitialize          = ole32.NewProc("CoUninitialize")
	pCoCreateInstance        = ole32.NewProc("CoCreateInstance")
	pCoTaskMemFree           = ole32.NewProc("CoTaskMemFree")
	pSHCreateItemFromParsing = shell32.NewProc("SHCreateItemFromParsingName")

	pGetForegroundWindow      = user32.NewProc("GetForegroundWindow")
	pGetWindowThreadProcessId = user32.NewProc("GetWindowThreadProcessId")
	pAttachThreadInput        = user32.NewProc("AttachThreadInput")
	pAllowSetForegroundWindow = user32.NewProc("AllowSetForegroundWindow")
	pBringWindowToTop         = user32.NewProc("BringWindowToTop")
	pGetCurrentThreadId       = kernel32.NewProc("GetCurrentThreadId")
)

type guid struct {
	d1     uint32
	d2, d3 uint16
	d4     [8]byte
}

var (
	clsidFileOpenDialog = guid{0xDC1C5A9C, 0xE88A, 0x4DDE, [8]byte{0xA5, 0xA1, 0x60, 0xF8, 0x2A, 0x20, 0xAE, 0xF7}}
	iidFileOpenDialog   = guid{0xD57C7288, 0xD4AD, 0x4768, [8]byte{0xBE, 0x02, 0x9D, 0x96, 0x95, 0x32, 0xD9, 0x60}}
	iidShellItem        = guid{0x43826D1E, 0xE718, 0x42EE, [8]byte{0xBC, 0x55, 0xA1, 0xE2, 0x61, 0xC3, 0x7B, 0xFE}}
)

// vtable slots
const (
	vRelease        = 2
	vShow           = 3
	vSetFileTypes   = 4
	vSetOptions     = 9
	vGetOptions     = 10
	vSetFolder      = 12
	vSetTitle       = 17
	vGetResult      = 20
	vGetDisplayName = 5 // IShellItem

	fosNoChangeDir     = 0x8
	fosPickFolders     = 0x20
	fosForceFileSystem = 0x40
	fosPathMustExist   = 0x800
	fosFileMustExist   = 0x1000

	sigdnFileSysPath = 0x80058000
	errCancelled     = 0x800704C7
	coinitApartment  = 0x2
	clsctxInproc     = 0x1
	asfwAny          = ^uintptr(0)
)

// comObj is a COM interface pointer: its first field points to the method table.
type comObj struct{ vtbl *[32]uintptr }

func (o *comObj) call(slot int, args ...uintptr) uintptr {
	r, _, _ := syscall.SyscallN(o.vtbl[slot], append([]uintptr{uintptr(unsafe.Pointer(o))}, args...)...)
	return r
}

func (o *comObj) release() {
	if o != nil {
		o.call(vRelease)
	}
}

func hfailed(hr uintptr) bool { return int32(hr) < 0 }

// appWindow is the GBR Fix window (Edge in app mode, titled after the page).
func appWindow() uintptr {
	t, _ := syscall.UTF16PtrFromString("GBR Fix")
	h, _, _ := pFindWindow.Call(0, uintptr(unsafe.Pointer(t)))
	return h
}

// shareForeground lets the current OS thread act as part of the active window's
// thread (the window the user just clicked), so windows it shows can come to front.
// The returned function undoes it. The caller must have locked the OS thread.
func shareForeground() func() {
	fg, _, _ := pGetForegroundWindow.Call()
	if fg == 0 {
		return func() {}
	}
	other, _, _ := pGetWindowThreadProcessId.Call(fg, 0)
	me, _, _ := pGetCurrentThreadId.Call()
	if other == 0 || other == me {
		return func() {}
	}
	if ok, _, _ := pAttachThreadInput.Call(me, other, 1); ok == 0 {
		return func() {}
	}
	return func() { pAttachThreadInput.Call(me, other, 0) }
}

// letForeground allows the next program we start (Explorer) to come to front.
func letForeground() {
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	undo := shareForeground()
	pAllowSetForegroundWindow.Call(asfwAny)
	undo()
}

type filterSpec struct{ name, spec *uint16 }

// fileDialog shows the Windows "Open" dialog (or the folder picker) and returns the
// chosen path, "" when cancelled.
func fileDialog(title, filterName, filterSpecStr, startDir string, folders bool) (string, error) {
	type res struct {
		p   string
		err error
	}
	ch := make(chan res, 1)
	go func() { // COM wants its own (single-threaded) thread
		runtime.LockOSThread()
		defer runtime.UnlockOSThread()
		p, err := fileDialogSTA(title, filterName, filterSpecStr, startDir, folders)
		ch <- res{p, err}
	}()
	r := <-ch
	return r.p, r.err
}

func fileDialogSTA(title, filterName, filterSpecStr, startDir string, folders bool) (string, error) {
	hr, _, _ := pCoInitializeEx.Call(0, coinitApartment)
	if hfailed(hr) {
		return "", errors.New("COM не може да се инициализира")
	}
	defer pCoUninitialize.Call()
	var dlg *comObj
	hr, _, _ = pCoCreateInstance.Call(uintptr(unsafe.Pointer(&clsidFileOpenDialog)), 0, clsctxInproc,
		uintptr(unsafe.Pointer(&iidFileOpenDialog)), uintptr(unsafe.Pointer(&dlg)))
	if hfailed(hr) || dlg == nil {
		return "", errors.New("прозорецът за избор не може да се отвори")
	}
	defer dlg.release()

	var opts uint32
	dlg.call(vGetOptions, uintptr(unsafe.Pointer(&opts)))
	opts |= fosForceFileSystem | fosPathMustExist | fosNoChangeDir
	if folders {
		opts |= fosPickFolders
	} else {
		opts |= fosFileMustExist
	}
	dlg.call(vSetOptions, uintptr(opts))
	if t, err := syscall.UTF16PtrFromString(title); err == nil {
		dlg.call(vSetTitle, uintptr(unsafe.Pointer(t)))
	}
	var spec []filterSpec
	if !folders && filterSpecStr != "" {
		n, _ := syscall.UTF16PtrFromString(filterName)
		s, _ := syscall.UTF16PtrFromString(filterSpecStr)
		spec = []filterSpec{{n, s}}
		dlg.call(vSetFileTypes, 1, uintptr(unsafe.Pointer(&spec[0])))
	}
	if startDir != "" {
		if sd, err := syscall.UTF16PtrFromString(startDir); err == nil {
			var item *comObj
			hr, _, _ := pSHCreateItemFromParsing.Call(uintptr(unsafe.Pointer(sd)), 0, uintptr(unsafe.Pointer(&iidShellItem)), uintptr(unsafe.Pointer(&item)))
			if !hfailed(hr) && item != nil {
				dlg.call(vSetFolder, uintptr(unsafe.Pointer(item)))
				item.release()
			}
		}
	}

	owner := appWindow()
	undo := shareForeground()
	if owner != 0 {
		pBringWindowToTop.Call(owner)
	}
	hr = dlg.call(vShow, owner)
	undo()
	runtime.KeepAlive(spec)
	if uint32(hr) == errCancelled {
		return "", nil
	}
	if hfailed(hr) {
		return "", errors.New("прозорецът за избор не може да се покаже")
	}
	var item *comObj
	if hr = dlg.call(vGetResult, uintptr(unsafe.Pointer(&item))); hfailed(hr) || item == nil {
		return "", nil
	}
	defer item.release()
	var ps *uint16
	if hr = item.call(vGetDisplayName, sigdnFileSysPath, uintptr(unsafe.Pointer(&ps))); hfailed(hr) || ps == nil {
		return "", errors.New("избраното не е папка/файл на диска")
	}
	defer pCoTaskMemFree.Call(uintptr(unsafe.Pointer(ps)))
	return utf16PtrToString(ps), nil
}

func utf16PtrToString(p *uint16) string {
	var s []uint16
	for ptr := unsafe.Pointer(p); ; ptr = unsafe.Add(ptr, 2) {
		c := *(*uint16)(ptr)
		if c == 0 {
			break
		}
		s = append(s, c)
	}
	return syscall.UTF16ToString(s)
}
