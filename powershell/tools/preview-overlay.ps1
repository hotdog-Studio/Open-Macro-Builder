# Manual visual check of the overlay: shows it for 5 s, moving the selection after 2 s.
# Uses config.ps1 when it and the commands load, otherwise a 3-key test fixture.
# -ScreenshotPath saves <path>-before.png and <path>-after.png of the overlay area.
# Usage: powershell -NoProfile -File powershell\tools\preview-overlay.ps1 [-ScreenshotPath C:\temp\overlay]
param([string]$ScreenshotPath = '')

$root = Split-Path $PSScriptRoot -Parent
foreach ($f in 'Native', 'Assets', 'Model', 'Overlay') { . (Join-Path $root "lib\$f.ps1") }

$layout = $null
$config = Join-Path $root 'config.ps1'
if (Test-Path $config) {
    try {
        foreach ($f in 'Interop', 'Pump', 'Input', 'Window', 'AhkSyntax', 'WinTitle', 'Hotkeys', 'ConfigJson') { $p = Join-Path $root "lib\$f.ps1"; if (Test-Path $p) { . $p } }
        Get-ChildItem (Join-Path $root 'commands') -Recurse -Filter *.ps1 -ErrorAction Stop | ForEach-Object { . $_.FullName }
        . $config
        $layout = Get-MacropadConfig
    } catch {
        Write-Host "Config not usable ($($_.Exception.Message)); using the test fixture."
        $layout = $null
    }
}
if ($null -eq $layout) {
    $keys = @((Key 'F13' 1 1), (Key 'F14' 1 2), (Key 'F15' 1 3))
    $layers = @(
        (Layer 'A' (Icon 'chrome') @((Macro 'Act' 'M0' 'd0'), '', (Macro 'Act' 'M2' 'd2'))),
        '',
        (Layer 'C' (Icon 'putty') @('', (Macro 'Act' 'M1b' 'd1b'), ''))
    )
    $layout = Layout (Key 'ScrollLock' 2 1 2 1) $keys $layers 1 ' ' $true $true
}

function Save-OverlayShot {
    param($Form, [string]$Path)
    $b = $Form.Bounds
    $bmp = New-Object System.Drawing.Bitmap($b.Width, $b.Height)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size)
    $g.Dispose()
    $bmp.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
}

$overlay = New-Overlay $layout
$initial = Get-InitialLayerIndex $layout
if ($initial -ge 0) { [void](Select-Layer $overlay $initial) }

$foreground = [Macropad.Native]::GetForegroundWindow()
Show-Overlay $overlay
Write-Host "Overlay shown at $($overlay.Form.Bounds) with layer $($overlay.Selected) selected."

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 1000
$timer.Tag = @{ Overlay = $overlay; Step = 0; Shot = $ScreenshotPath; Foreground = $foreground }
$timer.add_Tick({
    param($sender, $e)
    $s = $sender.Tag
    $s.Step++
    $o = $s.Overlay
    if ($s.Step -eq 1 -and $s.Shot) { Save-OverlayShot $o.Form "$($s.Shot)-before.png" }
    if ($s.Step -eq 2) {
        $layers = @($o.Layout.Layers)
        for ($n = 1; $n -le $layers.Count; $n++) {
            $next = ($o.Selected + $n) % $layers.Count
            if ($null -ne $layers[$next]) { [void](Select-Layer $o $next); break }
        }
        Write-Host "Selected layer $($o.Selected)."
    }
    if ($s.Step -eq 3) {
        if ($s.Shot) { Save-OverlayShot $o.Form "$($s.Shot)-after.png" }
        Write-Host "Foreground window unchanged: $([Macropad.Native]::GetForegroundWindow() -eq $s.Foreground)"
    }
    if ($s.Step -ge 5) {
        $sender.Stop()
        Hide-Overlay $o
        [System.Windows.Forms.Application]::Exit()
    }
})
$timer.Start()
[System.Windows.Forms.Application]::Run()
