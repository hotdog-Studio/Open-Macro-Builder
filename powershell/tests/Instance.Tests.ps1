BeforeAll { . "$PSScriptRoot\..\lib\Instance.ps1"; $f = Join-Path $env:TEMP "macropad-test-$PID.pid" }
Describe 'Enter-SingleInstance' {
    AfterEach { Remove-Item $f -ErrorAction SilentlyContinue }
    It 'writes its own pid when no file exists' { Enter-SingleInstance $f; Get-Content $f | Should -Be "$PID" }
    It 'does not kill itself when the file already holds its pid' { Set-Content $f "$PID"; Enter-SingleInstance $f; Get-Content $f | Should -Be "$PID" }
    It 'overwrites a stale or garbage pid' { Set-Content $f 'garbage'; Enter-SingleInstance $f; Get-Content $f | Should -Be "$PID" }
    It 'ignores a live pid that is not a macropad' { Set-Content $f "$((Get-Process explorer)[0].Id)"; { Enter-SingleInstance $f } | Should -Not -Throw; Get-Content $f | Should -Be "$PID"; Get-Process explorer | Should -Not -BeNullOrEmpty }
}
Describe 'Exit-SingleInstance' {
    AfterEach { Remove-Item $f -ErrorAction SilentlyContinue }
    It 'removes only its own pid file' { Set-Content $f '1'; Exit-SingleInstance $f; $f | Should -Exist; Set-Content $f "$PID"; Exit-SingleInstance $f; $f | Should -Not -Exist }
}
