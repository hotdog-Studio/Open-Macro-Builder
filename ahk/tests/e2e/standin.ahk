#Requires AutoHotkey v2.0
#SingleInstance Off
#NoTrayIcon
; A stand-in window for the end-to-end test (powershell\tests\EndToEnd.Tests.ps1). It shows a small
; dark window and appends to a log file every key event, mouse click and close request that reaches
; it as a window message, so the test can read what a macro sent to the active window. Run it under
; a copy of AutoHotkey64.exe named as the program it stands in for (chrome.exe, ...) so that a
; command looking for "ahk_exe chrome.exe" finds it.
;
;   AutoHotkey64.exe standin.ahk <log file> <name> <x> <y> <width> <height>
;
; Log lines, one per event:
;   start <name> pid=<pid> hwnd=<window handle>
;   down|up vk=<hex> sc=<hex> repeat=<0|1> mods=<C S A W held, or ->
;   char <hex>          a character typed as text (SendText, Send-Text), which comes as VK_PACKET
;   click <left|right|middle> <client x> <client y>
;   close
; Every other key message is answered here and not passed on, so a key never does anything in the
; stand-in itself (Alt+F4 does not close it, F10 opens no menu).

logFile := A_Args[1]
name := A_Args.Length >= 2 ? A_Args[2] : "stand-in"
x := A_Args.Length >= 3 ? A_Args[3] : 40
y := A_Args.Length >= 4 ? A_Args[4] : 120
w := A_Args.Length >= 5 ? A_Args[5] : 420
h := A_Args.Length >= 6 ? A_Args[6] : 160

StandinLog(Line) {
    global logFile
    Loop 20 {  ; the test may be reading the file at that moment
        try {
            FileAppend(Line "`n", logFile, "UTF-8-RAW")
            return
        }
        Sleep(10)
    }
}

StandinMods() {
    mods := (GetKeyState("Ctrl") ? "C" : "") (GetKeyState("Shift") ? "S" : "") (GetKeyState("Alt") ? "A" : "")
        (GetKeyState("LWin") || GetKeyState("RWin") ? "W" : "")
    return mods = "" ? "-" : mods
}

StandinKey(wParam, lParam, msg, hwnd) {
    if ((wParam & 0xFF) = 0xE7)  ; VK_PACKET, a typed character: let Windows turn it into WM_CHAR
        return
    up := (msg = 0x101 || msg = 0x105)
    StandinLog((up ? "up" : "down") " vk=" Format("{:02X}", wParam & 0xFF) " sc=" Format("{:03X}", (lParam >> 16) & 0x1FF)
        " repeat=" ((!up && (lParam >> 30) & 1) ? 1 : 0) " mods=" StandinMods())
    return 0
}

StandinClick(button) {
    return (wParam, lParam, msg, hwnd) => (StandinLog("click " button " " (lParam & 0xFFFF) " " ((lParam >> 16) & 0xFFFF)), 0)
}

StandinChar(wParam, lParam, msg, hwnd) {
    StandinLog("char " Format("{:04X}", wParam))
    return 0
}

for message in [0x100, 0x101, 0x104, 0x105]  ; WM_KEYDOWN, WM_KEYUP, WM_SYSKEYDOWN, WM_SYSKEYUP
    OnMessage(message, StandinKey)
OnMessage(0x102, StandinChar)  ; WM_CHAR, made only from typed characters (VK_PACKET)
OnMessage(0x201, StandinClick("left"))    ; WM_LBUTTONDOWN
OnMessage(0x204, StandinClick("right"))   ; WM_RBUTTONDOWN
OnMessage(0x207, StandinClick("middle"))  ; WM_MBUTTONDOWN
; A second click on the same spot soon after the first comes as a double click.
OnMessage(0x203, StandinClick("left"))    ; WM_LBUTTONDBLCLK
OnMessage(0x206, StandinClick("right"))   ; WM_RBUTTONDBLCLK

window := Gui("+Resize -DPIScale", "OMB e2e stand-in: " name)
window.BackColor := "404040"
window.SetFont("s10 cC8C8C8", "Segoe UI")
window.AddText("x12 y10 w" (w - 24), "Open Macro Builder end-to-end test: stand-in window '" name "'")
window.OnEvent("Close", (*) => (StandinLog("close"), true))  ; logged, and the window stays
window.Show("x" x " y" y " w" w " h" h)
StandinLog("start " name " pid=" ProcessExist() " hwnd=" window.Hwnd)
