# Layered Macropad, PowerShell edition. Start it with launch.vbs so no console window shows.
# Event handlers (hotkeys, timers, clicks, tray menu) run in this script's scope while
# Application.Run() is pumping messages, so they can see the variables defined below.

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

foreach ($f in 'Native', 'Assets', 'Input', 'Model', 'Overlay', 'Window', 'Engine', 'Tray', 'Instance') {
    . (Join-Path $PSScriptRoot "lib\$f.ps1")
}
foreach ($f in Get-ChildItem (Join-Path $PSScriptRoot 'commands') -Recurse -Filter *.ps1) { . $f.FullName }
. (Join-Path $PSScriptRoot 'config.ps1')

[void][Macropad.Native]::ShowWindow([Macropad.Native]::GetConsoleWindow(), [Macropad.Native]::SW_HIDE)

$hk = $null
$tray = $null
try {
    Enter-SingleInstance
    $layout = Get-MacropadConfig
    Test-LayoutActions $layout
    $overlay = New-Overlay $layout
    $initial = Get-InitialLayerIndex $layout
    if ($initial -ge 0) { [void](Select-Layer $overlay $initial) }

    $launcher = Join-Path $PSScriptRoot 'launch.vbs'
    $tray = New-TrayIcon (Get-AssetPath 'icon.ico') 'Layered Macropad' `
        -OnReload { Start-Process wscript.exe "`"$launcher`""; [System.Windows.Forms.Application]::Exit() } `
        -OnExit { [System.Windows.Forms.Application]::Exit() }

    # Anything a handler throws outside a macro lands here instead of the WinForms crash dialog.
    [System.Windows.Forms.Application]::add_ThreadException({
        param($sender, $e)
        Show-MacropadError $tray 'Layered Macropad error' $e.Exception.Message
    })

    $engine = New-Engine $layout `
        -GetSelected { $overlay.Selected } `
        -SelectLayer { param($i) Select-Layer $overlay $i } `
        -RunMacro { param($m) Invoke-Macro $m } `
        -ShowOverlay { Show-Overlay $overlay } `
        -HideOverlay { Hide-Overlay $overlay } `
        -OnError { param($m, $e) Show-MacropadError $tray "Macro '$($m.Name)' failed" $e.Exception.Message }
    $overlay.RunMacro = {
        param($m)
        try { Invoke-Macro $m } catch { Show-MacropadError $tray "Macro '$($m.Name)' failed" $_.Exception.Message }
    }

    $hk = [Macropad.HotkeyWindow]::new()
    Register-LayoutHotkeys $hk $layout $engine
    [System.Windows.Forms.Application]::Run()
} catch {
    [void][System.Windows.Forms.MessageBox]::Show($_.Exception.Message, 'Layered Macropad failed to start')
    exit 1
} finally {
    if ($null -ne $hk) { $hk.Dispose() }
    if ($null -ne $tray) { $tray.Visible = $false; $tray.Dispose() }
    Exit-SingleInstance
}
