# Manual check of the input hook: prints "Fired <id>" for each hotkey that fires.
#   0  ^!t      (Ctrl+Alt+T, any window except Notepad)
#   1  #x       (Win+X; the Quick Link menu must not open, releasing Win must not open Start)
#   2  a & b    (hold a, press b; a alone types a on release)
#   3  ^!t      only while Notepad is active (#HotIfWinActive ahk_exe notepad.exe)
#   hotstrings: 'btw ' -> 'by the way ', '@@' -> 'hello@example.com' (no end char needed),
#   4..6        'now ' prints "Fired 6" and leaves only the space
# Type into Notepad to try the hotstrings.
# Exit both macropads first. Usage: powershell -NoProfile -File powershell\tools\spike-inputhook.ps1 [-Seconds 60]
param([int]$Seconds = 60)

foreach ($f in 'Native', 'Interop', 'Pump', 'Input', 'AhkSyntax', 'WinTitle', 'Hotkeys') { . "$PSScriptRoot\..\lib\$f.ps1" }

$hook = [Macropad.InputHook]::new()
$watcher = $null
try {
    $specs = @(@('^!t', 0), @('#x', 0), @('a & b', 0), @('^!t', 1))
    for ($i = 0; $i -lt $specs.Count; $i++) {
        $p = ConvertFrom-AhkHotkey $specs[$i][0]
        $hook.AddHotkey($i, $p.Vk, $p.Mods, [int]$p.Wildcard + 2 * [int]$p.Passthrough + 4 * [int]$p.KeyUp, $p.PrefixVk, $specs[$i][1])
    }
    $strings = @(@('::btw', 'by the way'), @(':*:@@', 'hello@example.com'), @(':X:now', ''))
    for ($i = 0; $i -lt $strings.Count; $i++) {
        $p = ConvertFrom-AhkHotstring $strings[$i][0]
        $hook.AddHotstring(4 + $i, $p.Abbrev, $p.Options, $p.Execute, $strings[$i][1], 0)
    }
    $contexts = @([pscustomobject]@{ Id = 1; WinTitle = 'ahk_exe notepad.exe'; Negate = $false })
    $watcher = [Macropad.ForegroundWatcher]::new()
    $watcher.Context = @{ Hook = $hook; Contexts = $contexts }
    $watcher.add_Changed({ param($sender, $e) Update-HotkeyContexts $sender.Context.Hook $sender.Context.Contexts (Get-ForegroundInfo) })
    Update-HotkeyContexts $hook $contexts (Get-ForegroundInfo)

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
    if ($null -ne $watcher) { $watcher.Dispose() }
    $hook.Dispose()
}
