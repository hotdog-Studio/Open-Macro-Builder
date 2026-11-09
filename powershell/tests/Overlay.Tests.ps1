BeforeAll {
    . "$PSScriptRoot\..\lib\Native.ps1"; . "$PSScriptRoot\..\lib\Assets.ps1"; . "$PSScriptRoot\..\lib\Model.ps1"; . "$PSScriptRoot\..\lib\Overlay.ps1"
    function Act { param($m) }
    function New-Fixture([bool]$Markers = $true, [bool]$Labels = $true, [bool]$MacroIcons = $false, [string]$IconAction = 'Layer') {
        $keys = @((Key 'F13' 1 1), (Key 'F14' 1 2), (Key 'F15' 1 3))
        $m0 = Macro 'Act' 'M0' 'd0' (Icon 'godot'); $m2 = Macro 'Act' 'M2' 'd2'; $m1b = Macro 'Act' 'M1b' 'd1b'
        $layers = @((Layer 'A' (Icon 'chrome') @($m0, '', $m2)), '', (Layer 'C' (Icon 'putty') @('', $m1b, '')))
        Layout (Key 'ScrollLock' 2 1 2 1) $keys $layers 1 $false $Markers $Labels $MacroIcons $IconAction
    }
    function P([string]$rel) { Get-AssetPath $rel }
}
Describe 'Get-EmptyIconPath' {
    It 'picks by size' { Get-EmptyIconPath (Key 'x' 1 1 1 2) | Should -Be (P 'empty_1x2.png'); Get-EmptyIconPath (Key 'x' 1 1 3 1) | Should -Be (P 'empty.png') }
}
Describe 'Get-ButtonState images with markers and labels' {
    BeforeAll { $l = New-Fixture }
    It 'selected layer with its own macro -> selected_macro' { (Get-ButtonState $l 0 0).Image | Should -Be (P 'chrome\selected_macro.png') }
    It 'blank layer without macro -> blank' { (Get-ButtonState $l 0 1).Image | Should -Be (P 'blank.png') }
    It 'other layer where selected has a macro -> macro' { (Get-ButtonState $l 0 2).Image | Should -Be (P 'putty\macro.png') }
    It 'other layer where selected has no macro -> layer' { (Get-ButtonState $l 2 0).Image | Should -Be (P 'chrome\layer.png') }
    It 'blank layer where selected has a macro -> empty icon sized to the key' { (Get-ButtonState $l 2 1).Image | Should -Be (P 'empty_1x1.png') }
    It 'selected layer without its own macro -> selected' { (Get-ButtonState $l 2 2).Image | Should -Be (P 'putty\selected.png') }
    It 'labels show the selected layer macro names' { (Get-ButtonState $l 0 0).Label | Should -Be 'M0'; (Get-ButtonState $l 0 1).Label | Should -Be ''; (Get-ButtonState $l 2 1).Label | Should -Be 'M1b' }
    It 'tooltips: layer title on buttons, macro on labels' {
        (Get-ButtonState $l 0 0).ButtonTooltip | Should -Be 'A'; (Get-ButtonState $l 0 1).ButtonTooltip | Should -Be ''
        (Get-ButtonState $l 0 0).LabelTooltip | Should -Be "M0`nd0"
    }
    It 'buttons select layers, labels run macros' { $s = Get-ButtonState $l 0 0; $s.ButtonClick | Should -Be 'Layer'; $s.LabelClick | Should -Be 'Macro' }
}
Describe 'Get-ButtonState option variants' {
    It 'without markers uses plain layer/selected images' {
        $l = New-Fixture -Markers $false
        (Get-ButtonState $l 0 0).Image | Should -Be (P 'chrome\selected.png'); (Get-ButtonState $l 0 2).Image | Should -Be (P 'putty\layer.png'); (Get-ButtonState $l 2 1).Image | Should -Be (P 'blank.png')
    }
    It 'without labels buttons run macros and show macro tooltips' {
        $l = New-Fixture -Labels $false
        $s = Get-ButtonState $l 0 0; $s.Label | Should -Be ''; $s.ButtonClick | Should -Be 'Macro'; $s.ButtonTooltip | Should -Be "M0`nd0"
    }
    It 'IconAction Macro makes buttons run macros' { (Get-ButtonState (New-Fixture -IconAction 'Macro') 0 0).ButtonClick | Should -Be 'Macro' }
    It 'UseMacroIcons uses the macro icon and layer titles as labels' {
        $l = New-Fixture -MacroIcons $true
        $s = Get-ButtonState $l 0 0; $s.Image | Should -Be (P 'godot\selected_macro.png'); $s.Label | Should -Be 'A'; $s.LabelClick | Should -Be 'Layer'
        (Get-ButtonState $l 0 1).Label | Should -Be ''
    }
}
Describe 'Get-CachedImage' {
    It 'throws naming a missing file' { { Get-CachedImage 'C:\definitely\missing.png' } | Should -Throw 'Image not found: C:\definitely\missing.png' }
    It 'loads and caches' {
        $a = Get-CachedImage (P 'blank.png'); $b = Get-CachedImage (P 'blank.png')
        $a.Width | Should -Be 64; [object]::ReferenceEquals($a, $b) | Should -BeTrue
    }
}
