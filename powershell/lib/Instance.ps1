# Single instance: a new launch replaces the running macropad (like AHK #SingleInstance force).

function Enter-SingleInstance {
    param([string]$PidFile = "$env:TEMP\LayeredMacropad.pid")
    if (Test-Path -LiteralPath $PidFile) {
        $text = Get-Content -LiteralPath $PidFile -Raw -ErrorAction SilentlyContinue
        $old = 0
        if ($text -and [int]::TryParse($text.Trim(), [ref]$old) -and $old -ne $PID) {
            $proc = Get-CimInstance Win32_Process -Filter "ProcessId = $old" -ErrorAction SilentlyContinue
            if ($proc -and $proc.CommandLine -match 'main\.ps1') {
                Stop-Process -Id $old -Force -ErrorAction SilentlyContinue
                $deadline = [DateTime]::Now.AddSeconds(3)
                while ((Get-Process -Id $old -ErrorAction SilentlyContinue) -and [DateTime]::Now -lt $deadline) {
                    Start-Sleep -Milliseconds 100
                }
            }
        }
    }
    Set-Content -LiteralPath $PidFile -Value $PID
}

function Exit-SingleInstance {
    param([string]$PidFile = "$env:TEMP\LayeredMacropad.pid")
    if (-not (Test-Path -LiteralPath $PidFile)) { return }
    $text = Get-Content -LiteralPath $PidFile -Raw -ErrorAction SilentlyContinue
    if ($text -and $text.Trim() -eq "$PID") { Remove-Item -LiteralPath $PidFile -ErrorAction SilentlyContinue }
}

# Is the AutoHotkey macropad (ahk\main.ahk) running? Its keyboard hook swallows F13-F24 and
# ScrollLock, and RegisterHotKey does not fail against a hook, so this version would start with
# every key dead. $Processes is for tests; by default the running AutoHotkey processes are read.
function Test-AhkMacropadRunning {
    param([object[]]$Processes)
    if (-not $PSBoundParameters.ContainsKey('Processes')) {
        $Processes = @(Get-CimInstance Win32_Process -Filter "Name LIKE 'AutoHotkey%'" -ErrorAction SilentlyContinue)
    }
    foreach ($p in @($Processes)) {
        if ([string]$p.CommandLine -match '\\ahk\\main\.ahk"?\s*$') { return $true }
    }
    $false
}
