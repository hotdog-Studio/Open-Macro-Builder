# Runs an AutoHotkey v2 script that prints to stdout and exits. Returns $null when AutoHotkey is
# not installed. A runtime error opens a dialog instead of exiting, so the run is cut off after
# $TimeoutSeconds rather than hanging the test run.

function Get-AhkExe {
    @("$env:ProgramFiles\AutoHotkey\v2\AutoHotkey64.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
}

function Invoke-AhkScript {
    param([Parameter(Mandatory)][string]$Script, [int]$TimeoutSeconds = 30)
    $exe = Get-AhkExe
    if (-not $exe) { return $null }
    $out = [System.IO.Path]::GetTempFileName(); $err = [System.IO.Path]::GetTempFileName()
    try {
        $p = Start-Process -FilePath $exe -ArgumentList '/ErrorStdOut', "`"$Script`"" -PassThru -NoNewWindow -RedirectStandardOutput $out -RedirectStandardError $err
        $null = $p.Handle   # keep the handle so ExitCode is available after exit
        if (-not $p.WaitForExit($TimeoutSeconds * 1000)) {
            Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
            throw "AutoHotkey did not finish $Script within $TimeoutSeconds s (usually an error dialog)."
        }
        $p.WaitForExit()
        [pscustomobject]@{
            ExitCode = $p.ExitCode
            Out      = [System.IO.File]::ReadAllText($out, [System.Text.Encoding]::UTF8)
            Err      = [System.IO.File]::ReadAllText($err)
        }
    } finally {
        Remove-Item $out, $err -ErrorAction SilentlyContinue
    }
}
