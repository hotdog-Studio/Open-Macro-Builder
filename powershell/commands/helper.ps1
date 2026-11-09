# Helper commands (ahk/commands/helper.ahk). $Exe replaces AHK's "ahk_exe X" window title.

function ActivateOrOpen {
    param([string]$Exe, [string]$Program, [string]$Arguments = '')
    if (-not (Invoke-WindowActivation $Exe)) {
        Start-Program $Program $Arguments
        [void](Wait-ProcessWindow $Exe 5)
        [void](Invoke-WindowActivation $Exe)
    }
}

function Open {
    param([string]$Exe, [string]$Program, [string]$Arguments = '')
    Start-Program $Program $Arguments
    $windows = Wait-ProcessWindow $Exe 5
    if ($windows.Count -gt 0) { [void](Set-ActiveWindow $windows[0]) }
}

function EnsureActiveOrOpen {
    param([string]$Exe, [string]$Program, [string]$Arguments = '')
    $windows = Get-ProcessWindow $Exe
    if ($windows.Count -eq 0) {
        Start-Program $Program $Arguments
        $windows = Wait-ProcessWindow $Exe 5
    }
    if ($windows.Count -gt 0 -and $windows -notcontains [Macropad.Native]::GetForegroundWindow()) {
        [void](Set-ActiveWindow $windows[0])
    }
}

function RunPythonScript {
    param($ScriptPath, $Arguments = '')
    Start-Program 'python' ("`"$ScriptPath`" $Arguments".Trim())
}

function RunPowerShellScript {
    param($ScriptPath, $Arguments = '')
    Start-Program 'powershell' ("-NoProfile -ExecutionPolicy Bypass -File `"$ScriptPath`" $Arguments".Trim())
}

function RunBatchScript {
    param($ScriptPath, $Arguments = '')
    Start-Program $ScriptPath $Arguments
}

function Message {
    param($Macro)
    [void][System.Windows.Forms.MessageBox]::Show($Macro.Description, $Macro.Name)
}

function ReplaceMe {
    param($Macro)
    [void][System.Windows.Forms.MessageBox]::Show("Replace $($Macro.Name) with your own!", $Macro.Name)
}
