Describe 'blocking sleeps' {
    It 'appear nowhere in commands or lib except Instance.ps1' {
        $root = Split-Path $PSScriptRoot -Parent
        $hits = Get-ChildItem (Join-Path $root 'commands'), (Join-Path $root 'lib') -Recurse -Filter *.ps1 |
            Where-Object { $_.Name -ne 'Instance.ps1' } |
            Select-String -Pattern 'Start-Sleep|\bsleep\s+\d'
        $hits | ForEach-Object { "$($_.Path):$($_.LineNumber)" } | Should -BeNullOrEmpty
    }
}
