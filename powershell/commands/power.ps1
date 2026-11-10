# Power commands (ahk/commands/power.ahk).

function TurnMonitorsOff {
    param($Macro)
    # Wait a moment so the key release does not wake the monitors straight back up.
    Start-Sleep 1
    # WM_SYSCOMMAND / SC_MONITORPOWER / 2 = off, sent to the desktop window like the AHK version.
    [void][Macropad.Native]::SendMessage([Macropad.Native]::FindWindow('Progman', $null), 0x112, [IntPtr]0xF170, [IntPtr]2)
}

function Lock { param($Macro) [void][Macropad.Native]::LockWorkStation() }
function WinSleep { param($Macro) [void][Macropad.Native]::SetSuspendState($false, $false, $false) }
function Hibernate { param($Macro) [void][Macropad.Native]::SetSuspendState($true, $false, $false) }

# shutdown.exe instead of AHK's ExitWindowsEx, which needs a privilege the AHK version never requested.
function Restart { param($Macro) Start-Program 'shutdown' '/r /t 1' }
function Shutdown { param($Macro) Start-Program 'shutdown' '/s /t 1' }
