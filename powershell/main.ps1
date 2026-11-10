# Layered Macropad, PowerShell edition. Start it with launch.vbs so no console window shows.
# Event handlers (hotkeys, timers, clicks, tray menu) can run nested inside a macro's pumped wait,
# where an unqualified name may resolve to a command's local variable, so every scriptblock here
# reads this script's state through $global:.

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

foreach ($f in 'Native', 'Interop', 'Pump', 'Assets', 'Input', 'Model', 'Overlay', 'Window', 'Engine', 'Tray', 'Instance', 'AhkSyntax', 'Send', 'WinTitle', 'WindowOps', 'Hotkeys', 'Screen', 'Sound') {
    . (Join-Path $PSScriptRoot "lib\$f.ps1")
}
foreach ($f in Get-ChildItem (Join-Path $PSScriptRoot 'commands') -Recurse -Filter *.ps1) { . $f.FullName }
. (Join-Path $PSScriptRoot 'config.ps1')

[void][Macropad.Native]::ShowWindow([Macropad.Native]::GetConsoleWindow(), [Macropad.Native]::SW_HIDE)

$hk = $null
$global:tray = $null
try {
    Enter-SingleInstance
    $layout = Get-MacropadConfig
    Test-LayoutActions $layout
    $global:overlay = New-Overlay $layout
    $initial = Get-InitialLayerIndex $layout
    if ($initial -ge 0) { [void](Select-Layer $global:overlay $initial) }

    $global:launcher = Join-Path $PSScriptRoot 'launch.vbs'
    $global:tray = New-TrayIcon (Get-AssetPath 'icon.ico') 'Layered Macropad' `
        -OnReload {
            $global:MacropadExiting = $true
            Start-Process wscript.exe "`"$global:launcher`""
            [System.Windows.Forms.Application]::Exit()
        } `
        -OnExit {
            $global:MacropadExiting = $true
            [System.Windows.Forms.Application]::Exit()
        }

    # Anything a handler throws outside a macro lands here instead of the WinForms crash dialog.
    [System.Windows.Forms.Application]::add_ThreadException({
        param($sender, $e)
        Show-MacropadError $global:tray 'Layered Macropad error' $e.Exception.Message
    })

    $global:engine = New-Engine $layout `
        -GetSelected { $global:overlay.Selected } `
        -SelectLayer { param($i) Select-Layer $global:overlay $i } `
        -RunMacro { param($m) Invoke-Macro $m } `
        -ShowOverlay { Show-Overlay $global:overlay } `
        -HideOverlay { Hide-Overlay $global:overlay } `
        -OnError { param($m, $e) Show-MacropadError $global:tray "Macro '$($m.Name)' failed" $e.Exception.Message }
    # Overlay clicks go through the same guard as keys; it reports errors itself.
    $global:overlay.RunMacro = { param($m) [void](Invoke-EngineMacro $global:engine $m) }

    $hk = [Macropad.HotkeyWindow]::new()
    Register-LayoutHotkeys $hk $layout $global:engine

    # Optional AHK-style hotkeys and hotstrings from config.ps1 (Get-MacropadHotkeys).
    $global:inputHook = $null
    if (Get-Command Get-MacropadHotkeys -CommandType Function -ErrorAction SilentlyContinue) {
        $defs = @(Get-MacropadHotkeys)
        Test-HotkeyActions $defs
        $global:inputHook = New-InputHook $defs $global:engine $layout
    }

    $global:MacropadExiting = $false
    [System.Windows.Forms.Application]::Run()
} catch {
    [void][System.Windows.Forms.MessageBox]::Show($_.Exception.Message, 'Layered Macropad failed to start')
    exit 1
} finally {
    if ($null -ne $global:inputHook) { Remove-InputHook $global:inputHook }
    if ($null -ne $hk) { $hk.Dispose() }
    if ($null -ne $global:tray) { $global:tray.Visible = $false; $global:tray.Dispose() }
    Exit-SingleInstance
}
