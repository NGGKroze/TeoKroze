//go:build windows

package main

import (
	"sync"
	"syscall"
	"unsafe"
)

var (
	pEnumWindows                = user32.NewProc("EnumWindows")
	pGetWindowTextW             = user32.NewProc("GetWindowTextW")
	pIsWindowVisible            = user32.NewProc("IsWindowVisible")
	pOpenProcess                = kernel32.NewProc("OpenProcess")
	pCloseHandle                = kernel32.NewProc("CloseHandle")
	pQueryFullProcessImageNameW = kernel32.NewProc("QueryFullProcessImageNameW")
	enumMu                      sync.Mutex
	enumCB                      uintptr
	enumOut                     *[]string
)

func processImage(pid uintptr) string {
	h, _, _ := pOpenProcess.Call(0x1000, 0, pid) // PROCESS_QUERY_LIMITED_INFORMATION
	if h == 0 {
		return ""
	}
	defer pCloseHandle.Call(h)
	buf := make([]uint16, 1024)
	n := uint32(len(buf))
	if r, _, _ := pQueryFullProcessImageNameW.Call(h, 0, uintptr(unsafe.Pointer(&buf[0])), uintptr(unsafe.Pointer(&n))); r == 0 {
		return ""
	}
	return syscall.UTF16ToString(buf[:n])
}

// markerWindowTitles: titles of the visible windows of Optitex Marker,
// e.g. "M-VESTE-WOOLPURE-V1-PROIZ-SH - Optitex Mark 26".
func markerWindowTitles() []string {
	enumMu.Lock()
	defer enumMu.Unlock()
	var out []string
	enumOut = &out
	if enumCB == 0 {
		enumCB = syscall.NewCallback(func(h, _ uintptr) uintptr {
			if v, _, _ := pIsWindowVisible.Call(h); v == 0 {
				return 1
			}
			buf := make([]uint16, 1024)
			n, _, _ := pGetWindowTextW.Call(h, uintptr(unsafe.Pointer(&buf[0])), uintptr(len(buf)))
			if n == 0 {
				return 1
			}
			var pid uintptr
			pGetWindowThreadProcessId.Call(h, uintptr(unsafe.Pointer(&pid)))
			title := syscall.UTF16ToString(buf[:n])
			if isMarkerWindow(title, processImage(pid)) {
				*enumOut = append(*enumOut, title)
			}
			return 1
		})
	}
	pEnumWindows.Call(enumCB, 0)
	return out
}
