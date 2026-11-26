BeforeAll {
    . "$PSScriptRoot\..\lib\Assets.ps1"
    $imgDir = Join-Path (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent) 'img'
}
Describe 'Get-AssetPath' {
    It 'resolves under the img folder beside the powershell folder' {
        Get-AssetPath 'icon.ico' | Should -Be (Join-Path $imgDir 'icon.ico')
    }
    It 'converts forward slashes' {
        Get-AssetPath 'chrome/layer.png' | Should -Be (Join-Path $imgDir 'chrome\layer.png')
    }
    It 'points at the real tray icon' {
        Get-AssetPath 'icon.ico' | Should -Exist
    }
}
Describe 'Get-IconSetDir' {
    BeforeEach {
        Mock Get-AssetRoot { $TestDrive }
        New-Item -ItemType Directory "$TestDrive\img\cat", "$TestDrive\local\img\cat", "$TestDrive\local\img\dog" -Force | Out-Null
        Set-Content "$TestDrive\img\cat\layer.png" 'x'
    }
    AfterEach { Remove-Item "$TestDrive\*" -Recurse -Force }
    It 'uses img\<name> when local\img has no such set' {
        Get-IconSetDir 'cat' | Should -Be (Join-Path $TestDrive 'img\cat')
    }
    It 'prefers local\img\<name> when it holds a layer.png' {
        Set-Content "$TestDrive\local\img\cat\layer.png" 'x'
        Get-IconSetDir 'cat' | Should -Be (Join-Path $TestDrive 'local\img\cat')
    }
    It 'ignores a local folder without a layer.png' {
        Set-Content "$TestDrive\local\img\dog\macro.png" 'x'
        Get-IconSetDir 'dog' | Should -Be (Join-Path $TestDrive 'img\dog')
    }
}
Describe 'Get-SizedAssetPath' {
    It 'takes <base>_<w>x<h>.png when it exists' {
        Set-Content "$TestDrive\selected_macro_2x1.png" 'x'
        Get-SizedAssetPath "$TestDrive\selected_macro.png" 2 1 | Should -Be "$TestDrive\selected_macro_2x1.png"
    }
    It 'falls back to the base file' {
        Get-SizedAssetPath "$TestDrive\layer.png" 3 1 | Should -Be "$TestDrive\layer.png"
    }
}
