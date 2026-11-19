# Helper commands (ahk/commands/helper.ahk). $Exe replaces AHK's "ahk_exe X" window title.

<#
.SYNOPSIS
Brings a program's window forward, or starts the program if it has none.
.DESCRIPTION
Looks for a visible window of the program named by Exe. If it has one, that window is activated; when one of its windows is already active, the bottom one comes forward instead, so pressing the key again steps through the program's windows. If it has none, the program is started, up to 5 seconds are given for its window to appear, and the window is activated.
.PARAMETER Exe
The program's executable name as Task Manager shows it, such as 'chrome.exe'. It is how the program's windows are found.
.PARAMETER Program
What to start when the program has no window: a program name such as 'chrome', or the full path of a file.
.PARAMETER Arguments
Text given to the program on its command line when it is started, such as a web address. Not used when a window already exists.
.EXAMPLE
ActivateOrOpen 'chrome.exe' 'chrome'
.EXAMPLE
ActivateOrOpen 'chrome.exe' 'chrome' -Arguments 'https://example.com'
#>
function ActivateOrOpen {
    param([string]$Exe, [string]$Program, [string]$Arguments = '')
    if (-not (Invoke-WindowActivation $Exe)) {
        Start-Program $Program $Arguments
        [void](Wait-ProcessWindow $Exe 5)
        [void](Invoke-WindowActivation $Exe)
    }
}

<#
.SYNOPSIS
Brings forward a window that fits a WinTitle, or starts a program when none does.
.DESCRIPTION
ActivateOrOpen for windows that are found by title or class rather than by the program that starts them, such as a shell that Windows Terminal shows (its window belongs to WindowsTerminal.exe, whatever shell runs in it). When a window fits, the topmost one is activated; when one of them is already active, the bottom one comes forward instead, so pressing the key again steps through them. When none fits, the program is started, up to 5 seconds are given for a fitting window to appear, and it is activated. The macropad's own windows never count. A title fits one display language only: for an app that Windows shows in its app frame, such as Calculator or Settings, whose title is translated, use ActivateOrOpenApp.
.PARAMETER WinTitle
Describes the windows, as Find-Window reads it, such as 'Command Prompt ahk_exe WindowsTerminal.exe'. Give several to accept a window that fits any of them.
.PARAMETER Program
What to start when no window fits: a program name such as 'cmd', or the full path of a file.
.PARAMETER Arguments
Text given to the program on its command line when it is started. Not used when a window already fits.
.EXAMPLE
ActivateOrOpenWindow 'Command Prompt ahk_exe WindowsTerminal.exe' 'cmd'
.EXAMPLE
ActivateOrOpenWindow -WinTitle 'ahk_exe cmd.exe', 'Command Prompt ahk_exe WindowsTerminal.exe' -Program 'cmd'
#>
function ActivateOrOpenWindow {
    param([Parameter(Mandatory)][string[]]$WinTitle, [Parameter(Mandatory)][string]$Program, [string]$Arguments = '')
    $find = {
        # The macropad's own windows (its overlay and forms run in powershell.exe) never count.
        $fit = @(foreach ($title in $WinTitle) { foreach ($h in (Find-Window $title -All)) { if ((Get-WindowInfo $h).Pid -ne $PID) { $h } } })
        if ($WinTitle.Count -gt 1 -and $fit.Count -gt 1) {
            # Topmost first across all the WinTitles: every visible window, in the order they lie on the screen.
            $fit = @(foreach ($h in (Find-Window '' -All)) { if ($fit -contains $h) { $h } })
        }
        , [IntPtr[]]$fit
    }
    $windows = & $find
    if ($windows.Count -eq 0) {
        Start-Program $Program $Arguments
        for ($i = 0; $i -lt 50 -and $windows.Count -eq 0; $i++) {
            Wait-Pump 100
            $windows = & $find
        }
        if ($windows.Count -eq 0) { return }
    }
    # Test-WindowActive with no WinTitle gives the handle of the active window, whatever it is.
    [void](Set-ActiveWindow (Select-WindowToActivate $windows (Test-WindowActive)))
}

<#
.SYNOPSIS
Brings forward the window of an app shown in Windows' app frame, or starts the app.
.DESCRIPTION
ActivateOrOpen for an app whose window Windows shows in its app frame, such as Settings or Calculator. Such a window belongs to ApplicationFrameHost.exe, not to the app's own program, and its title is translated, so it is found by the app's application id, which is the same in every display language. It finds no other kind of window: a program that has a window of its own, such as Notepad, Paint or Terminal on Windows 11, is not found by its application id, although Get-StartApps lists one for it. For those use ActivateOrOpen with the program's name, or ActivateOrOpenWindow. (Get-WindowInfo says which program a window belongs to.) When the app has a window, the topmost one is activated; when one of them is already active, the bottom one comes forward instead, so pressing the key again steps through them. When it has none, the program is started, up to 5 seconds are given for a window of the app to appear, and it is activated.
.PARAMETER AppId
The app's application id, such as 'Microsoft.WindowsCalculator_8wekyb3d8bbwe!App'. In PowerShell, Get-StartApps lists the name and the application id of every installed app.
.PARAMETER Program
What to start when the app has no window: a program name such as 'calc.exe', or an address that opens the app such as 'ms-settings:'.
.PARAMETER Arguments
Text given to the program on its command line when it is started. Not used when the app already has a window.
.EXAMPLE
ActivateOrOpenApp 'Microsoft.WindowsCalculator_8wekyb3d8bbwe!App' 'calc.exe'
.EXAMPLE
ActivateOrOpenApp 'windows.immersivecontrolpanel_cw5n1h2txyewy!microsoft.windows.immersivecontrolpanel' 'ms-settings:'
#>
function ActivateOrOpenApp {
    param([Parameter(Mandatory)][string]$AppId, [Parameter(Mandatory)][string]$Program, [string]$Arguments = '')
    $windows = Get-AppWindow $AppId
    if ($windows.Count -eq 0) {
        Start-Program $Program $Arguments
        for ($i = 0; $i -lt 50 -and $windows.Count -eq 0; $i++) {
            Wait-Pump 100
            $windows = Get-AppWindow $AppId
        }
        if ($windows.Count -eq 0) { return }
    }
    [void](Set-ActiveWindow (Select-WindowToActivate $windows (Test-WindowActive)))
}
<#
.SYNOPSIS
Starts a program and brings its window to the front.
.DESCRIPTION
Starts the program every time, even when it is already running, then waits up to 5 seconds until the program has a visible window (at once if it already has one) and activates the topmost of its windows. If no window appears in time, nothing is activated.
.PARAMETER Exe
The program's executable name as Task Manager shows it, such as 'notepad.exe'. It is how the program's windows are found.
.PARAMETER Program
What to start: a program name such as 'notepad', or the full path of a file.
.PARAMETER Arguments
Text given to the program on its command line, such as a file to open.
.EXAMPLE
Open 'notepad.exe' 'notepad'
.EXAMPLE
Open 'notepad.exe' 'notepad' -Arguments 'C:\Users\Public\notes.txt'
#>
function Open {
    param([string]$Exe, [string]$Program, [string]$Arguments = '')
    Start-Program $Program $Arguments
    $windows = Wait-ProcessWindow $Exe 5
    if ($windows.Count -gt 0) { [void](Set-ActiveWindow $windows[0]) }
}

<#
.SYNOPSIS
Makes a program's window the active one, starting the program if needed.
.DESCRIPTION
If the program has no visible window, it is started and up to 5 seconds are given for a window to appear. Then, unless one of the program's windows is already the active window, its topmost window is activated. Unlike ActivateOrOpen, it never moves on to another window of the program when one is already active. Check the result before sending keys, so that they never go to another program.
.PARAMETER Exe
The program's executable name as Task Manager shows it, such as 'code.exe'. It is how the program's windows are found.
.PARAMETER Program
What to start when the program has no window: a program name, or the full path of a file.
.PARAMETER Arguments
Text given to the program on its command line when it is started. Not used when a window already exists.
.OUTPUTS
True when one of the program's windows is the active window at the end. False when no window appeared within 5 seconds, or when Windows did not let the window come to the front.
.EXAMPLE
EnsureActiveOrOpen 'notepad.exe' 'notepad'
.EXAMPLE
if (EnsureActiveOrOpen 'notepad.exe' 'notepad') { Send-Chord 'Ctrl+s' }
#>
function EnsureActiveOrOpen {
    param([string]$Exe, [string]$Program, [string]$Arguments = '')
    $windows = Get-ProcessWindow $Exe
    if ($windows.Count -eq 0) {
        Start-Program $Program $Arguments
        $windows = Wait-ProcessWindow $Exe 5
    }
    if ($windows.Count -eq 0) { return $false }
    # Test-WindowActive with no WinTitle gives the handle of the active window, whatever it is.
    if ($windows -contains (Test-WindowActive)) { return $true }
    [bool](Set-ActiveWindow $windows[0])
}

<#
.SYNOPSIS
Runs a Python script in its own process and does not wait for it.
.DESCRIPTION
Starts python with the script's path in double quotes (so spaces in the path are fine), followed by the arguments. Python must be installed so that the name python works. The macro carries on at once, without waiting for the script to finish.
.PARAMETER ScriptPath
The full path of the .py file.
.PARAMETER Arguments
Text that follows the script's path on the command line, as one string.
.EXAMPLE
RunPythonScript 'C:\Scripts\backup.py'
.EXAMPLE
RunPythonScript 'C:\Scripts\backup.py' -Arguments '--quick'
#>
function RunPythonScript {
    param($ScriptPath, $Arguments = '')
    Start-Program 'python' ("`"$ScriptPath`" $Arguments".Trim())
}

<#
.SYNOPSIS
Runs a PowerShell script in its own process and does not wait for it.
.DESCRIPTION
Starts Windows PowerShell with the script's path in double quotes (so spaces in the path are fine), followed by the arguments. The script runs without the user's profile and with the execution policy bypassed, unless Group Policy sets one: a policy set by Group Policy still applies. The macro carries on at once, without waiting for the script to finish.
.PARAMETER ScriptPath
The full path of the .ps1 file.
.PARAMETER Arguments
Text that follows the script's path on the command line, as one string.
.EXAMPLE
RunPowerShellScript 'C:\Scripts\cleanup.ps1'
.EXAMPLE
RunPowerShellScript 'C:\Scripts\cleanup.ps1' -Arguments '-Force'
#>
function RunPowerShellScript {
    param($ScriptPath, $Arguments = '')
    Start-Program 'powershell' ("-NoProfile -ExecutionPolicy Bypass -File `"$ScriptPath`" $Arguments".Trim())
}

<#
.SYNOPSIS
Runs a batch file in its own process and does not wait for it.
.DESCRIPTION
Starts the file at ScriptPath, with the arguments after it. The macro carries on at once, without waiting for the batch file to finish.
.PARAMETER ScriptPath
The full path of the .bat or .cmd file.
.PARAMETER Arguments
Text given to the batch file on its command line, as one string.
.EXAMPLE
RunBatchScript 'C:\Scripts\backup.bat'
.EXAMPLE
RunBatchScript 'C:\Scripts\backup.bat' -Arguments 'quick'
#>
function RunBatchScript {
    param($ScriptPath, $Arguments = '')
    Start-Program $ScriptPath $Arguments
}

<#
.SYNOPSIS
Shows a message box with the macro's name and description.
.DESCRIPTION
Meant to be the action of a macro: the box has the macro's name as its title and its description as its text. The macro waits until the box is closed.
.PARAMETER Macro
The macro of the key that was pressed. The function reads its Name (the title of the box) and its Description (the text in it).
.EXAMPLE
Message $Macro
#>
function Message {
    param($Macro)
    Show-MessageBox $Macro.Description $Macro.Name
}

<#
.SYNOPSIS
Shows a message box telling you to replace this macro with your own.
.DESCRIPTION
A placeholder action for macros that have no real command yet. The box says "Replace" followed by the macro's name and "with your own!", and has the macro's name as its title. The macro waits until the box is closed.
.PARAMETER Macro
The macro of the key that was pressed. The function reads only its Name.
.EXAMPLE
ReplaceMe $Macro
#>
function ReplaceMe {
    param($Macro)
    Show-MessageBox "Replace $($Macro.Name) with your own!" $Macro.Name
}

<#
.SYNOPSIS
Shows a message box with an OK button and waits until it is closed. It works like AutoHotkey's MsgBox.
.DESCRIPTION
The box comes to the front, in front of the window you were using, and the macro waits until the box is closed. Message and ReplaceMe use it.
.PARAMETER Text
The text in the box.
.PARAMETER Title
The title of the box. Leave it out for none.
.EXAMPLE
Show-MessageBox 'The backup has finished.' 'Backup'
#>
function Show-MessageBox {
    param([string]$Text, [string]$Title = '')
    # MB_OK with MB_SETFOREGROUND (0x10000): without it the box opens behind the active window.
    [void][Macropad.Native]::MessageBox([IntPtr]::Zero, $Text, $Title, 0x10000)
}
<#
.SYNOPSIS
Lists the open File Explorer windows.
.DESCRIPTION
Only File Explorer windows count (window class CabinetWClass), not the taskbar, the desktop or the other windows that explorer.exe owns, so matching by the program's name would not find them. Hidden windows are left out.
.OUTPUTS
A list of window handles, one for each open File Explorer window; empty when there are none. A window handle is the number Windows uses to name one window, and Set-ActiveWindow takes it.
.EXAMPLE
Get-ExplorerWindows
.EXAMPLE
$windows = Get-ExplorerWindows
if ($windows.Count -gt 0) { Set-ActiveWindow $windows[0] }
#>
function Get-ExplorerWindows {
    $windows = Find-Window 'ahk_class CabinetWClass' -All
    , [IntPtr[]]@($windows)
}

<#
.SYNOPSIS
Opens a File Explorer window and brings it to the front.
.DESCRIPTION
Starts File Explorer, at the folder in Path when one is given, and activates the new window as soon as it appears. It looks for about 5 seconds; if no new window shows up in that time, it gives up without an error.
.PARAMETER Path
The folder to show; spaces and commas in it are fine. Without it, File Explorer opens where it normally starts.
.EXAMPLE
Open-ExplorerWindow
.EXAMPLE
Open-ExplorerWindow -Path 'C:\Users\Public\Documents'
#>
function Open-ExplorerWindow {
    param([string]$Path = '')
    $before = Get-ExplorerWindows
    # Explorer reads a comma as the end of a switch (/select,<path>), so a path with a comma or a space
    # goes in double quotes, without a closing backslash (which would escape the quote).
    $folder = $Path
    if ($Path -match '[ ,]') { $folder = '"{0}"' -f $Path.TrimEnd('\') }
    Start-Program 'explorer' $folder
    for ($i = 0; $i -lt 50; $i++) {
        $now = Get-ExplorerWindows
        $new = @($now | Where-Object { $before -notcontains $_ })
        if ($new.Count -gt 0) {
            [void](Set-ActiveWindow $new[0])
            return
        }
        Wait-Pump 100
    }
}
