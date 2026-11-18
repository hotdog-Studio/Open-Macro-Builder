#Requires AutoHotkey v2.0
#SingleInstance Off
#NoTrayIcon
; The end-to-end test's banner (powershell\tests\EndToEnd.Tests.ps1). It shows one small, dark,
; always-on-top strip at the top of the main screen for the whole run, and never changes it. It never
; takes the focus and lets clicks through.
;
; It is also the run's watchdog: when the test process is gone, or the run's time limit has passed
; by a minute, it carries out the clean-up the test left in its state file and exits. The file has
; one instruction per line:
;   kill <pid> <exe name>     end that process, if it still runs under that name
;   killdir <folder>          end every process whose program is in that folder (the run's own)
;   window <handle>           close that window (one a command opened)
;   run <exe>TAB<args>TAB<dir> start this, in that folder (a macropad the test stopped)
; It also lets go of Shift, Ctrl, Alt, the Windows keys and F24 where they are still down. The test's
; own clean-up (Clear-E2eLeftovers in powershell\tests\helpers\EndToEnd.ps1) does the same and also
; closes virtual desktops a run added; Jenkins runs it after every end-to-end stage.
;
;   AutoHotkey64.exe banner.ahk <test pid> <state file> <deadline, seconds since 1970 UTC>

testPid := Integer(A_Args[1])
stateFile := A_Args[2]
deadline := Integer(A_Args[3]) + 60

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

BannerWatch() {
    global testPid, deadline
    if (ProcessExist(testPid) && BannerUnixNow() < deadline)
        return
    SetTimer(BannerWatch, 0)
    BannerCleanUp()
    ExitApp()
}

BannerCleanUp() {
    global stateFile
    if !FileExist(stateFile)
        return
    runs := []
    Loop Parse FileRead(stateFile, "UTF-8"), "`n", "`r" {
        if RegExMatch(A_LoopField, "^kill (\d+) (\S+)$", &m) {
            try {
                if (ProcessExist(m[1]) && StrLower(ProcessGetName(Integer(m[1]))) = StrLower(m[2]))
                    ProcessClose(Integer(m[1]))
            }
        } else if RegExMatch(A_LoopField, "^killdir (.+)$", &m) {
            for p in ComObjGet("winmgmts:").ExecQuery("Select ProcessId, ExecutablePath from Win32_Process") {
                try {
                    if (p.ExecutablePath != "" && InStr(p.ExecutablePath, RTrim(m[1], "\") "\") = 1)
                        ProcessClose(p.ProcessId)
                }
            }
        } else if RegExMatch(A_LoopField, "^window (\d+)$", &m) {
            try WinClose("ahk_id " m[1])
        } else if RegExMatch(A_LoopField, "^run ([^\t]+)\t([^\t]*)\t(.*)$", &m) {
            runs.Push(m)
        }
    }
    for key in ["Shift", "LShift", "RShift", "Ctrl", "LCtrl", "RCtrl", "Alt", "LAlt", "RAlt", "LWin", "RWin", "F24"]
        if GetKeyState(key)
            Send("{Blind}{" key " up}")
    Sleep(500)
    for m in runs  ; a console program (powershell.exe) starts hidden; AutoHotkey shows its own windows
        try Run('"' m[1] '" ' m[2], m[3], InStr(m[1], "powershell.exe") ? "Hide" : "")
    ; The run's folder (the state file is in it) goes last.
    SplitPath(stateFile, , &runDir)
    try DirDelete(runDir, true)
}

SetTimer(BannerWatch, 500)
