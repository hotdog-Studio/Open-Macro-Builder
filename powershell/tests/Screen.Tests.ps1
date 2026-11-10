BeforeAll {
    foreach ($f in 'Native', 'Interop', 'Pump', 'Screen') { . "$PSScriptRoot\..\lib\$f.ps1" }
    function New-Bitmap([int]$W, [int]$H, [int]$Rgb) {
        $b = New-Object System.Drawing.Bitmap $W, $H
        $g = [System.Drawing.Graphics]::FromImage($b); $g.Clear([System.Drawing.Color]::FromArgb(0xFF000000 -bor $Rgb)); $g.Dispose(); $b
    }
    function Set-Px($Bmp, $X, $Y, $Rgb) { $Bmp.SetPixel($X, $Y, [System.Drawing.Color]::FromArgb(0xFF000000 -bor $Rgb)) }
}
Describe 'ScreenApi.FindPixel' {
    It 'finds the first matching pixel' { $b = New-Bitmap 20 20 0xFFFFFF; Set-Px $b 7 9 0x123456; [Macropad.ScreenApi]::FindPixel($b, 0x123456, 0) | Should -Be @(7, 9) }
    It 'honours variation' {
        $b = New-Bitmap 20 20 0xFFFFFF; Set-Px $b 3 4 0x12345B
        [Macropad.ScreenApi]::FindPixel($b, 0x123456, 2) | Should -BeNullOrEmpty
        [Macropad.ScreenApi]::FindPixel($b, 0x123456, 5) | Should -Be @(3, 4)
    }
}
Describe 'ScreenApi.FindImage' {
    BeforeEach {
        $hay = New-Bitmap 50 40 0xFFFFFF; $needle = New-Bitmap 3 2 0x000000
        foreach ($p in @(@(0, 0, 0xFF0000), @(1, 0, 0x00FF00), @(2, 0, 0x0000FF), @(0, 1, 0x101010), @(1, 1, 0x202020), @(2, 1, 0x303030))) { Set-Px $needle $p[0] $p[1] $p[2]; Set-Px $hay (20 + $p[0]) (15 + $p[1]) $p[2] }
    }
    It 'finds an exact match' { [Macropad.ScreenApi]::FindImage($hay, $needle, 0, -1) | Should -Be @(20, 15) }
    It 'needs variation for near colours' { Set-Px $hay 21 16 0x252525; [Macropad.ScreenApi]::FindImage($hay, $needle, 0, -1) | Should -BeNullOrEmpty; [Macropad.ScreenApi]::FindImage($hay, $needle, 5, -1) | Should -Be @(20, 15) }
    It 'treats the transparent colour as a wildcard' { Set-Px $needle 1 1 0xFF00FF; Set-Px $hay 21 16 0x00FFFF; [Macropad.ScreenApi]::FindImage($hay, $needle, 0, 0xFF00FF) | Should -Be @(20, 15) }
}
Describe 'Find-Image' { It 'throws for a missing file' { { Find-Image 0 0 10 10 'C:\nope\missing.png' } | Should -Throw 'Image not found: C:\nope\missing.png' } }
Describe 'tooltips' {
    It 'shows, places and hides a tooltip' {
        Show-ToolTip 'hello' 100 120; $f = Get-ToolTipForm
        $f.Visible | Should -BeTrue; $f.Location.X | Should -Be 100; $f.Location.Y | Should -Be 120; $f.Controls[0].Text | Should -Be 'hello'
        Hide-ToolTip; $f.Visible | Should -BeFalse
    }
    It 'rejects ids above 20' { { Show-ToolTip 'x' -Id 21 } | Should -Throw }
}
Describe 'screen and mouse' -Tag Integration {
    It 'reads a pixel colour from a window on screen' {
        $f = New-Object System.Windows.Forms.Form; $f.FormBorderStyle = 'None'; $f.TopMost = $true; $f.StartPosition = 'Manual'; $f.Location = '50,50'; $f.Size = '40,40'; $f.BackColor = [System.Drawing.Color]::FromArgb(0x12, 0x34, 0x56)
        $f.Show(); Wait-Pump 150
        try { Get-PixelColor 70 70 | Should -Be 0x123456; ConvertTo-ScreenPoint $f.Handle 0 0 | ForEach-Object { $_.X | Should -Be 50; $_.Y | Should -Be 50 } } finally { $f.Dispose() }
    }
    It 'moves the mouse and reads it back' {
        $old = [System.Windows.Forms.Cursor]::Position
        try { Move-Mouse 300 310; $p = Get-MousePosition; $p.X | Should -Be 300; $p.Y | Should -Be 310 } finally { [System.Windows.Forms.Cursor]::Position = $old }
    }
}
