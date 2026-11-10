#Requires AutoHotkey v2.0
#NoTrayIcon
; Schedules a delayed key through commands\custom\automation.ahk twice: once on its own, and once
; followed by opening the form again, which must cancel it. The key is vkE9, which types nothing.
; powershell\tests\Automation.Tests.ps1 counts the sends with a keyboard hook and expects one.
#Include ..\commands\custom\automation.ahk

ShowDelayedKeyForm(0)
AutomationKey.Value := "{vkE9}"
AutomationDelay.Value := "150"
AutomationSchedule()
Sleep(800)

ShowDelayedKeyForm(0)
AutomationKey.Value := "{vkE9}"
AutomationDelay.Value := "150"
AutomationSchedule()
ShowDelayedKeyForm(0)
Sleep(800)
FileAppend("done`n", "*")
ExitApp()
