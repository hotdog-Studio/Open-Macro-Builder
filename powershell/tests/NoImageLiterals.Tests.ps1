Describe 'image path literals' {
    It 'appear only in lib/Assets.ps1' {
        $root = Split-Path $PSScriptRoot -Parent
        $hits = Get-ChildItem $root -Recurse -Filter *.ps1 |
            Where-Object { $_.FullName -notlike '*\lib\Assets.ps1' -and $_.FullName -notlike '*\tests\*' } |
            Select-String -Pattern 'img[\\/]'
        $hits | ForEach-Object { "$($_.Path):$($_.LineNumber)" } | Should -BeNullOrEmpty
    }
}
