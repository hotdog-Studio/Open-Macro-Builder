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
;
; No event may be lost or change places, however slow the machine is. AutoHotkey treats a message
; that arrives while its function still runs for an earlier message of the same number as
; unmonitored, and lets the function of another message interrupt it
; (https://www.autohotkey.com/docs/v2/lib/OnMessage.htm). A function that wrote to the file itself
; ran long enough for both on a slow machine: the second key of a chord lost its "down", and lines
; changed places. So a function here only puts its line in a list, as a thread nothing interrupts
; (Critical on its first line, with an interval in which AutoHotkey looks at no other message: the
; next one waits in the window's queue, in its order), and a timer writes the list to the file.

logFile := A_Args[1]
; It works where its log is, in the run's folder: not in this script's folder, which is AutoHotkey's
; default and lies in the checkout. Nothing of a run works there, so nothing that outlives a run can
; keep a Jenkins workspace from being removed.
SplitPath(logFile, , &logDir)
SetWorkingDir(logDir)
name := A_Args.Length >= 2 ? A_Args[2] : "stand-in"
x := A_Args.Length >= 3 ? A_Args[3] : 40
y := A_Args.Length >= 4 ? A_Args[4] : 120
w := A_Args.Length >= 5 ? A_Args[5] : 420
h := A_Args.Length >= 6 ? A_Args[6] : 160
pending := []  ; the lines not yet taken by the writer, in the order of their events
unwritten := ""  ; what the writer has taken and could not write yet

StandinLog(Line) {
    global pending
    pending.Push(Line)
}

; Writes what has come since the last time. FileOpen shares reading and writing, as the test's reader
; does, so neither is refused when both have the file at the same moment (FileAppend shares nothing).
; Should the file not open all the same, the text is kept and goes out with the next tick, before
; anything newer.
StandinWrite() {
    global pending, unwritten, logFile
    taken := pending, pending := []
    for line in taken
        unwritten .= line "`n"
    if (unwritten = "")
        return
    try {
        f := FileOpen(logFile, "a", "UTF-8-RAW")
        f.Write(unwritten)
        f.Close()
        unwritten := ""
    }
}

StandinMods() {
    mods := (GetKeyState("Ctrl") ? "C" : "") (GetKeyState("Shift") ? "S" : "") (GetKeyState("Alt") ? "A" : "")
        (GetKeyState("LWin") || GetKeyState("RWin") ? "W" : "")
    return mods = "" ? "-" : mods
}

StandinKey(wParam, lParam, msg, hwnd) {
    Critical(1000)
    if ((wParam & 0xFF) = 0xE7)  ; VK_PACKET, a typed character: let Windows turn it into WM_CHAR
        return
    up := (msg = 0x101 || msg = 0x105)
    StandinLog((up ? "up" : "down") " vk=" Format("{:02X}", wParam & 0xFF) " sc=" Format("{:03X}", (lParam >> 16) & 0x1FF)
        " repeat=" ((!up && (lParam >> 30) & 1) ? 1 : 0) " mods=" StandinMods())
    return 0
}

StandinClick(button, wParam, lParam, msg, hwnd) {
    Critical(1000)
    StandinLog("click " button " " (lParam & 0xFFFF) " " ((lParam >> 16) & 0xFFFF))
    return 0
}

StandinChar(wParam, lParam, msg, hwnd) {
    Critical(1000)
    StandinLog("char " Format("{:04X}", wParam))
    return 0
}

for message in [0x100, 0x101, 0x104, 0x105]  ; WM_KEYDOWN, WM_KEYUP, WM_SYSKEYDOWN, WM_SYSKEYUP
    OnMessage(message, StandinKey)
OnMessage(0x102, StandinChar)  ; WM_CHAR, made only from typed characters (VK_PACKET)
OnMessage(0x201, StandinClick.Bind("left"))    ; WM_LBUTTONDOWN
OnMessage(0x204, StandinClick.Bind("right"))   ; WM_RBUTTONDOWN
OnMessage(0x207, StandinClick.Bind("middle"))  ; WM_MBUTTONDOWN
; A second click on the same spot soon after the first comes as a double click.
OnMessage(0x203, StandinClick.Bind("left"))    ; WM_LBUTTONDBLCLK
OnMessage(0x206, StandinClick.Bind("right"))   ; WM_RBUTTONDBLCLK

window := Gui("+Resize -DPIScale", "OMB e2e stand-in: " name)
window.BackColor := "404040"
window.SetFont("s10 cC8C8C8", "Segoe UI")
window.AddText("x12 y10 w" (w - 24), "Open Macro Builder end-to-end test: stand-in window '" name "'")
window.OnEvent("Close", (*) => (StandinLog("close"), true))  ; logged, and the window stays
window.Show("x" x " y" y " w" w " h" h)
StandinLog("start " name " pid=" ProcessExist() " hwnd=" window.Hwnd)
SetTimer(StandinWrite, 15)
