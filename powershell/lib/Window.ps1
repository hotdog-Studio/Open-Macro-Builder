# Programs and their windows
# Finding, starting and activating program windows by executable name
# ($Exe plays the part of AHK's "ahk_exe X").

<#
.SYNOPSIS
Lists the visible windows of a program, topmost first.
.DESCRIPTION
Finds every running process whose executable name is Exe (the macropad's own process is left out) and returns each of their visible top-level windows, the one on top of the screen first. A program with no visible window gives an empty list.
.PARAMETER Exe
The program's executable name as Task Manager shows it, such as 'chrome.exe'. The '.exe' ending may be left off, and the case does not matter.
.OUTPUTS
A list of window handles, topmost first; empty when the program has no visible window. A window handle is the number Windows uses to name one window, and Set-ActiveWindow takes it.
.EXAMPLE
Get-ProcessWindow 'chrome.exe'
#>
function Get-ProcessWindow {
    param([Parameter(Mandatory)][string]$Exe)
    $name = $Exe -replace '\.exe$', ''
    $ids = @(Get-Process -Name $name -ErrorAction SilentlyContinue | Where-Object { $_.Id -ne $PID } | ForEach-Object { $_.Id })
    if ($ids.Count -eq 0) { return , ([IntPtr[]]@()) }
    , ([IntPtr[]][Macropad.Native]::GetProcessWindows([int[]]$ids))
}

<#
.SYNOPSIS
Lists the visible windows of an app shown in Windows' app frame, by its application id.
.DESCRIPTION
Some apps, such as Settings and Calculator, have their window shown by Windows in its app frame: the window belongs to ApplicationFrameHost.exe, not to the app's own program, and its title is translated. So Get-ProcessWindow does not find such a window, and a title fits one display language only. Windows keeps the app's application id on the frame, and that id is the same in every display language: this returns each visible frame window (class ApplicationFrameWindow) whose application id is AppId, the one on top of the screen first. It returns nothing for a program that has a window of its own, such as Notepad, Paint or Terminal on Windows 11, although Get-StartApps lists an id for it: Get-ProcessWindow finds those.
.PARAMETER AppId
The app's application id, such as 'Microsoft.WindowsCalculator_8wekyb3d8bbwe!App'. In PowerShell, Get-StartApps lists the name and the application id of every installed app. The case does not matter.
.OUTPUTS
A list of window handles, topmost first; empty when the app has no visible window. A window handle is the number Windows uses to name one window, and Set-ActiveWindow takes it.
.EXAMPLE
Get-AppWindow 'Microsoft.WindowsCalculator_8wekyb3d8bbwe!App'
#>
function Get-AppWindow {
    param([Parameter(Mandatory)][string]$AppId)
    , [IntPtr[]]@(foreach ($h in (Find-Window 'ahk_class ApplicationFrameWindow' -All)) { if ((Get-WindowAppId $h) -eq $AppId) { $h } })
}

<#
.SYNOPSIS
Picks which of a program's windows to bring to the front.
.DESCRIPTION
Gives the top window of the list, or the bottom one when one of the windows is already the active window, so that repeated presses step through all of a program's windows. This is what AutoHotkey's WinActivateBottom does. It only chooses; it does not activate anything.
.PARAMETER Windows
The program's window handles, topmost first, as Get-ProcessWindow returns them. A window handle is the number Windows uses to name one window.
.PARAMETER Foreground
The handle of the window that is active now. [Macropad.Native]::GetForegroundWindow() gives it.
.OUTPUTS
The handle of the chosen window, or nothing when the list is empty.
.EXAMPLE
$windows = Get-ProcessWindow 'chrome.exe'
Select-WindowToActivate $windows ([Macropad.Native]::GetForegroundWindow())
#>
function Select-WindowToActivate {
    param([IntPtr[]]$Windows, [IntPtr]$Foreground)
    if ($null -eq $Windows -or $Windows.Count -eq 0) { return $null }
    if ($Windows -contains $Foreground) { return $Windows[-1] }
    $Windows[0]
}

<#
.SYNOPSIS
Waits until a program has a visible window, up to a time limit.
.DESCRIPTION
Looks for the program's windows about ten times a second and returns as soon as it finds one (at once if it already has one). The macropad stays responsive while it waits. Use it after starting a program, before doing anything to its window.
.PARAMETER Exe
The program's executable name as Task Manager shows it, such as 'notepad.exe'.
.PARAMETER TimeoutSeconds
How many seconds to wait at most.
.OUTPUTS
The program's window handles, topmost first, or an empty list when no window appeared in time. A window handle is the number Windows uses to name one window.
.EXAMPLE
Start-Program 'notepad'
Wait-ProcessWindow 'notepad.exe'
.EXAMPLE
Wait-ProcessWindow 'notepad.exe' -TimeoutSeconds 10
#>
function Wait-ProcessWindow {
    param([Parameter(Mandatory)][string]$Exe, [int]$TimeoutSeconds = 5)
    $deadline = [DateTime]::Now.AddSeconds($TimeoutSeconds)
    do {
        $windows = Get-ProcessWindow $Exe
        if ($windows.Count -gt 0) { return , $windows }
        Wait-Pump 100
    } while ([DateTime]::Now -lt $deadline)
    , ([IntPtr[]]@())
}

<#
.SYNOPSIS
Brings one window to the front and gives it the keyboard.
.DESCRIPTION
Restores the window first if it is minimized. Windows sometimes refuses to let a program take the front, so this uses the usual workarounds, and then checks whether the window really is the active one.
.PARAMETER Hwnd
The window handle of the window to activate, such as one from Get-ProcessWindow. A window handle is the number Windows uses to name one window.
.OUTPUTS
True when the window is the active one afterwards, False when it is not (or the handle is zero).
.EXAMPLE
$windows = Get-ProcessWindow 'notepad.exe'
if ($windows.Count -gt 0) { Set-ActiveWindow $windows[0] }
#>
function Set-ActiveWindow {
    param([Parameter(Mandatory)][IntPtr]$Hwnd)
    [Macropad.Native]::ActivateWindow($Hwnd)
}

<#
.SYNOPSIS
Starts a program, with arguments if given, and does not wait for it.
.DESCRIPTION
Starts the program and carries on at once, without waiting for it to finish.
.PARAMETER Program
The program to start: a name such as 'notepad', or the full path of a file.
.PARAMETER Arguments
Text given to the program on its command line, as one string. Leave it out for none.
.EXAMPLE
Start-Program 'notepad'
.EXAMPLE
Start-Program 'explorer' -Arguments 'C:\Users\Public\Documents'
#>
function Start-Program {
    param([Parameter(Mandatory)][string]$Program, [string]$Arguments = '')
    if ($Arguments) { Start-Process -FilePath $Program -ArgumentList $Arguments }
    else { Start-Process -FilePath $Program }
}

<#
.SYNOPSIS
Brings a running program's window to the front, if it has one.
.DESCRIPTION
Activates the top window of the program, or the bottom one when one of its windows is already active, so repeated calls step through the program's windows. When the program has no visible window nothing happens and the result says so, which lets a command start the program instead.
.PARAMETER Exe
The program's executable name as Task Manager shows it, such as 'chrome.exe'.
.OUTPUTS
True when the program has a visible window and the switch to it was attempted; the result does not say whether Windows allowed it. False when the program has no visible window.
.EXAMPLE
Invoke-WindowActivation 'chrome.exe'
.EXAMPLE
if (-not (Invoke-WindowActivation 'notepad.exe')) { Start-Program 'notepad' }
#>
function Invoke-WindowActivation {
    param([Parameter(Mandatory)][string]$Exe)
    $windows = Get-ProcessWindow $Exe
    if ($windows.Count -eq 0) { return $false }
    $target = Select-WindowToActivate $windows ([Macropad.Native]::GetForegroundWindow())
    [void](Set-ActiveWindow $target)
    $true
}
