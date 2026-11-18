BeforeAll {
    $ps = Split-Path $PSScriptRoot -Parent
    # '*' means every function of the file.
    $MustHave = [ordered]@{
        'commands\helper.ps1' = '*'
        'lib\Window.ps1'      = '*'
        'lib\Input.ps1'       = 'Send-Chord', 'Send-Key', 'Test-KeyPressed', 'Send-Click'
        'lib\Send.ps1'        = 'Send-Ahk', 'Send-Text', 'Wait-Key', 'Test-KeyToggled', 'Set-LockKeyState'
        'lib\Pump.ps1'        = 'Wait-Pump'
    }
    # One object per top-level function of lib\*.ps1 and commands\helper.ps1:
    # File (relative, as above), Name, Parameters (names), Help (GetHelpContent(), or $null), LineAbove (trimmed text).
    $Functions = foreach ($file in @(Get-ChildItem "$ps\lib\*.ps1") + @(Get-Item "$ps\commands\helper.ps1")) {
        $lines = Get-Content $file.FullName
        $ast = [System.Management.Automation.Language.Parser]::ParseFile($file.FullName, [ref]$null, [ref]$null)
        foreach ($fn in $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] }, $false)) {
            $params = @()
            if ($fn.Body.ParamBlock) { $params = @($fn.Body.ParamBlock.Parameters | ForEach-Object { $_.Name.VariablePath.UserPath }) }
            [pscustomobject]@{
                File       = $file.FullName.Substring($ps.Length + 1)
                Name       = $fn.Name
                Parameters = $params
                Help       = $fn.GetHelpContent()
                LineAbove  = $lines[$fn.Extent.StartLineNumber - 2].Trim()
            }
        }
    }
}
Describe 'Help blocks of the functions for commands' {
    It 'gives every block a synopsis and an example' {
        $bad = $Functions | Where-Object { $_.Help -and ([string]::IsNullOrWhiteSpace($_.Help.Synopsis) -or $_.Help.Examples.Count -eq 0) }
        $bad.Name | Should -BeNullOrEmpty
    }
    It 'describes exactly the parameters each function has' {
        # Joined and compared as text: Compare-Object refuses an empty list, and some functions take no parameters.
        $bad = foreach ($f in $Functions | Where-Object Help) {
            $documented = (@($f.Help.Parameters.Keys) | Sort-Object) -join ','
            $declared = (@($f.Parameters | ForEach-Object { $_.ToUpperInvariant() }) | Sort-Object) -join ','
            if ($documented -ne $declared) { $f.Name }
        }
        $bad | Should -BeNullOrEmpty
    }
    It 'puts every block on the line directly above its function' {
        ($Functions | Where-Object { $_.Help -and $_.LineAbove -ne '#>' }).Name | Should -BeNullOrEmpty
    }
    It 'documents the functions meant for commands' {
        $missing = foreach ($file in $MustHave.Keys) {
            $want = $MustHave[$file]
            $Functions | Where-Object { $_.File -eq $file -and ($want -eq '*' -or $want -contains $_.Name) -and -not $_.Help } | ForEach-Object Name
        }
        $missing | Should -BeNullOrEmpty
    }
    It 'names only functions that exist' {
        $missing = foreach ($file in $MustHave.Keys) {
            foreach ($name in @($MustHave[$file]) | Where-Object { $_ -ne '*' }) {
                if (-not ($Functions | Where-Object { $_.File -eq $file -and $_.Name -eq $name })) { "$file $name" }
            }
        }
        $missing | Should -BeNullOrEmpty
    }
    It 'heads each documented library file with a title line' {
        $bad = foreach ($file in $MustHave.Keys | Where-Object { $_ -like 'lib\*' }) {
            $first = (Get-Content (Join-Path $ps $file) -TotalCount 1)
            if ($first -notmatch '^# [A-Z][^.:]*$') { $file }
        }
        $bad | Should -BeNullOrEmpty
    }
}
