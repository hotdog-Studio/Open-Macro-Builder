BeforeAll {
    $lib = "$PSScriptRoot\..\lib"
    foreach ($f in 'Native', 'Interop', 'Pump', 'Input', 'AhkSyntax', 'Send') { . "$lib\$f.ps1" }
    function Fmt($Inputs) { ($Inputs | ForEach-Object { $(if ($_.Char) { [string][char]$_.Char } else { '{0:X2}' -f $_.Vk }) + ('v', '^')[[int]$_.Up] }) -join ' ' }
}
Describe 'Interop' {
    It 'compiles every lib/cs file into one assembly' { [Macropad.Interop].Assembly | Should -Be ([Macropad.Inject].Assembly) }
    It 'uses the MPAD signature' { [Macropad.Interop]::Signature | Should -Be 0x4D504144 }
    It 'sizes INPUT like Win32' { [Macropad.Inject]::InputSize | Should -Be $(if ([Environment]::Is64BitProcess) { 40 } else { 28 }) }
    It 'shares the signature with Native.ps1' { Get-Content "$lib\Native.ps1" -Raw | Should -Match 'MacropadSignature = 0x4D504144' }
    It 'can be dot-sourced twice' { { . "$lib\Interop.ps1" } | Should -Not -Throw }
}
Describe 'ConvertTo-KeyInput' {
    It 'marks extended keys and carries characters' {
        $k = ConvertTo-KeyInput (ConvertFrom-AhkSend ('{Left}' + [char]0xE9)).Events
        $k.Count | Should -Be 4
        $k[0].Vk | Should -Be 0x25; $k[0].Extended | Should -BeTrue
        $k[2].Char | Should -Be 0xE9; $k[2].Vk | Should -Be 0
    }
}
Describe 'Send-Ahk' {
    BeforeEach { $script:sent = $null; Mock Send-KeyInput { $script:sent = $Inputs } }
    It 'releases held modifiers behind a menu mask' { Mock Get-HeldModifier { @(0xA4) }; Send-Ahk 'x'; Fmt $script:sent | Should -Be 'E8v E8^ A4^ xv x^' }
    It 'releases Ctrl without a mask' { Mock Get-HeldModifier { @(0xA2) }; Send-Ahk 'x'; Fmt $script:sent | Should -Be 'A2^ xv x^' }
    It 'leaves modifiers alone with Blind' { Mock Get-HeldModifier { @(0xA2) }; Send-Ahk '{Blind}x'; Fmt $script:sent | Should -Be 'xv x^' }
}
Describe 'Wait-Key' {
    It 'returns true once the key is released' { Mock Test-VirtualKeyDown { $false }; Wait-Key 'a' | Should -BeTrue }
    It 'times out while the key stays down' { Mock Test-VirtualKeyDown { $true }; Wait-Key 'a' -TimeoutMs 50 | Should -BeFalse }
    It 'waits for a press with -Down' { Mock Test-VirtualKeyDown { $true }; Wait-Key 'a' -Down -TimeoutMs 50 | Should -BeTrue }
}
Describe 'Set-LockKeyState' {
    It 'taps only when the state differs' {
        Mock Send-KeyInput {}
        Mock Test-KeyToggled { $false }; Set-LockKeyState CapsLock $true; Should -Invoke Send-KeyInput -Times 1 -Exactly
        Mock Test-KeyToggled { $true }; Set-LockKeyState CapsLock $true; Should -Invoke Send-KeyInput -Times 1 -Exactly
    }
}
