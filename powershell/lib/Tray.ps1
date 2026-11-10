# Tray icon with Reload / Exit, and error reporting through its balloon.

function New-TrayIcon {
    param([string]$IconPath, [string]$Text, [scriptblock]$OnReload, [scriptblock]$OnExit)
    $tray = New-Object System.Windows.Forms.NotifyIcon
    $tray.Icon = New-Object System.Drawing.Icon($IconPath)
    $tray.Text = $Text
    $menu = New-Object System.Windows.Forms.ContextMenuStrip
    # Each item carries its action in Tag; the shared handler runs it (no closures, see main.ps1).
    $onClick = { param($sender, $e) & $sender.Tag }
    foreach ($entry in @(@('Reload', $OnReload), @('Exit', $OnExit))) {
        $item = [System.Windows.Forms.ToolStripMenuItem]::new([string]$entry[0])
        $item.Tag = $entry[1]
        $item.add_Click($onClick)
        [void]$menu.Items.Add($item)
    }
    $tray.ContextMenuStrip = $menu
    $tray.Visible = $true
    $tray
}

# Appends a timestamped line to the log. Once the file passes MaxBytes it is renamed to
# <name>.old, replacing the previous one, and a new file starts, so the log never grows past
# about twice the limit.
function Write-MacropadLog {
    param([string]$Line, [string]$Path = "$env:TEMP\LayeredMacropad.log", [long]$MaxBytes = 1MB)
    $file = Get-Item -LiteralPath $Path -ErrorAction SilentlyContinue
    if ($file -and $file.Length -gt $MaxBytes) { Move-Item -LiteralPath $Path -Destination "$Path.old" -Force }
    Add-Content -LiteralPath $Path -Value "$(Get-Date -Format s) $Line"
}

function Show-MacropadError {
    param($Tray, [string]$Title, [string]$Message)
    if (-not $Message) { $Message = '(no details)' }
    Write-MacropadLog "$($Title): $Message"
    if ($null -ne $Tray) { $Tray.ShowBalloonTip(5000, $Title, $Message, [System.Windows.Forms.ToolTipIcon]::Error) }
}
