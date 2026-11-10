# Waits that keep the UI thread alive. Macros run on the WinForms thread, so a blocking wait would
# freeze the overlay, Fn, the tray and every hotkey; Wait-Pump keeps dispatching messages instead.
# Tray Exit/Reload set $global:MacropadExiting, and the next pump unwinds the waiting macro.

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
