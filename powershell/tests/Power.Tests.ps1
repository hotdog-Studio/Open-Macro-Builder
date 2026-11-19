# The power commands of powershell\commands\power.ps1. Every call that would lock, sleep, hibernate,
# restart, shut down or turn off the monitors is mocked in BeforeEach, for every test.
BeforeAll {
    $ps = Split-Path $PSScriptRoot -Parent
    foreach ($f in 'Native', 'Interop', 'Pump', 'Window', 'WinTitle', 'WindowOps') { . "$ps\lib\$f.ps1" }
    # The functions of power.ps1 other than Lock-Workstation and Invoke-SuspendState that use the type
    # [Macropad.Native] themselves, and each use of it outside a function, by line. The tests cannot mock
    # those. It reads the file's syntax tree, so any spelling counts ([ Macropad.Native ], another case),
    # and so does the type kept in a variable ($n = [Macropad.Native]; $n::X()). A string that names the
    # type counts too, since the type can be looked up from one ([type]'Macropad.Native', -as [type],
    # [Type]::GetType). What it cannot see is a name put together when the file runs ('Macropad.' +
    # 'Native', a variable, Invoke-Expression of built text). It runs none of the file.
    function Get-DirectNativeCall {
        param([string]$Path = "$ps\commands\power.ps1")
        $ast = [System.Management.Automation.Language.Parser]::ParseFile($Path, [ref]$null, [ref]$null)
        $uses = $ast.FindAll({ param($n)
                ($n -is [System.Management.Automation.Language.TypeExpressionAst] -and $n.TypeName.FullName -eq 'Macropad.Native') -or
                ($n -is [System.Management.Automation.Language.StringConstantExpressionAst] -and $n.Value -match 'Macropad\.Native') -or
                ($n -is [System.Management.Automation.Language.ExpandableStringExpressionAst] -and $n.Value -match 'Macropad\.Native') }, $true)
        @(foreach ($use in $uses) {
                $fn = $use.Parent
                while ($fn -and $fn -isnot [System.Management.Automation.Language.FunctionDefinitionAst]) { $fn = $fn.Parent }
                if (-not $fn) { "line $($use.Extent.StartLineNumber), outside any function" }
                elseif ($fn.Name -notin 'Lock-Workstation', 'Invoke-SuspendState') { $fn.Name }
            }) | Select-Object -Unique
    }
    # Loaded only when it calls Windows through the wrappers alone: a call outside any function would
    # run as the file is loaded, before anything could stop it.
    if (-not @(Get-DirectNativeCall)) { . "$ps\commands\power.ps1" }
}
Describe 'Power commands reach Windows only through the wrappers the tests mock' {
    It 'calls [Macropad.Native] only inside Lock-Workstation and Invoke-SuspendState' {
        # When this fails, the block 'Power commands' below runs none of its tests (its BeforeAll stops it).
        Get-DirectNativeCall | Should -BeNullOrEmpty
    }
    It 'also sees the type looked up from a string, in a command or outside any function' {
        # A planted file, read and never run.
        $file = Join-Path $TestDrive 'planted.ps1'
        Set-Content -LiteralPath $file -Value @'
function Lock { param($Macro) ([type]'Macropad.Native')::LockWorkStation() }
function WinSleep { param($Macro) $t = "Macropad.Native" -as [type]; $t::SetSuspendState($false, $false, $false) }
function Lock-Workstation { [Macropad.Native]::LockWorkStation() }
[Type]::GetType('macropad.native')
'@
        (Get-DirectNativeCall $file) -join '; ' | Should -Be 'Lock; WinSleep; line 4, outside any function'
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
    BeforeAll {
        # A direct call in a command would lock, sleep or hibernate this PC during the tests, before any
        # assertion. Pester runs none of this block's tests when its BeforeAll throws.
        $direct = @(Get-DirectNativeCall)
        if ($direct) { throw "power.ps1 calls [Macropad.Native] outside the mocked wrappers, so no power test runs: $($direct -join ', ')" }
    }
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
    It 'TurnMonitorsOff raises an error and sends nothing when there is no desktop window, as the AutoHotkey version does' {
        Mock Find-Window { [IntPtr]::Zero } -ParameterFilter { $WinTitle -eq 'ahk_class Progman' }
        { TurnMonitorsOff $null } | Should -Throw 'No desktop window*'
        Should -Invoke Send-WindowMessage -Times 0 -Exactly
    }
    It 'TurnMonitorsOff looks for the desktop window even when it is hidden' {
        TurnMonitorsOff $null
        Should -Invoke Find-Window -Times 1 -Exactly -ParameterFilter { $WinTitle -eq 'ahk_class Progman' -and $IncludeHidden }
    }
}
