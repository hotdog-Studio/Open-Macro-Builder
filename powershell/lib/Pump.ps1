# Pausing
# Waits that keep the UI thread alive. Macros run on the WinForms thread, so a blocking wait would
# freeze the overlay, Fn, the tray and every hotkey; Wait-Pump keeps dispatching messages instead.
# Tray Exit/Reload set $global:MacropadExiting, and the next pump unwinds the waiting macro.

<#
.SYNOPSIS
Pauses for some milliseconds while the macropad stays responsive. It stands in for AutoHotkey's Sleep.
.DESCRIPTION
Use it between steps of a command that need time, such as after opening a program. A macro runs on the same thread that draws the overlay and the tray icon and reads the keys, so an ordinary blocking pause would freeze all of them; this one keeps handling them while it waits. If the macropad is closed or reloaded during the pause, the macro is stopped.
.PARAMETER Milliseconds
How long to pause, in thousandths of a second: 1000 is one second.
.EXAMPLE
Wait-Pump 500
.EXAMPLE
Send-Chord 'Ctrl+t'
Wait-Pump 300
Send-Text 'example.com'
#>
function Wait-Pump {
    param([int]$Milliseconds)
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    while ($true) {
        [System.Windows.Forms.Application]::DoEvents()
        if ($global:MacropadExiting) { throw [OperationCanceledException]::new('Macropad is exiting') }
        if ($sw.ElapsedMilliseconds -ge $Milliseconds) { return }
        [System.Threading.Thread]::Sleep(10)
    }
}
