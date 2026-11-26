BeforeAll {
    . "$PSScriptRoot\..\lib\Native.ps1"; . "$PSScriptRoot\..\lib\Interop.ps1"; . "$PSScriptRoot\..\lib\Input.ps1"
    # The tests 'on this PC' read the keyboard layout of the active window. The two that need a key
    # typing a as VK_A first check that condition, from what Windows says the layout is, and skip, naming
    # it, when it does not hold. The check uses none of the [Macropad.Native] calls the tests exercise,
    # so a broken call fails its test instead of skipping it.
    if (-not ('LayoutTest.Win' -as [type])) {
        Add-Type -Namespace LayoutTest -Name Win -MemberDefinition @"
[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, IntPtr processId);
[DllImport("user32.dll")] public static extern IntPtr GetKeyboardLayout(uint thread);
"@
    }
    function Get-ActiveLayoutHandle {
        $handle = [LayoutTest.Win]::GetKeyboardLayout([LayoutTest.Win]::GetWindowThreadProcessId([LayoutTest.Win]::GetForegroundWindow(), [IntPtr]::Zero))
        $handle.ToInt64() -band 0xFFFFFFFFL
    }
    # The language a keyboard layout handle (HKL) is made for. The low word is the language of the input
    # language; the high word names the layout: the same or another language id for a plain layout (such
    # as 0x04190409, the Russian layout used for English), 0xE0nn for an input method (IME) of the low
    # word's language (Japanese, Korean, Chinese), or 0xFnnn for a variant (such as US-Dvorak), which
    # the registry lists under its Layout Id with the KLID that holds its language.
    function Get-LayoutLanguage([long]$Handle) {
        $low = [int]($Handle -band 0xFFFF)
        $high = [int](($Handle -shr 16) -band 0xFFFF)
        if ($high -lt 0xE000) { return $high }
        if ($high -ge 0xF000) {
            $id = '{0:X4}' -f ($high -band 0x0FFF)
            $klid = @(Get-ChildItem 'HKLM:\SYSTEM\CurrentControlSet\Control\Keyboard Layouts' |
                    Where-Object { (Get-ItemProperty $_.PSPath).'Layout Id' -eq $id } | ForEach-Object { $_.PSChildName })[0]
            if ($klid) { return [Convert]::ToInt32($klid.Substring(4), 16) }
        }
        $low
    }
    # Why a test that needs a key typing a as VK_A cannot run on the layout Handle, or $null when it can.
    # That holds for layouts made for a language written in Latin letters (Windows code pages 1250, 1252,
    # 1254, 1257, 1258) and for the Chinese, Japanese and Korean ones (932, 936, 949, 950), IMEs included,
    # whose letter keys are those of a US keyboard.
    function Get-NoLatinLetterReason([long]$Handle = (Get-ActiveLayoutHandle)) {
        $language = Get-LayoutLanguage $Handle
        $where = 'the keyboard layout of the active window (0x{0:X8})' -f $Handle
        try { $culture = [System.Globalization.CultureInfo]::GetCultureInfo($language) } catch { $culture = $null }
        if (-not $culture) { return '{0} is made for language 0x{1:X4}, which .NET does not know' -f $where, $language }
        $codePage = $culture.TextInfo.ANSICodePage
        if ($codePage -in 1250, 1252, 1254, 1257, 1258, 932, 936, 949, 950) { return $null }
        "$where is made for $($culture.Name), which is not written in Latin letters (code page $codePage)"
    }
}
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
        # en-GB: the key that types ' is vk C0 (the US code for `), and ` is vk DF.
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
}
Describe 'Get-VirtualKey for a character the table has no name for' {
    It 'names the key that types it on its own on the layout in use, such as # on a UK keyboard' {
        Mock Get-LayoutVirtualKey { 0xDE } -ParameterFilter { $Char -eq '#' }
        Get-VirtualKey '#' | Should -Be 0xDE
        ((ConvertTo-KeyEvent 'Ctrl+#') | ForEach-Object { '{0:X2}:{1}' -f $_.Vk, $_.Up }) -join ' ' | Should -Be '11:False DE:False DE:True 11:True'
    }
    It 'stays unknown where the layout cannot type it on its own' {
        Mock Get-LayoutVirtualKey { -1 }
        { Get-VirtualKey '#' } | Should -Throw "Unknown key name '#'"
    }
    It 'asks the layout only for one printable character' {
        Mock Get-LayoutVirtualKey { 0x99 }
        { Get-VirtualKey 'Bogus' } | Should -Throw "Unknown key name 'Bogus'"
        { Get-VirtualKey ' ' } | Should -Throw
        Should -Invoke Get-LayoutVirtualKey -Times 0 -Exactly
    }
}
Describe 'The Latin-letter check of the tests on this PC' {
    It 'runs the tests on <Name> (0x<Hex>)' -ForEach @(
        @{ Name = 'en-GB'; Hex = '08090809' }
        @{ Name = 'en-US'; Hex = '04090409' }
        @{ Name = 'fr-FR AZERTY'; Hex = '040C040C' }
        @{ Name = 'US-Dvorak, a variant'; Hex = 'F0020409' }
        # The three IME handles are identifiers Microsoft lists for the classic input methods: E0010411
        # Japanese Input System, E0010412 Korean Input System, E00E0804 Chinese (Simplified) - Microsoft
        # Pinyin IME 3.0 ("LP(MUI): How to add IME keyboards using the unattend .xml",
        # https://learn.microsoft.com/en-us/archive/blogs/yongrhee/lpmuihow-to-add-ime-keyboards-using-the-unattend-xml).
        @{ Name = 'the Japanese IME'; Hex = 'E0010411' }
        @{ Name = 'the Korean IME'; Hex = 'E0010412' }
        @{ Name = 'the Chinese (Simplified) Pinyin IME'; Hex = 'E00E0804' }
    ) {
        Get-NoLatinLetterReason ([Convert]::ToInt64($Hex, 16)) | Should -BeNullOrEmpty
    }
    It 'skips them on <Name> (0x<Hex>), saying why' -ForEach @(
        @{ Name = 'ru-RU'; Hex = '04190419'; Says = 'ru-RU*1251' }
        @{ Name = 'the Russian layout under English'; Hex = '04190409'; Says = 'ru-RU*1251' }
        @{ Name = 'el-GR'; Hex = '04080408'; Says = 'el-GR*1253' }
        @{ Name = 'a language .NET does not know'; Hex = '7FFF7FFF'; Says = '*language 0x7FFF*' }
    ) {
        Get-NoLatinLetterReason ([Convert]::ToInt64($Hex, 16)) | Should -BeLike "*$Says*"
    }
}
Describe 'Get-LayoutCharacter on this PC' {
    It 'gives the character a key types on the real keyboard layout' {
        $why = Get-NoLatinLetterReason; if ($why) { Set-ItResult -Skipped -Because $why; return }
        Get-LayoutCharacter 0x41 | Should -Be 'A'
        Get-LayoutCharacter 0x0D | Should -Not -BeNullOrEmpty
        Get-LayoutCharacter 0x7C | Should -Be '' -Because 'F13 types no character'
    }
}
Describe 'Get-LayoutVirtualKey' {
    BeforeEach {
        # Window 42 is the active one and has layout 0x111; any other window has layout 0x222.
        Mock Get-ForegroundWindowHandle { [IntPtr]42 }
        Mock Get-WindowKeyboardLayout { [IntPtr]0x111 } -ParameterFilter { $Hwnd -eq [IntPtr]42 }
        Mock Get-WindowKeyboardLayout { [IntPtr]0x222 } -ParameterFilter { $Hwnd -ne [IntPtr]42 }
    }
    It 'asks the keyboard layout of the active window, not that of another window' {
        Mock Get-LayoutKeyScan { 0x00C0 } -ParameterFilter { $Layout -eq [IntPtr]0x111 }
        Mock Get-LayoutKeyScan { 0x00DE } -ParameterFilter { $Layout -ne [IntPtr]0x111 }
        Get-LayoutVirtualKey "'" | Should -Be 0xC0
        Get-VirtualKey "'" | Should -Be 0xC0 -Because 'the table alone would give DE'
        Should -Invoke Get-LayoutKeyScan -ParameterFilter { $Char -eq "'" -and $Layout -eq [IntPtr]0x111 }
    }
    It 'gives no key when the layout needs <Needs> to type the character, so the table is used' -ForEach @(
        # de-DE: = is Shift+0, \ is AltGr (Ctrl+Alt) on the key right of 0.
        @{ Needs = 'Shift'; Char = '='; Scan = 0x0130; Table = 0xBB }
        @{ Needs = 'AltGr'; Char = '\'; Scan = 0x06DB; Table = 0xDC }
    ) {
        Mock Get-LayoutKeyScan { $Scan }
        Get-LayoutVirtualKey $Char | Should -Be -1
        Get-VirtualKey $Char | Should -Be $Table
    }
    It 'gives no key when no key types the character, or the lookup fails' {
        Mock Get-LayoutKeyScan { -1 }
        Get-LayoutVirtualKey "'" | Should -Be -1
        Mock Get-LayoutKeyScan { throw 'no layout' }
        Get-LayoutVirtualKey "'" | Should -Be -1
        Get-VirtualKey "'" | Should -Be 0xDE
    }
}
Describe 'Get-LayoutVirtualKey on this PC' {
    It 'finds the key of a on the real keyboard layout' {
        $why = Get-NoLatinLetterReason; if ($why) { Set-ItResult -Skipped -Because $why; return }
        # Any Latin layout types a with VK_A alone; a lookup that always failed would give -1.
        Get-LayoutVirtualKey 'a' | Should -Be 0x41
        Get-ForegroundKeyboardLayout | Should -Not -Be ([IntPtr]::Zero)
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
# Send-Chord hands Windows all the key events of one chord in one injection call (Invoke-KeyInjection, one
# SendInput), as the AutoHotkey version's Send does: no other input can land among them. Every test here
# stands in for that call, so nothing is sent to the desktop.
Describe 'Send-Chord' {
    BeforeAll {
        # A chord's events as they go to the injection: key (hex), down v or up ^, the scan code, and x
        # for the extended flag.
        function Format-ChordInput($Inputs) { (@($Inputs) | ForEach-Object { '{0:X2}{1} {2:X2}{3}' -f $_.Vk, ('v', '^')[[int]$_.Up], $_.Scan, ('', 'x')[[int]$_.Extended] }) -join ', ' }
    }
    BeforeEach {
        # The active window has layout 0x111, on which each key's scan code is its key code + 0x100; any
        # other layout would give 0. Windows takes every event it is given, unless a test says otherwise.
        $script:Calls = [System.Collections.Generic.List[string]]::new()
        Mock Get-ForegroundKeyboardLayout { [IntPtr]0x111 }
        Mock Get-LayoutScanCode { if ($Layout -eq [IntPtr]0x111) { $Vk + 0x100 } else { 0 } }
        Mock Invoke-KeyInjection { $script:Calls.Add((Format-ChordInput $Inputs)); @($Inputs).Count }
    }
    It 'hands Windows every event of a chord in one call: modifiers down in order, the key down and up, modifiers up in reverse' {
        Send-Chord 'Ctrl+Shift+t'
        $script:Calls.Count | Should -Be 1
        $script:Calls[0] | Should -Be '11v 111, 10v 110, 54v 154, 54^ 154, 10^ 110, 11^ 111'
    }
    It 'hands Windows a key alone as one call of its down and up' {
        Send-Chord 'Enter'
        $script:Calls.Count | Should -Be 1
        $script:Calls[0] | Should -Be '0Dv 10D, 0D^ 10D'
    }
    It 'hands Windows a chord of several modifiers in one call' {
        Send-Chord 'Ctrl+Shift+LAlt+F5'
        $script:Calls.Count | Should -Be 1
        $script:Calls[0] | Should -Be '11v 111, 10v 110, A4v 1A4, 74v 174, 74^ 174, A4^ 1A4, 10^ 110, 11^ 111'
    }
    It 'gives the extended flag to the keys that need it, down and up, and to no other' {
        Send-Chord 'Ctrl+LWin+Left'
        $script:Calls[0] | Should -Be '11v 111, 5Bv 15Bx, 25v 125x, 25^ 125x, 5B^ 15Bx, 11^ 111'
        Send-Chord 'Media_Play_Pause'
        $script:Calls[1] | Should -Be 'B3v 1B3x, B3^ 1B3x'
    }
    It 'reads the keyboard layout of the active window once, before anything is sent' {
        Send-Chord 'Ctrl+Shift+t'
        Should -Invoke Get-ForegroundKeyboardLayout -Times 1 -Exactly
    }
    It 'makes as many calls as chords: two chords are never one call' {
        Send-Chord 'Ctrl+k'
        Send-Chord 'z'
        $script:Calls.Count | Should -Be 2
        $script:Calls[0] | Should -Be '11v 111, 4Bv 14B, 4B^ 14B, 11^ 111'
        $script:Calls[1] | Should -Be '5Av 15A, 5A^ 15A'
    }
    It 'sends nothing when a key name is unknown' {
        { Send-Chord 'Ctrl+Bogus' } | Should -Throw "Unknown key name 'Bogus'"
        Should -Invoke Invoke-KeyInjection -Times 0 -Exactly
    }
    It 'fails, naming the chord and both counts, when Windows takes <Taken> of its events' -ForEach @(
        @{ Taken = 2 }
        @{ Taken = 0 }
    ) {
        $script:TakenCount = $Taken
        Mock Invoke-KeyInjection { $script:TakenCount }
        { Send-Chord 'Alt+Tab' } | Should -Throw "Windows took $Taken of the 4 key events of the chord 'Alt+Tab'*"
    }
}
Describe 'Send-Chord: what one call hands Windows' {
    It 'is each event with the flags and the MPAD tag it had when each event went in a call of its own' {
        Mock Get-ForegroundKeyboardLayout { [IntPtr]0x111 }
        Mock Get-LayoutScanCode { if ($Layout -eq [IntPtr]0x111) { $Vk + 0x100 } else { 0 } }
        $inputs = ConvertTo-ChordInput (ConvertTo-KeyEvent 'Ctrl+LWin+Left')
        # Inject.Describe gives the records Inject.Send hands SendInput (key, scan code, flags, tag), and
        # sends nothing. One record per event, as the one-event calls of before (Inject.Key) gave them.
        $together = @([Macropad.Inject]::Describe($inputs))
        $alone = @(foreach ($k in $inputs) { [Macropad.Inject]::Describe([Macropad.KeyInput[]]@($k)) })
        ($together -join ' | ') | Should -Be ($alone -join ' | ')
        ($together -join ' | ') | Should -Be '11 111 0 4D504144 | 5B 15B 1 4D504144 | 25 125 1 4D504144 | 25 125 3 4D504144 | 5B 15B 3 4D504144 | 11 111 2 4D504144'
    }
}
Describe 'Get-LayoutScanCode on this PC' {
    It 'gives Enter its scan code on the real keyboard layout' {
        # Enter is scan code 1C on every layout, so this runs everywhere.
        Get-LayoutScanCode 0x0D (Get-ForegroundKeyboardLayout) | Should -Be 0x1C
    }
}
Describe 'Send-Click' {
    It 'rejects unknown buttons' { { Send-Click 1 1 'Nope' } | Should -Throw "Unknown mouse button 'Nope'" }
}
