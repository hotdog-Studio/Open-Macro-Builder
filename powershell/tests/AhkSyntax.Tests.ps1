BeforeAll {
    . "$PSScriptRoot\..\lib\Native.ps1"; . "$PSScriptRoot\..\lib\Interop.ps1"; . "$PSScriptRoot\..\lib\Input.ps1"; . "$PSScriptRoot\..\lib\AhkSyntax.ps1"
    function Fmt($Result) {
        ($Result.Events | ForEach-Object {
            $label = if ($_.Char) { [string][char]$_.Char } else { '{0:X2}' -f $_.Vk }
            $label + ('v', '^')[[int]$_.Up]
        }) -join ' '
    }
}
Describe 'Get-AhkVirtualKey' {
    It 'resolves aliases, vk codes and chord names' {
        Get-AhkVirtualKey 'Esc' | Should -Be 0x1B; Get-AhkVirtualKey 'vk1B' | Should -Be 0x1B
        Get-AhkVirtualKey 'numpad5' | Should -Be 0x65; Get-AhkVirtualKey 'Enter' | Should -Be 0x0D
    }
    It 'throws for unknown names' { { Get-AhkVirtualKey 'Bogus' } | Should -Throw "Unknown key name 'Bogus'" }
}
Describe 'ConvertFrom-AhkSend' {
    It 'wraps a key in its modifiers' { Fmt (ConvertFrom-AhkSend '^c') | Should -Be '11v 43v 43^ 11^' }
    It 'picks sides and AltGr' { Fmt (ConvertFrom-AhkSend '<^>!e') | Should -Be 'A2v A5v 45v 45^ A5^ A2^' }
    It 'repeats named keys' { Fmt (ConvertFrom-AhkSend '{Enter 2}') | Should -Be '0Dv 0D^ 0Dv 0D^' }
    It 'holds and releases explicitly' { Fmt (ConvertFrom-AhkSend '{Shift down}a{Shift up}') | Should -Be '10v av a^ 10^' }
    It 'escapes modifier symbols' { Fmt (ConvertFrom-AhkSend 'Hi{!}') | Should -Be 'Hv H^ iv i^ !v !^' }
    It 'sends text mode literally' { Fmt (ConvertFrom-AhkSend '{Text}^c') | Should -Be '^v ^^ cv c^' }
    It 'turns newlines into Enter' { Fmt (ConvertFrom-AhkSend "a`nb") | Should -Be 'av a^ 0Dv 0D^ bv b^' }
    It 'sends Unicode code points' { Fmt (ConvertFrom-AhkSend '{U+00E9}') | Should -Be ('{0}v {0}^' -f [char]0xE9) }
    It 'reads Blind' { (ConvertFrom-AhkSend '{Blind}{Tab}').Blind | Should -BeTrue; (ConvertFrom-AhkSend '{Tab}').Blind | Should -BeFalse }
    It 'rejects bad input' { { ConvertFrom-AhkSend '{Enter' } | Should -Throw "Unbalanced braces in '{Enter'"; { ConvertFrom-AhkSend '{Bogus}' } | Should -Throw "Unknown key name 'Bogus'" }
}
Describe 'ConvertFrom-AhkHotkey' {
    It 'packs neutral modifiers' { $h = ConvertFrom-AhkHotkey '^!a'; $h.Vk | Should -Be 0x41; $h.Mods | Should -Be 15 }
    It 'packs sided modifiers' { (ConvertFrom-AhkHotkey '<^a').Mods | Should -Be 1; (ConvertFrom-AhkHotkey '>+F1').Mods | Should -Be 32; (ConvertFrom-AhkHotkey '<^>!e').Mods | Should -Be 9 }
    It 'reads flags' { $h = ConvertFrom-AhkHotkey '~*#x up'; $h.Passthrough | Should -BeTrue; $h.Wildcard | Should -BeTrue; $h.KeyUp | Should -BeTrue; $h.Mods | Should -Be 192 }
    It 'reads combinations' {
        $h = ConvertFrom-AhkHotkey 'a & b'; $h.PrefixVk | Should -Be 0x41; $h.Vk | Should -Be 0x42
        $m = ConvertFrom-AhkHotkey '~XButton1 & WheelUp'; $m.Passthrough | Should -BeTrue; $m.PrefixVk | Should -Be 0x05; $m.Vk | Should -Be 0x9F
    }
    It 'rejects modifiers in combinations' { { ConvertFrom-AhkHotkey '^a & b' } | Should -Throw "Modifiers are not allowed in a custom combination: '^a & b'" }
}
Describe 'ConvertFrom-AhkHotstring' {
    It 'reads a plain hotstring' { $h = ConvertFrom-AhkHotstring '::btw'; $h.Abbrev | Should -Be 'btw'; $h.Options | Should -Be 0; $h.Execute | Should -BeFalse }
    It 'reads options' { (ConvertFrom-AhkHotstring ':*?B0:ty').Options | Should -Be 19; (ConvertFrom-AhkHotstring ':C1:Abc').Options | Should -Be 8; (ConvertFrom-AhkHotstring ':X:go').Execute | Should -BeTrue }
    It 'rejects bad specs' { { ConvertFrom-AhkHotstring ':Q:x' } | Should -Throw "Unknown hotstring option 'Q' in ':Q:x'"; { ConvertFrom-AhkHotstring '::' } | Should -Throw "Empty hotstring abbreviation in '::'" }
}
