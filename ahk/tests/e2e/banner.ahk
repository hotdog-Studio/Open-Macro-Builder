#Requires AutoHotkey v2.0
#SingleInstance Off
#NoTrayIcon
; The end-to-end test's banner (powershell\tests\EndToEnd.Tests.ps1). It shows one small, dark,
; always-on-top strip at the top of the main screen for the whole run, and never changes it. It never
; takes the focus and lets clicks through.
;
; It is also the run's watchdog, and it cleans up nothing itself: the only clean-up is the test's own
; (Clear-E2eLeftovers in powershell\tests\helpers\EndToEnd.ps1, which knows from the run's state file
; what is still the run's). When the test process is gone, it lets go of Shift, Ctrl, Alt, the Windows
; keys and F24 where they are still down, runs that clean-up (powershell\tests\run.ps1 -EndToEndCleanup,
; hidden), stays on the screen while it works, and exits after it. When the run's time limit has passed
; by a minute (five more once the test's own clean-up has begun: a "cleanup" line in the state file), it
; ends the test first, but only a test process started for run.ps1 (dedicated = 1): run inside a
; person's own console, that process is the console, and it is left alone.
;
;   AutoHotkey64.exe banner.ahk <test pid> <state file> <deadline, seconds since 1970 UTC> <dedicated 0|1>

testPid := Integer(A_Args[1])
stateFile := A_Args[2]
deadline := Integer(A_Args[3]) + 60
dedicated := A_Args.Length >= 4 && A_Args[4] = "1"
; A handle on the test process: while it is held, Windows gives its pid to no other process, and it
; says when the test has ended.
testHandle := DllCall("OpenProcess", "UInt", 0x00100001, "Int", 0, "UInt", testPid, "Ptr")  ; SYNCHRONIZE | PROCESS_TERMINATE
banner := Gui("+AlwaysOnTop -Caption +ToolWindow -DPIScale +E0x08000020", "Open Macro Builder end-to-end test")  ; WS_EX_NOACTIVATE | WS_EX_TRANSPARENT
banner.BackColor := "202020"
banner.MarginX := 14
banner.MarginY := 8
banner.SetFont("s10 bold cE6E6E6", "Segoe UI")
banner.AddText("w740", "Open Macro Builder end-to-end test: keyboard and mouse are in use")
banner.SetFont("s9 norm cC8C8C8", "Segoe UI")
banner.AddText("w740", "Photosensitivity warning: this test opens, moves and closes windows. Look away if flashing affects you.")
MonitorGetWorkArea(MonitorGetPrimary(), &left, &top, &right)
banner.Show("NoActivate x" (left + (right - left - 768) // 2) " y" top " w768 h56")

BannerUnixNow() {
    return DateDiff(A_NowUTC, "19700101000000", "Seconds")
}

BannerTestRuns() {
    global testHandle
    return testHandle && DllCall("WaitForSingleObject", "Ptr", testHandle, "UInt", 0, "UInt") = 258  ; WAIT_TIMEOUT
}

; True when the state file says that the run's own clean-up has begun.
BannerCleanupStarted() {
    global stateFile
    try {
        Loop Parse FileRead(stateFile, "UTF-8"), "`n", "`r"
            if (A_LoopField = "cleanup")
                return true
    }
    return false
}

BannerWatch() {
    global testHandle, deadline, dedicated
    static extended := false
    if BannerTestRuns() {
        if (!extended && BannerCleanupStarted()) {
            deadline += 300
            extended := true
        }
        if (!dedicated || BannerUnixNow() < deadline)
            return
        DllCall("TerminateProcess", "Ptr", testHandle, "UInt", 1)  ; past the time limit
        DllCall("WaitForSingleObject", "Ptr", testHandle, "UInt", 5000, "UInt")
        if BannerTestRuns()
            return
    }
    SetTimer(BannerWatch, 0)
    for key in ["Shift", "LShift", "RShift", "Ctrl", "LCtrl", "RCtrl", "Alt", "LAlt", "RAlt", "LWin", "RWin", "F24"]
        if GetKeyState(key)
            Send("{Blind}{" key " up}")
    runPs1 := A_ScriptDir "\..\..\..\powershell\tests\run.ps1"
    try RunWait('powershell.exe -NoProfile -ExecutionPolicy Bypass -File "' runPs1 '" -EndToEndCleanup', , "Hide")
    ExitApp()
}

SetTimer(BannerWatch, 500)