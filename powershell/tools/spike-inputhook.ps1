# Manual check of the input hook: prints "Fired <id>" for each hotkey that fires.
#   0  ^!t      (Ctrl+Alt+T)
#   1  #x       (Win+X; the Quick Link menu must not open, releasing Win must not open Start)
#   2  a & b    (hold a, press b; a alone types a on release)
# Exit both macropads first. Usage: powershell -NoProfile -File powershell\tools\spike-inputhook.ps1 [-Seconds 60]
param([int]$Seconds = 60)

foreach ($f in 'Native', 'Interop', 'Pump', 'Input', 'AhkSyntax') { . "$PSScriptRoot\..\lib\$f.ps1" }

$hook = [Macropad.InputHook]::new()
try {
    $specs = @('^!t', '#x', 'a & b')
    for ($i = 0; $i -lt $specs.Count; $i++) {
        $p = ConvertFrom-AhkHotkey $specs[$i]
        $hook.AddHotkey($i, $p.Vk, $p.Mods, [int]$p.Wildcard + 2 * [int]$p.Passthrough + 4 * [int]$p.KeyUp, $p.PrefixVk, 0)
    }
    $hook.add_Fired({ param($sender, $e) Write-Host "Fired $($e.Id)" })
    if (-not $hook.Start()) {
        Write-Host 'Could not install the input hook.'
        exit 1
    }

    $quit = New-Object System.Windows.Forms.Timer
    $quit.Interval = $Seconds * 1000
    $quit.add_Tick({ param($sender, $e) $sender.Stop(); [System.Windows.Forms.Application]::Exit() })
    $quit.Start()

    Write-Host "Listening for $Seconds s."
    [System.Windows.Forms.Application]::Run()
}
finally {
    $hook.Dispose()
}
