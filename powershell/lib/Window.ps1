# Finding, starting and activating program windows by executable name
# ($Exe plays the part of AHK's "ahk_exe X").

# Visible top-level windows of every process with that exe name except this one, top of the Z-order first.
function Get-ProcessWindow {
    param([Parameter(Mandatory)][string]$Exe)
    $name = $Exe -replace '\.exe$', ''
    $ids = @(Get-Process -Name $name -ErrorAction SilentlyContinue | Where-Object { $_.Id -ne $PID } | ForEach-Object { $_.Id })
    if ($ids.Count -eq 0) { return , ([IntPtr[]]@()) }
    , ([IntPtr[]][Macropad.Native]::GetProcessWindows([int[]]$ids))
}

# The top window, or the bottom one when one of them is already active (AHK WinActivateBottom),
# so repeated presses cycle through the program's windows.
function Select-WindowToActivate {
    param([IntPtr[]]$Windows, [IntPtr]$Foreground)
    if ($null -eq $Windows -or $Windows.Count -eq 0) { return $null }
    if ($Windows -contains $Foreground) { return $Windows[-1] }
    $Windows[0]
}

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

function Set-ActiveWindow {
    param([Parameter(Mandatory)][IntPtr]$Hwnd)
    [Macropad.Native]::ActivateWindow($Hwnd)
}

function Start-Program {
    param([Parameter(Mandatory)][string]$Program, [string]$Arguments = '')
    if ($Arguments) { Start-Process -FilePath $Program -ArgumentList $Arguments }
    else { Start-Process -FilePath $Program }
}

# Activates one of the program's windows; $false when it has none.
function Invoke-WindowActivation {
    param([Parameter(Mandatory)][string]$Exe)
    $windows = Get-ProcessWindow $Exe
    if ($windows.Count -eq 0) { return $false }
    $target = Select-WindowToActivate $windows ([Macropad.Native]::GetForegroundWindow())
    [void](Set-ActiveWindow $target)
    $true
}
