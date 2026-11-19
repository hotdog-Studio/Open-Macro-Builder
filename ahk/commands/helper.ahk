#Requires AutoHotkey v2.0

; ************************* Helper Functions *********************
/**
 * Activates the Window, or opens the Program when no such Window exists. When a matching window is already active, the bottom one comes forward instead, so pressing the key again steps through the program's windows. After starting the Program it waits up to 5 seconds for the Window to appear and activates it; if none appears in that time, nothing is activated.
 * @param {String} Window - The Window to check for: a window title, or a string such as "ahk_exe notepad.exe" that names the program.
 * @param {String} Program - The Program to run if the Window does not exist.
 * @param {String} [Args=""] - Text that follows the Program on its command line, as given, such as several arguments or a web address. Put a path with spaces in double quotes.
 * @example ActivateOrOpen("ahk_exe notepad.exe", "notepad")
 */
ActivateOrOpen(Window, Program, Args := "")
{
   ; check if Window exists
   if WinExist(Window)
	{
		if WinActive(Window) {
            WinActivateBottom Window ; Uses the last found Window.
        }
        else {
            WinActivate  ; Uses the last found Window.
        }
	}
	else
	{   ; else start requested Program
        Run('"' Program '"' (Args != "" ? " " Args : ""))
        if WinWait(Window,,5)  ; 0 when no window appeared in 5 seconds
        {
            if WinActive(Window) {
                WinActivateBottom Window
            }
            else {
                WinActivate  ; the window WinWait found
            }
        }
	}
	return
}

/**
 * Opens a Program and activates its Window once it appears. If no window appears within 5 seconds, nothing is activated.
 * @param {String} Window - The Window to wait for: a window title, or a string such as "ahk_exe notepad.exe" that names the program.
 * @param {String} Program - The Program to run.
 * @param {String} [Args=""] - Text that follows the Program on its command line, as given, such as several arguments or a web address. Put a path with spaces in double quotes.
 * @example Open("ahk_exe notepad.exe", "notepad")
 */
Open(Window, Program, Args := "")
{
    Run('"' Program '"' (Args != "" ? " " Args : ""))
    if WinWait(Window,,5)  ; 0 when no window appeared in 5 seconds
        WinActivate  ; the window WinWait found
}

/**
 * Makes the Window active, first starting the Program when no such window exists.
 * @param {String} Window - The Window to check for: a window title, or a string such as "ahk_exe notepad.exe" that names the program.
 * @param {String} Program - The Program to run if the Window does not exist.
 * @param {String} [Args=""] - Text that follows the Program on its command line, as given, such as several arguments or a web address. Put a path with spaces in double quotes.
 * @returns {Boolean} True when a matching window is the active window at the end; false when no window appeared within 5 seconds or Windows did not let it come to the front. Check it before sending keys.
 * @example EnsureActiveOrOpen("ahk_exe notepad.exe", "notepad")
 */
EnsureActiveOrOpen(Window, Program, Args := "")
{
   ; check if Window exists
   if !WinExist(Window)
	{   ; start requested Program
        Run('"' Program '"' (Args != "" ? " " Args : ""))
        if !WinWait(Window,,5)  ; 0 when no window appeared in 5 seconds
            return false
	}
	if !WinActive(Window)
        WinActivate  ; the window WinExist or WinWait found
	return WinActive(Window) != 0
}

/**
 * Activates the window of an app that Windows shows in its app frame, or opens the Program when the app has no window. It is ActivateOrOpen for an app such as Settings or Calculator: its window belongs to ApplicationFrameHost.exe, not to the app's own program, and its title is translated, so the window is found by the app's application id, which is the same in every display language. It finds no other kind of window: a program that has a window of its own, such as Notepad, Paint or Terminal on Windows 11, is not found by its application id, although Get-StartApps lists one for it. For those use ActivateOrOpen with "ahk_exe" and the program's name. (Window Spy shows which program a window belongs to.) When one of the app's windows is already active, the bottom one comes forward instead, so pressing the key again steps through them. If no window appears within 5 seconds of starting the Program, nothing is activated.
 * @param {String} AppId - The app's application id, such as "Microsoft.WindowsCalculator_8wekyb3d8bbwe!App". In PowerShell, Get-StartApps lists the name and the application id of every installed app.
 * @param {String} Program - The Program to run if the app has no window: a program such as "calc.exe", or an address that opens the app, such as "ms-settings:".
 * @param {String} [Args=""] - Text that follows the Program on its command line, as given.
 * @example ActivateOrOpenApp("Microsoft.WindowsCalculator_8wekyb3d8bbwe!App", "calc.exe")
 */
ActivateOrOpenApp(AppId, Program, Args := "")
{
    frames := AppFrames()
    if (frames.Length = 0)
    {   ; start the requested Program and give its window 5 seconds
        Run('"' Program '"' (Args != "" ? " " Args : ""))
        started := A_TickCount
        while (frames.Length = 0 && A_TickCount - started < 5000)
        {
            Sleep(100)
            frames := AppFrames()
        }
        if (frames.Length = 0)
            return
    }
    ; the topmost of the app's windows, or the bottom one when one of them is already active
    target := frames[1]
    for frame in frames
        if WinActive("ahk_id " frame)
            target := frames[frames.Length]
    WinActivate("ahk_id " target)

    ; The app's windows, topmost first: the frame windows that carry its application id. Visible ones
    ; only: WinGetList does not see hidden windows while DetectHiddenWindows is off, which is
    ; AutoHotkey's default and nothing in these scripts changes. That is what keeps a closed frame that
    ; the app still keeps, hidden, for a moment from being picked (the PowerShell twin, Get-AppWindow,
    ; is pinned by a test in Window.Tests.ps1). A script that turns DetectHiddenWindows on would let
    ; such a frame be picked.
    AppFrames()
    {
        found := []
        for candidate in WinGetList("ahk_class ApplicationFrameWindow")
            if (FrameAppId(candidate) = AppId)
                found.Push(candidate)
        return found
    }

    ; The application id Windows keeps for a window (its property System.AppUserModel.ID), or "".
    FrameAppId(Hwnd)
    {
        static iid := Buffer(16), key := Buffer(20), ready := false
        if !ready
        {
            DllCall("ole32\CLSIDFromString", "Str", "{886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99}", "Ptr", iid)  ; IPropertyStore
            DllCall("ole32\CLSIDFromString", "Str", "{9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3}", "Ptr", key)  ; System.AppUserModel.ID
            NumPut("UInt", 5, key, 16)
            ready := true
        }
        if DllCall("shell32\SHGetPropertyStoreForWindow", "Ptr", Hwnd, "Ptr", iid, "Ptr*", &store := 0, "Int") != 0 || !store
            return ""
        value := Buffer(24, 0)
        id := ""
        if ComCall(5, store, "Ptr", key, "Ptr", value, "Int") = 0 && NumGet(value, 0, "UShort") = 31  ; IPropertyStore::GetValue, VT_LPWSTR
            id := StrGet(NumGet(value, 8, "Ptr"), "UTF-16")
        DllCall("ole32\PropVariantClear", "Ptr", value)
        ObjRelease(store)
        return id
    }
}

/**
 * Runs a Python script with optional arguments: python, then the script's path in double quotes (spaces in it are fine), then Args.
 * @param {String} ScriptPath - The path to the Python script.
 * @param {String} [Args=""] - Text that follows the script's path on its command line, as given. Put a path with spaces in double quotes.
 * @example RunPythonScript("C:\Scripts\backup.py")
 */
RunPythonScript(ScriptPath, Args := "")
{
    Run('python "' ScriptPath '"' (Args != "" ? " " Args : ""))
}

/**
 * Runs a PowerShell script with optional arguments: Windows PowerShell without the user's profile and with the execution policy bypassed (unless Group Policy sets one), then the script's path in double quotes, then Args.
 * @param {String} ScriptPath - The path to the PowerShell script.
 * @param {String} [Args=""] - Text that follows the script's path on its command line, as given. Put a path with spaces in double quotes.
 * @example RunPowerShellScript("C:\Scripts\cleanup.ps1")
 */
RunPowerShellScript(ScriptPath, Args := "")
{
    Run('powershell -NoProfile -ExecutionPolicy Bypass -File "' ScriptPath '"' (Args != "" ? " " Args : ""))
}

/**
 * Runs a batch script with optional arguments.
 * @param {String} ScriptPath - The path to the batch script.
 * @param {String} [Args=""] - Text that follows the script's path on its command line, as given. Put a path with spaces in double quotes.
 * @example RunBatchScript("C:\Scripts\build.bat")
 */
RunBatchScript(ScriptPath, Args := "")
{
    Run('"' ScriptPath '"' (Args != "" ? " " Args : ""))
}

/**
 * Displays a message box with the macro's name and description.
 * @param {Macro} Macro - The macro object containing name and description properties.
 */
Message(Macro)
{
   MsgBox(Macro.description, Macro.name)
}

/**
 * Function to let the user know this is still default from the template.
 * @param {Macro} Macro - The macro object (not used in this function).
 */
ReplaceMe(Macro)
{
   MsgBox("Replace " Macro.name " with your own!", Macro.name)
}
