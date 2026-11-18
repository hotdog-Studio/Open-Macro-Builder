# The reader of command files that ChordParity.Tests.ps1 uses (helpers\CommandSource.ps1): both
# languages read several sends in a row as one sequence, so a pair written that way is compared.
BeforeAll {
    $ps = Split-Path $PSScriptRoot -Parent
    foreach ($f in 'Input', 'AhkSyntax') { . "$ps\lib\$f.ps1" }
    . "$PSScriptRoot\helpers\CommandSource.ps1"
    $ahkFile = Join-Path $TestDrive 'pair.ahk'
    $psFile = Join-Path $TestDrive 'pair.ps1'
    Set-Content -LiteralPath $ahkFile -Encoding ASCII -Value @'
CopyPaste(Macro) {
    Send("^c")
    Send("^v")
}

GuardedCopyPaste(Macro) {
    if IsReady(Macro) {
        Send("^c")
        Send("^v")
    }
}

CopyWaitPaste(Macro) {
    Send("^c")
    Sleep 100
    Send("^v")
}

GuardThenMore(Macro) {
    if IsReady(Macro)
        Send("^c")
    Send("^v")
}
'@
    Set-Content -LiteralPath $psFile -Encoding ASCII -Value @'
function CopyPaste {
    param($Macro)
    Send-Chord 'Ctrl+C'
    Send-Chord 'Ctrl+V'
}
function GuardedCopyPaste {
    param($Macro)
    if (IsReady $Macro) {
        Send-Chord 'Ctrl+C'
        Send-Chord 'Ctrl+V'
    }
}
'@
    $ahk = Get-AhkFunctionSource $ahkFile
    $psSource = Get-PsFunctionSource $psFile
    function Get-AhkTap { param([string[]]$Sends) (@(foreach ($s in $Sends) { foreach ($tap in (ConvertTo-ChordTap (ConvertFrom-AhkSend $s).Events)) { $tap } })) -join ', ' }
    function Get-PsTap { param([string[]]$Chords) (@(foreach ($c in $Chords) { foreach ($tap in (ConvertTo-ChordTap (ConvertTo-KeyEvent $c))) { $tap } })) -join ', ' }
}
Describe 'Reading the sends of a command' {
    It 'reads two AutoHotkey Sends in a row as one sequence, in order' {
        (Get-AhkSends $ahk['CopyPaste']) | Should -Be @('^c', '^v')
    }
    It 'reads two AutoHotkey Sends in a row under a guard in braces, and the guard' {
        (Get-AhkSends $ahk['GuardedCopyPaste']) | Should -Be @('^c', '^v')
        Get-AhkGuard $ahk['GuardedCopyPaste'] | Should -Be 'IsReady'
    }
    It 'reads no sequence when something else stands between the Sends' {
        Get-AhkSends $ahk['CopyWaitPaste'] | Should -BeNullOrEmpty
    }
    It 'reads no guard when a Send follows the guarded one outside the guard' {
        Get-AhkGuard $ahk['GuardThenMore'] | Should -Be ''
        Get-AhkSends $ahk['GuardThenMore'] | Should -BeNullOrEmpty
    }
    It 'gives a pair written as two sends in each language the same taps, so it can be compared' {
        foreach ($n in 'CopyPaste', 'GuardedCopyPaste') {
            $sends = Get-AhkSends $ahk[$n]
            $sends | Should -Not -BeNullOrEmpty -Because "$n is two Sends"
            $psSource[$n].Chord | Should -Not -BeNullOrEmpty -Because "$n is two Send-Chord calls"
            Get-AhkTap $sends | Should -Be 'Ctrl+C, Ctrl+V' -Because $n
            Get-PsTap $psSource[$n].Chord | Should -Be 'Ctrl+C, Ctrl+V' -Because $n
            Get-AhkGuard $ahk[$n] | Should -Be $psSource[$n].Guard -Because $n
        }
    }
}
