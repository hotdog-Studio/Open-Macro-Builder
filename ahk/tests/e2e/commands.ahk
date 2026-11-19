#Requires AutoHotkey v2.0
; Commands for the end-to-end test (powershell\tests\EndToEnd.Tests.ps1) only. The test starts the real
; macropad with this file included before ahk\main.ahk (AutoHotkey's /include switch), so the test's
; layout can put these on keys beside the shared commands. OMB_E2E_DIR names the run's folder.
; commands.ps1 beside this file has the same commands for the PowerShell macropad.

; A runtime error is written to the run's errors.log, which the test reads after every case, instead
; of opening a dialog that would stay on the screen.
OnError(E2eLogError)

E2eDir() {
    return EnvGet("OMB_E2E_DIR")
}

E2eLogError(Err, Mode) {
    try E2eWrite("errors.log", "error in " Err.What ": " Err.Message)
    return 1
}

; A line for the test, which reads these files while the macropad writes them. FileOpen shares reading
; and writing, as the test's reader does, so neither is refused when both have the file at the same
; moment. Not FileAppend: it shares nothing, and fails whenever the test is reading the file.
E2eWrite(File, Line) {
    f := FileOpen(E2eDir() "\" File, "a", "UTF-8-RAW")
    f.Write(Line "`n")
    f.Close()
}

/**
 * Writes the macro's name to marks.log: the test presses it until the macropad answers.
 * @param {Macro} Macro - Its name is written.
 */
E2eMark(Macro) {
    E2eWrite("marks.log", Macro.name)
}

/**
 * Ends the macropad, as its tray menu's Exit does.
 * @param {Macro} Macro - The macro object (not used).
 */
E2eExit(Macro) {
    ExitApp()
}

; ---- Helpers that no shared command calls with the arguments their fixes are about ----

E2eTestDir() {
    return E2eDir() "\E2E Test"
}

E2eLauncher() {
    return E2eDir() "\path\e2eapp.exe"
}

/**
 * The script helpers, with arguments a command line could break: an &, several arguments, none, and
 * 0. One at a time, two seconds apart, so that their console windows do not flash.
 * @param {Macro} Macro - The macro object (not used).
 */
E2eRunScripts(Macro) {
    dir := E2eTestDir()
    RunPythonScript(dir "\write.py", "--quick a&b")
    Sleep(2000)
    RunPowerShellScript(dir "\write.ps1", "-A one two")
    Sleep(2000)
    RunPowerShellScript(dir "\write.ps1")
    Sleep(2000)
    RunBatchScript(dir "\args.bat", "one two three many")
    Sleep(2000)
    RunBatchScript(dir "\args.bat", "0")
    E2eWrite("marks.log", "scripts started")
}

/**
 * An & in the arguments of a program reaches the program.
 * @param {Macro} Macro - The macro object (not used).
 */
E2eAmpersand(Macro) {
    ActivateOrOpen("ahk_exe e2e-never.exe", "pythonw", "-c `"open(r'" E2eTestDir() "\amp.txt','w').write('a&b')`"")
    E2eWrite("marks.log", "ampersand done")
}

/**
 * A program whose path has spaces, with an argument in quotes that has a space.
 * @param {Macro} Macro - The macro object (not used).
 */
E2eOpenSpaces(Macro) {
    ActivateOrOpen("ahk_exe e2e app.exe", E2eTestDir() "\e2e app.exe", '"' E2eTestDir() '\note a.txt"')
    E2eWrite("marks.log", "spaces done")
}

/**
 * EnsureActiveOrOpen, called with two arguments (Args left out), says whether the window is active at
 * the end, as its PowerShell twin does.
 * @param {Macro} Macro - The macro object (not used).
 */
E2eEnsureActive(Macro) {
    r := EnsureActiveOrOpen("ahk_exe e2eapp.exe", E2eLauncher())
    E2eWrite("marks.log", "ensure " r)
}

/**
 * Open, ActivateOrOpen and EnsureActiveOrOpen with a program that shows no window, as in the
 * PowerShell twin: no error, nothing activated, and EnsureActiveOrOpen says 0.
 * @param {Macro} Macro - The macro object (not used).
 */
E2eNeverAppears(Macro) {
    Open("ahk_exe e2e-never.exe", E2eLauncher(), "--no-window")
    ActivateOrOpen("ahk_exe e2e-never.exe", E2eLauncher(), "--no-window")
    r := EnsureActiveOrOpen("ahk_exe e2e-never.exe", E2eLauncher(), "--no-window")
    E2eWrite("marks.log", "never " r)
}

/**
 * ActivateOrOpen brings the top window of the program forward, then the bottom one. The mark says
 * that it has returned: the test waits for it before it presses the key again, since AutoHotkey
 * ignores a key whose earlier press is still being handled.
 * @param {Macro} Macro - The macro object (not used).
 */
E2eStep(Macro) {
    ActivateOrOpen("ahk_exe e2eapp.exe", E2eLauncher())
    E2eWrite("marks.log", "step done")
}

/**
 * Chrome gets an address with & in it whole, and comes forward after it was started.
 * @param {Macro} Macro - The macro object (not used).
 */
E2eChromeUrl(Macro) {
    ActivateOrOpenChrome("https://example.com/?a=1&b=2")
}
