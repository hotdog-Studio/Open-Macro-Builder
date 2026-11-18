# The power commands of powershell\commands\power.ps1. Every call that would lock, sleep, hibernate,
# restart, shut down or turn off the monitors is mocked in BeforeEach, for every test.
BeforeAll {
    $ps = Split-Path $PSScriptRoot -Parent
    foreach ($f in 'Native', 'Interop', 'Pump', 'Window', 'WinTitle', 'WindowOps') { . "$ps\lib\$f.ps1" }
    . "$ps\commands\power.ps1"
}
Describe 'Power commands reach Windows only through the wrappers the tests mock' {
    It 'calls [Macropad.Native] only inside Lock-Workstation and Invoke-SuspendState' {
        # A direct call in a command would lock, sleep or hibernate this PC during the tests, before any assertion.
        $ast = [System.Management.Automation.Language.Parser]::ParseFile("$ps\commands\power.ps1", [ref]$null, [ref]$null)
        $bad = foreach ($fn in $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] }, $false)) {
            if ($fn.Name -in 'Lock-Workstation', 'Invoke-SuspendState') { continue }
            if ($fn.Body.Extent.Text -match '\[Macropad\.Native\]::') { $fn.Name }
        }
        $outside = $ast.EndBlock.Statements | Where-Object { $_ -isnot [System.Management.Automation.Language.FunctionDefinitionAst] -and $_.Extent.Text -match '\[Macropad\.Native\]::' }
        @($bad) + @($outside | ForEach-Object { $_.Extent.Text }) | Should -BeNullOrEmpty
    }
    It 'reads SetSuspendState''s one-byte BOOLEAN result as one byte' {
        # Read as a four-byte BOOL, a refusal with junk in the upper bytes would look like success.
        $method = [Macropad.Native].GetMethod('SetSuspendState')
        $marshal = @($method.ReturnParameter.GetCustomAttributes([System.Runtime.InteropServices.MarshalAsAttribute], $false))
        $marshal.Count | Should -Be 1
        $marshal[0].Value | Should -Be ([System.Runtime.InteropServices.UnmanagedType]::U1)
    }
}
Describe 'Power commands' {
    BeforeEach {
        Mock Start-Program {}
        Mock Lock-Workstation { $true }
        Mock Invoke-SuspendState { $true }
        Mock Send-WindowMessage { 0 }
        Mock Wait-Pump {}
        Mock Find-Window { [IntPtr]42 } -ParameterFilter { $WinTitle -eq 'ahk_class Progman' }
    }
    It 'Restart runs shutdown /r /t 1' {
        Restart $null
        Should -Invoke Start-Program -Times 1 -Exactly -ParameterFilter { $Program -eq 'shutdown' -and $Arguments -eq '/r /t 1' }
    }
    It 'Shutdown runs shutdown /s /t 1' {
        Shutdown $null
        Should -Invoke Start-Program -Times 1 -Exactly -ParameterFilter { $Program -eq 'shutdown' -and $Arguments -eq '/s /t 1' }
    }
    It 'Lock locks the workstation' {
        Lock $null
        Should -Invoke Lock-Workstation -Times 1 -Exactly
    }
    It 'WinSleep asks Windows to sleep, not to hibernate' {
        WinSleep $null
        Should -Invoke Invoke-SuspendState -Times 1 -Exactly -ParameterFilter { $Hibernate -eq $false }
    }
    It 'Hibernate asks Windows to hibernate' {
        Hibernate $null
        Should -Invoke Invoke-SuspendState -Times 1 -Exactly -ParameterFilter { $Hibernate -eq $true }
    }
    It '<Command> raises an error when Windows refuses' -ForEach @(
        @{ Command = 'WinSleep'; Message = 'Windows did not go to sleep.' }
        @{ Command = 'Hibernate'; Message = 'Windows did not hibernate.*' }
    ) {
        Mock Invoke-SuspendState { $false }
        { & $Command $null } | Should -Throw $Message
    }
    It 'TurnMonitorsOff waits a second, then tells the desktop window to turn the monitors off, giving up after 5 seconds' {
        TurnMonitorsOff $null
        Should -Invoke Wait-Pump -Times 1 -Exactly -ParameterFilter { $Milliseconds -eq 1000 }
        Should -Invoke Send-WindowMessage -Times 1 -Exactly -ParameterFilter {
            $Hwnd -eq [IntPtr]42 -and $Msg -eq 0x112 -and $WParam -eq 0xF170 -and $LParam -eq 2 -and -not $Post -and $TimeoutMs -eq 5000
        }
    }
    It 'TurnMonitorsOff sends nothing when there is no desktop window' {
        Mock Find-Window { [IntPtr]::Zero } -ParameterFilter { $WinTitle -eq 'ahk_class Progman' }
        TurnMonitorsOff $null
        Should -Invoke Send-WindowMessage -Times 0 -Exactly
    }
}
