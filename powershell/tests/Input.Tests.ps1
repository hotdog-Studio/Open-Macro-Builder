BeforeAll { . "$PSScriptRoot\..\lib\Native.ps1"; . "$PSScriptRoot\..\lib\Input.ps1" }
Describe 'Get-VirtualKey' {
    It 'maps names case-insensitively' { Get-VirtualKey 'lwin' | Should -Be 0x5B; Get-VirtualKey 'F13' | Should -Be 0x7C; Get-VirtualKey 'a' | Should -Be 0x41 }
    It 'maps punctuation' { Get-VirtualKey '\' | Should -Be 0xDC; Get-VirtualKey "'" | Should -Be 0xDE }
    It 'throws for unknown names' { { Get-VirtualKey 'Bogus' } | Should -Throw "Unknown key name 'Bogus'" }
}
Describe 'Test-ExtendedKey' {
    It 'is true for arrows, Win and media keys' { Test-ExtendedKey 0x25 | Should -BeTrue; Test-ExtendedKey 0x5B | Should -BeTrue; Test-ExtendedKey 0xB3 | Should -BeTrue }
    It 'is false for letters and Ctrl' { Test-ExtendedKey 0x41 | Should -BeFalse; Test-ExtendedKey 0x11 | Should -BeFalse }
}
Describe 'ConvertTo-KeyEvent' {
    It 'holds modifiers, taps the last key, releases in reverse' {
        $e = ConvertTo-KeyEvent 'Ctrl+Shift+t'
        ($e | ForEach-Object { '{0}:{1}' -f $_.Vk, $_.Up }) -join ' ' | Should -Be '17:False 16:False 84:False 84:True 16:True 17:True'
    }
    It 'handles a single key' {
        $e = ConvertTo-KeyEvent 'Media_Play_Pause'
        $e.Count | Should -Be 2; $e[0].Vk | Should -Be 0xB3; $e[0].Up | Should -BeFalse; $e[1].Up | Should -BeTrue
    }
    It 'keeps the key name on each event' { (ConvertTo-KeyEvent 'LWin+Left')[1].Name | Should -Be 'Left' }
}
Describe 'Send-Chord' {
    It 'sends one event per entry in order' {
        Mock Send-KeyEvent {}
        Send-Chord 'LWin+Left'
        Should -Invoke Send-KeyEvent -Times 4 -Exactly
    }
}
Describe 'Send-Click' {
    It 'rejects unknown buttons' { Mock Send-KeyEvent {}; { Send-Click 1 1 'Nope' } | Should -Throw }
}
