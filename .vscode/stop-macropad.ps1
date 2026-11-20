# Stops one version of the macropad so the other can use the macro keys. The launch
# configurations in launch.json run this before they start a version.
[CmdletBinding(SupportsShouldProcess)]
param(
    [Parameter(Mandatory)]
    [ValidateSet('AutoHotkey', 'PowerShell')]
    [string]$Version
)

# Same match as Test-AhkMacropadRunning in powershell/lib/Instance.ps1, allowing either slash.
$find = @{
    AutoHotkey = @{ Filter = "Name LIKE 'AutoHotkey%'"; Pattern = '[\\/]ahk[\\/]main\.ahk"?\s*$' }
    PowerShell = @{ Filter = "Name = 'powershell.exe'"; Pattern = '[\\/]powershell[\\/]main\.ps1\b' }
}[$Version]

$running = @(Get-CimInstance Win32_Process -Filter $find.Filter |
    Where-Object { [string]$_.CommandLine -match $find.Pattern })
foreach ($p in $running) {
    if ($PSCmdlet.ShouldProcess("process $($p.ProcessId)", "Stop the $Version macropad")) {
        Stop-Process -Id $p.ProcessId -Force
        "Stopped the $Version macropad (process $($p.ProcessId))."
    }
}
