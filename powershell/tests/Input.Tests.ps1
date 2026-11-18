BeforeAll { . "$PSScriptRoot\..\lib\Native.ps1"; . "$PSScriptRoot\..\lib\Interop.ps1"; . "$PSScriptRoot\..\lib\Input.ps1" }
Describe 'Get-VirtualKey' {
    It 'maps names case-insensitively' { Get-VirtualKey 'lwin' | Should -Be 0x5B; Get-VirtualKey 'F13' | Should -Be 0x7C; Get-VirtualKey 'a' | Should -Be 0x41 }
    It 'maps punctuation to the keys of a US keyboard when the layout cannot say' {
        Mock Get-LayoutVirtualKey { -1 }
        Get-VirtualKey '\' | Should -Be 0xDC; Get-VirtualKey "'" | Should -Be 0xDE
    }
    It 'throws for unknown names' { { Get-VirtualKey 'Bogus' } | Should -Throw "Unknown key name 'Bogus'" }
}
Describe 'Get-VirtualKey on the keyboard layout in use' {
    It 'gives the key a layout that agrees with the table names' {
        Mock Get-LayoutVirtualKey { 0xDC } -ParameterFilter { $Char -eq '\' }
        Get-VirtualKey '\' | Should -Be 0xDC
    }
    It 'gives the key that types the character where the layout puts it on another key' {
        # en-GB: ' is on the key a US keyboard has ; ... and ` on its own key, vk DF.
        Mock Get-LayoutVirtualKey { 0xC0 } -ParameterFilter { $Char -eq "'" }
        Mock Get-LayoutVirtualKey { 0xDF } -ParameterFilter { $Char -eq '`' }
        Get-VirtualKey "'" | Should -Be 0xC0
        Get-VirtualKey '`' | Should -Be 0xDF
    }
    It 'gives the key of the table when the lookup fails' {
        Mock Get-LayoutVirtualKey { -1 }
        Get-VirtualKey '`' | Should -Be 0xC0
        Get-VirtualKey ']' | Should -Be 0xDD
    }
    It 'asks the layout for every symbol name of the table' {
        Mock Get-LayoutVirtualKey { -1 }
        foreach ($name in '\', "'", ';', '=', ',', '-', '.', '/', '`', '[', ']') { [void](Get-VirtualKey $name) }
        Should -Invoke Get-LayoutVirtualKey -Times 11 -Exactly
    }
    It 'leaves letters, digits and named keys as they are' {
        Mock Get-LayoutVirtualKey { 0x99 }
        Get-VirtualKey 'a' | Should -Be 0x41
        Get-VirtualKey '7' | Should -Be 0x37
        Get-VirtualKey 'Enter' | Should -Be 0x0D
        Get-VirtualKey 'F5' | Should -Be 0x74
        Should -Invoke Get-LayoutVirtualKey -Times 0 -Exactly
    }
    It 'presses the key alone in a chord, without the Shift the character may need' {
        Mock Get-LayoutVirtualKey { 0xC0 } -ParameterFilter { $Char -eq "'" }
        $e = ConvertTo-KeyEvent "Ctrl+'"
        ($e | ForEach-Object { '{0}:{1}' -f $_.Vk, $_.Up }) -join ' ' | Should -Be '17:False 192:False 192:True 17:True'
    }
    It 'reads the layout without raising an error' {
        $vk = Get-LayoutVirtualKey '\'
        $vk | Should -BeOfType [int]
        $vk | Should -BeGreaterOrEqual -1
        $vk | Should -BeLessThan 255
    }
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
