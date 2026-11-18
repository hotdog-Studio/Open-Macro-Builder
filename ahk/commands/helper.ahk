#Requires AutoHotkey v2.0

; ************************* Helper Functions *********************
/**
 * Activates the Window, or opens the Program when no such Window exists. When a matching window is already active, the bottom one comes forward instead, so pressing the key again steps through the program's windows.
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
        Run(ProgramCommandLine(Program, Args))
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
    Run(ProgramCommandLine(Program, Args))
    if WinWait(Window,,5)  ; 0 when no window appeared in 5 seconds
        WinActivate  ; the window WinWait found
}

/**
 * Ensures a Program is running and its Window is active.
 * @param {String} Window - The Window to check for: a window title, or a string such as "ahk_exe notepad.exe" that names the program.
 * @param {String} Program - The Program to run if the Window does not exist.
 * @param {String} [Args=""] - Text that follows the Program on its command line, as given, such as several arguments or a web address. Put a path with spaces in double quotes.
 * @example EnsureActiveOrOpen("ahk_exe notepad.exe", "notepad")
 */
EnsureActiveOrOpen(Window, Program, Args := "")
{
   ; check if Window exists
   if WinExist(Window)
	{
		if !WinActive(Window) {
            WinActivate  ; Uses the last found Window.
        }
	}
	else
	{   ; else start requested Program
        Run(ProgramCommandLine(Program, Args))
        if WinWait(Window,,5) && !WinActive(Window)  ; WinWait gives 0 when no window appeared in 5 seconds
            WinActivate  ; the window WinWait found
	}
	return
}

/**
 * Runs a Python script with optional arguments: python, then the script's path in double quotes (spaces in it are fine), then Args.
 * @param {String} ScriptPath - The path to the Python script.
 * @param {String} [Args=""] - Text that follows the script's path on its command line, as given. Put a path with spaces in double quotes.
 * @example RunPythonScript("C:\Scripts\backup.py")
 */
RunPythonScript(ScriptPath, Args := "")
{
    Run(ScriptCommandLine("python", ScriptPath, Args))
}

/**
 * Runs a PowerShell script with optional arguments: Windows PowerShell without the user's profile and with the execution policy bypassed (unless Group Policy sets one), then the script's path in double quotes, then Args.
 * @param {String} ScriptPath - The path to the PowerShell script.
 * @param {String} [Args=""] - Text that follows the script's path on its command line, as given. Put a path with spaces in double quotes.
 * @example RunPowerShellScript("C:\Scripts\cleanup.ps1")
 */
RunPowerShellScript(ScriptPath, Args := "")
{
    Run(ScriptCommandLine("powershell -NoProfile -ExecutionPolicy Bypass -File", ScriptPath, Args))
}

/**
 * Runs a batch script with optional arguments.
 * @param {String} ScriptPath - The path to the batch script.
 * @param {String} [Args=""] - Text that follows the script's path on its command line, as given. Put a path with spaces in double quotes.
 * @example RunBatchScript("C:\Scripts\build.bat")
 */
RunBatchScript(ScriptPath, Args := "")
{
    Run(ProgramCommandLine(ScriptPath, Args))
}

/**
 * The command line that starts a program: its name or path in double quotes, then Args as given. The helpers that start programs run it.
 * @param {String} Program - A program name such as "notepad", or the full path of a file; spaces are fine.
 * @param {String} [Args=""] - Text that follows on the command line, as given. Put a path with spaces in double quotes.
 * @returns {String} The command line.
 * @example ProgramCommandLine("chrome.exe", "--new-window https://example.com/")
 */
ProgramCommandLine(Program, Args := "")
{
    return '"' Program '"' (Args != "" ? " " Args : "")
}

/**
 * The command line that runs a script: the interpreter, the script's path in double quotes, then Args as given.
 * @param {String} Interpreter - The program and its options, such as "python".
 * @param {String} ScriptPath - The path of the script; spaces are fine.
 * @param {String} [Args=""] - Text that follows the path on the command line, as given.
 * @returns {String} The command line.
 * @example ScriptCommandLine("python", "C:\Scripts\backup.py", "--quick")
 */
ScriptCommandLine(Interpreter, ScriptPath, Args := "")
{
    return Interpreter ' "' ScriptPath '"' (Args != "" ? " " Args : "")
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

/**
 * Encodes an integer value into a memory location.
 * @param {Uint} Ref - The reference to the memory location.
 * @param {Uint} Val - The integer value to encode.
 * @returns {Uint} The result of the DllCall operation.
 */
EncodeInteger(Ref, Val)
{
	return DllCall("ntdll\RtlFillMemoryUlong", "Uint", ref, "Uint", 4, "Uint", val)
}