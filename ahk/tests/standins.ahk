#Requires AutoHotkey v2.0
; Stand-ins for the built-in functions that act on the desktop or wait, for check scripts that call
; the commands and helpers of ahk\commands. A script function hides the built-in of the same name,
; so with this file included Run, Send, WinActivate and the rest only record their call and return
; a value the check chose. Nothing starts, no key is sent, no window moves.
;
; A check script includes this file and the command files it needs, calls CheckProveStandIns()
; first, then for each case: CheckReturn() the values the stand-ins give, call the function, and
; CheckCase("name") to print the calls it made. CheckDone() writes everything to stdout and exits.
; powershell\tests\AhkCommands.Tests.ps1 runs the checks and compares the lines. It also fails when
; an included command file uses a built-in that acts and has no stand-in here.

global CheckCalls := []        ; one entry per call, such as 'Run|"notepad"'
global CheckResults := Map()   ; stand-in name -> the values it returns, in order; the last one repeats
global CheckOutput := ""

; The values the stand-in Name returns, one per call; the last one is given again after that.
CheckReturn(Name, Values*) {
    global CheckResults
    CheckResults[Name] := Values
}

CheckNext(Name, Default) {
    global CheckResults
    if !CheckResults.Has(Name) || CheckResults[Name].Length = 0
        return Default
    values := CheckResults[Name]
    return values.Length > 1 ? values.RemoveAt(1) : values[1]
}

CheckRecord(Text) {
    global CheckCalls
    CheckCalls.Push(Text)
}

CheckCallsText() {
    global CheckCalls
    text := ""
    for call in CheckCalls
        text .= (text = "" ? "" : " `; ") call
    return text
}

CheckReset() {
    global CheckCalls, CheckResults
    CheckCalls := []
    CheckResults := Map()
}

; Adds the line "Name=Value" to the output.
CheckPrint(Name, Value) {
    global CheckOutput
    CheckOutput .= Name "=" Value "`n"
}

; Prints the calls the case made as "Name=call ; call", then starts the next case afresh.
CheckCase(Name) {
    CheckPrint(Name, CheckCallsText())
    CheckReset()
}

CheckDone() {
    global CheckOutput
    FileAppend(CheckOutput, "*")
    ExitApp(0)
}

; Proves that each stand-in hides its built-in before a check calls anything that acts. Every call
; here would fail or do nothing if it reached the built-in (no such program, window or DLL, and an
; empty Send), so the proof itself cannot act. MsgBox is not called: the built-in would show a box.
CheckProveStandIns() {
    Run("macropad-check-no-such-program.exe")
    Send("")
    WinExist("ahk_exe macropad-check-none.exe")
    WinWait("ahk_exe macropad-check-none.exe",, 0.01)
    WinActivate("ahk_exe macropad-check-none.exe")
    WinActivateBottom("ahk_exe macropad-check-none.exe")
    GroupAdd("MacropadCheckGroup", "ahk_exe macropad-check-none.exe")
    WinGetList("ahk_exe macropad-check-none.exe")
    DllCall("macropad_check_none\Fn")
    SendMessage(0x0, 0, 0,, "ahk_exe macropad-check-none.exe")
    Sleep(0)
    expected := "Run|macropad-check-no-such-program.exe `; Send| `; WinExist|ahk_exe macropad-check-none.exe"
        . " `; WinWait|ahk_exe macropad-check-none.exe|0.01 `; WinActivate|ahk_exe macropad-check-none.exe"
        . " `; WinActivateBottom|ahk_exe macropad-check-none.exe `; GroupAdd|MacropadCheckGroup|ahk_exe macropad-check-none.exe"
        . " `; WinGetList|ahk_exe macropad-check-none.exe `; DllCall|macropad_check_none\Fn"
        . " `; SendMessage|0|ahk_exe macropad-check-none.exe `; Sleep|0"
    if (CheckCallsText() != expected) {
        FileAppend("The stand-ins do not hide the built-ins: " CheckCallsText() "`n", "*")
        ExitApp(3)
    }
    CheckReset()
}

Run(Target, WorkingDir := "", Options := "", &OutputVarPID := 0) {
    CheckRecord("Run|" Target)
    return 0
}

Send(Keys) {
    CheckRecord("Send|" Keys)
}

WinExist(WinTitle := "", WinText := "", ExcludeTitle := "", ExcludeText := "") {
    CheckRecord("WinExist|" WinTitle)
    return CheckNext("WinExist", 0)
}

; Not recorded: commands ask it often, and it changes nothing.
WinActive(WinTitle := "", WinText := "", ExcludeTitle := "", ExcludeText := "") {
    return CheckNext("WinActive", 0)
}

WinWait(WinTitle := "", WinText := "", Timeout := "", ExcludeTitle := "", ExcludeText := "") {
    CheckRecord("WinWait|" WinTitle "|" Timeout)
    return CheckNext("WinWait", 0)
}

WinActivate(WinTitle := "", WinText := "", ExcludeTitle := "", ExcludeText := "") {
    CheckRecord("WinActivate|" WinTitle)
}

WinActivateBottom(WinTitle := "", WinText := "", ExcludeTitle := "", ExcludeText := "") {
    CheckRecord("WinActivateBottom|" WinTitle)
}

GroupAdd(GroupName, WinTitle := "", WinText := "", ExcludeTitle := "", ExcludeText := "") {
    CheckRecord("GroupAdd|" GroupName "|" WinTitle)
}

WinGetList(WinTitle := "", WinText := "", ExcludeTitle := "", ExcludeText := "") {
    CheckRecord("WinGetList|" WinTitle)
    return CheckNext("WinGetList", [])
}

DllCall(DllFunction, Args*) {
    CheckRecord("DllCall|" DllFunction)
    return CheckNext("DllCall", 1)
}

SendMessage(Msg, wParam := 0, lParam := 0, Control := "", WinTitle := "", Rest*) {
    CheckRecord("SendMessage|" Msg "|" WinTitle)
    return 0
}

Sleep(Delay) {
    CheckRecord("Sleep|" Delay)
}

MsgBox(Text := "", Title := "", Options := "") {
    CheckRecord("MsgBox|" Text "|" Title)
    return "OK"
}
