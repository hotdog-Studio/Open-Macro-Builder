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
