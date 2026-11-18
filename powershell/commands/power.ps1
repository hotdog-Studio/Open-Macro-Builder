# Power commands (ahk/commands/power.ahk).

function TurnMonitorsOff {
    param($Macro)
    # Wait a moment so the key release does not wake the monitors straight back up.
    Wait-Pump 1000
    # WM_SYSCOMMAND / SC_MONITORPOWER / 2 = off, sent to the desktop window like the AHK version,
    # which also gives up after 5 seconds when the desktop does not answer.
    $desktop = Find-Window 'ahk_class Progman' -IncludeHidden
    if ($desktop -ne [IntPtr]::Zero) { [void](Send-WindowMessage $desktop 0x112 0xF170 2 -TimeoutMs 5000) }
}

# Seams for the tests: the calls into Windows that lock, sleep and hibernate.
function Lock-Workstation { [Macropad.Native]::LockWorkStation() }
function Invoke-SuspendState { param([bool]$Hibernate) [Macropad.Native]::SetSuspendState($Hibernate, $false, $false) }

function Lock { param($Macro) [void](Lock-Workstation) }
function WinSleep {
    param($Macro)
    if (-not (Invoke-SuspendState $false)) { throw 'Windows did not go to sleep.' }
}
function Hibernate {
    param($Macro)
    if (-not (Invoke-SuspendState $true)) { throw 'Windows did not hibernate. Is hibernation turned on (powercfg /hibernate on)?' }
}

# shutdown.exe, as in the AHK version: ExitWindowsEx would need a privilege the macropad does not enable.
function Restart { param($Macro) Start-Program 'shutdown' '/r /t 1' }
function Shutdown { param($Macro) Start-Program 'shutdown' '/s /t 1' }
