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
Describe 'New-Overlay / Select-Layer' {
    BeforeAll { $l = New-Fixture; $o = New-Overlay $l }
    It 'creates one picture box and label per key and sizes the form' {
        $o.Buttons.Count | Should -Be 3; $o.Labels.Count | Should -Be 3
        $o.Form.ClientSize.Width | Should -Be 192; $o.Form.ClientSize.Height | Should -Be 81
        $o.Form.TransparencyKey.ToArgb() | Should -Be ([System.Drawing.Color]::FromArgb(1,1,1).ToArgb())
    }
    It 'starts with nothing selected' { $o.Selected | Should -Be -1 }
    It 'refuses blank and out-of-range layers' { Select-Layer $o 1 | Should -BeFalse; Select-Layer $o 7 | Should -BeFalse; $o.Selected | Should -Be -1 }
    It 'selects a layer and renders its state' {
        Select-Layer $o 0 | Should -BeTrue
        $o.Selected | Should -Be 0
        $o.Labels[0].Text | Should -Be 'M0'; $o.Labels[1].Text | Should -Be ''
        $o.Labels[1].BackColor.ToArgb() | Should -Be $o.Form.TransparencyKey.ToArgb()
        [object]::ReferenceEquals($o.Buttons[0].Image, (Get-CachedImage (P 'chrome\selected_macro.png'))) | Should -BeTrue
        $o.ToolTip.GetToolTip($o.Labels[0]) | Should -Be "M0`nd0"
    }
    It 'shows the Fn key when ShowFn is set' {
        $l2 = Layout (Key 'ScrollLock' 2 1 2 1) @((Key 'F13' 1 1)) @((Layer 'A' (Icon 'chrome'))) 1 ' ' $true $true
        $o2 = New-Overlay $l2
        $o2.FnButton | Should -Not -BeNullOrEmpty; $o2.FnLabel.Text | Should -Be ' '; $o2.Form.ClientSize.Height | Should -Be 164
    }
}
# Hide-Overlay puts the overlay's tooltip away with the overlay: the tooltip is a window of its own (the
# common control Windows Forms makes for System.Windows.Forms.ToolTip), not a child of the form, so hiding
# the form leaves a tip that is showing on the screen until its own five seconds run out. Hide-Overlay
# switches the ToolTip off and on again (Active), which takes a showing tip away. Whether a tip that shows
# goes is seen on a screen only, in the end-to-end test (E2eOverlayIcon, Invoke-E2eOverlayPointer), and
# these tests do not show it: they pass on the code before the change as well, and cannot fail for the
# defect itself. What they guard is that hiding leaves the tooltip switched on and with its texts, so they
# would fail a version that switched it off and forgot to switch it on again.
Describe 'Hide-Overlay' {
    BeforeAll { . "$PSScriptRoot\..\lib\Interop.ps1" }   # the window functions (Macropad.WindowApi); it only compiles types
    It 'leaves the tooltip switched on, with its texts, when it hides an overlay that was never shown' {
        $o = New-Overlay (New-Fixture)
        Select-Layer $o 0 | Should -BeTrue
        Hide-Overlay $o
        $o.ToolTip.Active | Should -BeTrue
        $o.Form.Visible | Should -BeFalse
        $o.ToolTip.GetToolTip($o.Labels[0]) | Should -Be "M0`nd0"
        $o.ToolTip.GetToolTip($o.Buttons[0]) | Should -Be 'A'
    }
    # The tooltip's own window is made when the handle of a control that has a tip is: the ToolTip's
    # HandleCreated handler for that control looks up its top-level control (the form, whose handle is made
    # first) and creates its window, a popup of the form without WS_VISIBLE that the control itself shows
    # only when the pointer rests on a tool (dotnet/winforms ToolTip.cs: HandleCreated, CreateRegion,
    # TopLevelCreated, CreateHandle). Creating a label's handle without Show() makes the windows and nothing
    # visible; from then on the Active setter sends TTM_ACTIVATE, as it does in the macropad, and hiding
    # must not throw.
    It 'hides, and leaves the tooltip switched on, once the form''s window and the tooltip''s exist but nothing shows' {
        $tooltips = { @([Macropad.WindowApi]::TopLevel() | Where-Object { [Macropad.WindowApi]::ProcessId($_) -eq $PID -and [Macropad.WindowApi]::ClassName($_) -match 'tooltips_class32' }) }
        $before = & $tooltips
        $o = New-Overlay (New-Fixture)
        try {
            Select-Layer $o 0 | Should -BeTrue
            $label = $o.Labels[0].Handle
            $form = $o.Form.Handle
            $made = @(& $tooltips | Where-Object { $_ -notin $before })
            $made.Count | Should -BeGreaterThan 0 -Because 'the handle of a control with a tip brings the ToolTip''s own window with it, so Active reaches the control'
            { Hide-Overlay $o } | Should -Not -Throw
            $o.ToolTip.Active | Should -BeTrue
            [Macropad.WindowApi]::Visible($form) | Should -BeFalse
            foreach ($t in $made) { [Macropad.WindowApi]::Visible($t) | Should -BeFalse }
            $o.ToolTip.GetToolTip($o.Labels[0]) | Should -Be "M0`nd0"
        } finally { $o.Form.Dispose(); $o.ToolTip.Dispose() }
    }
}
