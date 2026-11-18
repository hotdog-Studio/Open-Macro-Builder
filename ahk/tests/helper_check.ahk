#Requires AutoHotkey v2.0
#NoTrayIcon
; Checks ahk\commands\helper.ahk with the stand-ins of standins.ahk, so nothing starts or moves.
; powershell\tests\AhkCommands.Tests.ps1 runs it and compares each printed line.
#Include standins.ahk
#Include ..\commands\helper.ahk

CheckProveStandIns()

; The command lines the helpers build.
CheckPrint("program", ProgramCommandLine("notepad"))
CheckPrint("program with arguments", ProgramCommandLine("chrome.exe", "--new-window https://x.test/?a=1&b=2"))
CheckPrint("program with spaces", ProgramCommandLine("C:\Program Files\My App\app.exe", '--open "C:\My Files\a.txt"'))
CheckPrint("program with 0", ProgramCommandLine("C:\My Scripts\build.bat", "0"))
CheckPrint("python", ScriptCommandLine("python", "C:\My Scripts\backup.py"))
CheckPrint("python with arguments", ScriptCommandLine("python", "C:\My Scripts\backup.py", "--quick --to D:\x&y"))

; What the helpers run.
RunPythonScript("C:\My Scripts\backup.py")
CheckCase("RunPythonScript")
RunPythonScript("C:\My Scripts\backup.py", "--quick")
CheckCase("RunPythonScript with arguments")
RunPowerShellScript("C:\My Scripts\cleanup.ps1")
CheckCase("RunPowerShellScript")
RunPowerShellScript("C:\My Scripts\cleanup.ps1", "-Force")
CheckCase("RunPowerShellScript with arguments")
RunBatchScript("C:\My Scripts\build.bat", "0")
CheckCase("RunBatchScript")
; The @example lines of the helpers, as written in their doc blocks.
RunPythonScript("C:\Scripts\backup.py")
CheckCase("RunPythonScript example")
RunPowerShellScript("C:\Scripts\cleanup.ps1")
CheckCase("RunPowerShellScript example")
RunBatchScript("C:\Scripts\build.bat")
CheckCase("RunBatchScript example")

CheckReturn("WinWait", 1)
ActivateOrOpen("ahk_exe macropad-check.exe", "macropad-check.exe", "--a --b https://x.test/?a=1&b=2")
CheckCase("ActivateOrOpen starts")
CheckReturn("WinWait", 1)
Open("ahk_exe macropad-check.exe", "C:\Program Files\Macropad Check\check.exe", "--a")
CheckCase("Open starts")
CheckReturn("WinWait", 1)
EnsureActiveOrOpen("ahk_exe macropad-check.exe", "macropad-check.exe", "0")
CheckCase("EnsureActiveOrOpen starts")

CheckDone()
