BeforeAll {
    . "$PSScriptRoot\..\lib\Assets.ps1"; . "$PSScriptRoot\..\lib\Model.ps1"
    function New-Keys12 { 1..12 | ForEach-Object { Key "F$(12 + $_)" ([int][math]::Floor(($_ - 1) / 3) + 1) ((($_ - 1) % 3) + 1) } }
    function Defined-Action { param($m) }
}
Describe 'Key geometry' {
    It 'is 64px cells when unlabelled' { $k = Key 'F16' 2 1; $k.X | Should -Be 0; $k.Y | Should -Be 64; $k.W | Should -Be 64; $k.H | Should -Be 64; $k.Label.H | Should -Be 0 }
    It 'adds a 17px label row when the layout shows labels' {
        $l = Layout (Key 'ScrollLock' 4 1 2 1) @((Key 'F13' 1 1), (Key 'F22' 1 4 1 2), (Key 'F99' 2 1 2 1)) @() 1 $false $false $true
        $l.Keys[0].Label.Y | Should -Be 0;   $l.Keys[0].Y | Should -Be 17;  $l.Keys[0].H | Should -Be 64
        $l.Keys[1].Label.X | Should -Be 192; $l.Keys[1].H | Should -Be 145
        $l.Keys[2].Label.Y | Should -Be 83;  $l.Keys[2].W | Should -Be 128; $l.Keys[2].Label.W | Should -Be 128
        $l.Fn.Label.Y | Should -Be 249;      $l.Fn.W | Should -Be 128
    }
}
Describe 'Icon' {
    It 'builds the four state paths' {
        $i = Icon 'chrome'
        $i.Layer | Should -Be (Get-AssetPath 'chrome\layer.png'); $i.SelectedMacro | Should -Be (Get-AssetPath 'chrome\selected_macro.png')
    }
}
Describe 'Layer and Macro' {
    It 'stores blanks as null' { (Layer 'X' (Icon 'chrome') @('', (Macro 'A' 'a'))).Macros[0] | Should -BeNullOrEmpty }
    It 'keeps action, name and description' { $m = Macro 'Fn' 'N' 'D'; $m.Action | Should -Be 'Fn'; $m.Name | Should -Be 'N'; $m.Description | Should -Be 'D' }
}
Describe 'Layout' {
    It 'rejects more layers than keys' {
        $layers = 1..13 | ForEach-Object { Layer "L$_" (Icon 'chrome') @() }
        { Layout (Key 'ScrollLock') (New-Keys12) $layers } | Should -Throw 'Too many layers (13) for this amount of buttons (12).'
    }
    It 'rejects more macros than keys and names the layer' {
        $macros = 1..13 | ForEach-Object { Macro 'Defined-Action' "M$_" }
        { Layout (Key 'ScrollLock') (New-Keys12) @((Layer 'Big' (Icon 'chrome') $macros)) } | Should -Throw 'Too many macros (13) for this amount of buttons (12). - Big Layer'
    }
    It 'rejects an unknown icon action' { { Layout (Key 'ScrollLock') (New-Keys12) @() 1 $false $false $false $false 'Bogus' } | Should -Throw "Invalid action. Use 'Macro' or 'Layer'." }
    It 'stores blank layers as null and Default as a 0-based index' {
        $l = Layout (Key 'ScrollLock') (New-Keys12) @('', (Layer 'A' (Icon 'chrome'))) 2
        $l.Layers[0] | Should -BeNullOrEmpty; $l.Layers[1].Title | Should -Be 'A'; $l.DefaultIndex | Should -Be 1
    }
    It 'normalises ShowFn' {
        (Layout (Key 'ScrollLock') (New-Keys12) @() 1 $false).ShowFn | Should -Be ''
        (Layout (Key 'ScrollLock') (New-Keys12) @() 1 $true).ShowFn | Should -Be 'ScrollLock'
        (Layout (Key 'ScrollLock') (New-Keys12) @() 1 ' ').ShowFn | Should -Be ' '
    }
}
Describe 'Get-InitialLayerIndex / Test-NoLayers' {
    It 'uses Default when it points at a real layer' { (Get-InitialLayerIndex (Layout (Key 'S') (New-Keys12) @('', (Layer 'A' (Icon 'chrome'))) 2)) | Should -Be 1 }
    It 'falls back to the first real layer' { (Get-InitialLayerIndex (Layout (Key 'S') (New-Keys12) @('', (Layer 'A' (Icon 'chrome'))) 1)) | Should -Be 1 }
    It 'returns -1 and Test-NoLayers true when all layers are blank' {
        $l = Layout (Key 'S') (New-Keys12) @('', '')
        Get-InitialLayerIndex $l | Should -Be -1; Test-NoLayers $l | Should -BeTrue
    }
}
Describe 'Test-LayoutActions' {
    It 'lists every undefined function with its macro name' {
        $l = Layout (Key 'S') (New-Keys12) @((Layer 'A' (Icon 'chrome') @((Macro 'NoSuchFn' 'One'), (Macro 'Defined-Action' 'Two'), (Macro { } 'Three'), (Macro 'AlsoMissing' 'Four'))))
        { Test-LayoutActions $l } | Should -Throw 'Undefined macro action(s): NoSuchFn (One), AlsoMissing (Four)'
    }
    It 'passes when every string action is a function' {
        $l = Layout (Key 'S') (New-Keys12) @((Layer 'A' (Icon 'chrome') @((Macro 'Defined-Action' 'Two'))))
        { Test-LayoutActions $l } | Should -Not -Throw
    }
}
