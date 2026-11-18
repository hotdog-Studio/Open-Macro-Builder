BeforeAll {
    $ps = Split-Path $PSScriptRoot -Parent
    # '*' means every function of the file.
    $MustHave = [ordered]@{
        'commands\helper.ps1' = '*'
        'lib\Window.ps1'      = '*'
        'lib\Input.ps1'       = 'Send-Chord', 'Send-Key', 'Test-KeyPressed', 'Send-Click'
        'lib\Send.ps1'        = 'Send-Ahk', 'Send-Text', 'Wait-Key', 'Test-KeyToggled', 'Set-LockKeyState'
        'lib\Pump.ps1'        = 'Wait-Pump'
        'lib\WinTitle.ps1'    = 'Find-Window', 'Test-WindowActive', 'Get-WindowInfo'
        'lib\WindowOps.ps1'   = 'Switch-Window', 'Wait-Window', 'Wait-WindowClose', 'Close-Window', 'Set-WindowState', 'Get-WindowState', 'Move-Window', 'Get-WindowRect', 'Set-WindowTopmost', 'Set-WindowTransparency', 'Get-WindowStyle', 'Set-WindowStyle', 'Find-Control', 'Get-ControlText', 'Set-ControlText', 'Send-WindowMessage', 'Invoke-ControlClick', 'Send-ControlKeys'
        'lib\Screen.ps1'      = 'Get-PixelColor', 'Find-Pixel', 'Find-Image', 'Move-Mouse', 'Get-MousePosition', 'ConvertTo-ScreenPoint', 'Show-ToolTip', 'Hide-ToolTip'
        'lib\Sound.ps1'       = 'Get-SoundVolume', 'Set-SoundVolume', 'Get-SoundMute', 'Set-SoundMute', 'Switch-SoundMute'
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
    It 'documents every port of ahk-builtins.md but Hotkey and Hotstring' {
        $rows = Get-Content "$ps\docs\ahk-builtins.md" | Where-Object { $_ -match '^\|' -and $_ -notmatch '^\|\s*-' } | ForEach-Object {
            $cells = @($_.Trim().Trim('|').Split('|') | ForEach-Object { $_.Trim() })
            [pscustomobject]@{ PowerShell = $cells[1]; Kind = $cells[2] }
        } | Where-Object Kind -eq 'port'
        $ports = $rows | ForEach-Object { [regex]::Matches($_.PowerShell, '`([A-Z][A-Za-z]*(?:-[A-Z][A-Za-z]*)?)`') | ForEach-Object { $_.Groups[1].Value } } |
            Sort-Object -Unique | Where-Object { $_ -notin 'Hotkey', 'Hotstring' }
        $ports.Count | Should -Be 42
        $ports | Where-Object { $name = $_; -not ($Functions | Where-Object { $_.Name -eq $name -and $_.Help }) } | Should -BeNullOrEmpty
    }
    It 'gives a help block to nothing else in the library' {
        $listed = foreach ($file in $MustHave.Keys) {
            $want = $MustHave[$file]
            $Functions | Where-Object { $_.File -eq $file -and ($want -eq '*' -or $want -contains $_.Name) } | ForEach-Object Name
        }
        ($Functions | Where-Object { $_.Help -and $listed -notcontains $_.Name }).Name | Should -BeNullOrEmpty
        @($listed).Count | Should -Be 62
    }
}
