BeforeAll {
    $ps = Split-Path $PSScriptRoot -Parent
    # '*' means every function of the file.
    $MustHave = [ordered]@{
        'commands\helper.ps1' = '*'
        'commands\custom\chrome.ps1' = 'ActivateOrOpenChrome'
        'commands\custom\ssh.ps1' = 'LoadPuttySession'
        'lib\Window.ps1'      = '*'
        'lib\Input.ps1'       = 'Send-Chord', 'Send-Key', 'Test-KeyPressed', 'Send-Click'
        'lib\Send.ps1'        = 'Send-Ahk', 'Send-Text', 'Wait-Key', 'Test-KeyToggled', 'Set-LockKeyState'
        'lib\Pump.ps1'        = 'Wait-Pump'
        'lib\WinTitle.ps1'    = 'Find-Window', 'Test-WindowActive', 'Get-WindowInfo'
        'lib\WindowOps.ps1'   = 'Switch-Window', 'Wait-Window', 'Wait-WindowClose', 'Close-Window', 'Set-WindowState', 'Get-WindowState', 'Move-Window', 'Get-WindowRect', 'Set-WindowTopmost', 'Set-WindowTransparency', 'Get-WindowStyle', 'Set-WindowStyle', 'Find-Control', 'Get-ControlText', 'Set-ControlText', 'Send-WindowMessage', 'Invoke-ControlClick', 'Send-ControlKeys'
        'lib\Screen.ps1'      = 'Get-PixelColor', 'Find-Pixel', 'Find-Image', 'Move-Mouse', 'Get-MousePosition', 'ConvertTo-ScreenPoint', 'Show-ToolTip', 'Hide-ToolTip'
        'lib\Sound.ps1'       = 'Get-SoundVolume', 'Set-SoundVolume', 'Get-SoundMute', 'Set-SoundMute', 'Switch-SoundMute'
    }
    # The files read: lib\*.ps1 and every command file, in commands and its subfolders, so a block in any
    # of them is checked the same way.
    $Files = @(Get-ChildItem "$ps\lib\*.ps1") + @(Get-ChildItem "$ps\commands" -Recurse -Filter *.ps1)
    # One object per top-level function of those files: File (relative, as above), Name, Parameters (names),
    # Help (GetHelpContent(), or $null), LineAbove (trimmed text), Ast (the definition).
    $Functions = foreach ($file in $Files) {
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
                Ast        = $fn
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
        # The library and the files named above; a block in another command file is checked, not forbidden.
        $named = $Functions | Where-Object { $_.File -like 'lib\*' -or $MustHave.Contains($_.File) }
        ($named | Where-Object { $_.Help -and $listed -notcontains $_.Name }).Name | Should -BeNullOrEmpty
        @($listed).Count | Should -Be 66
    }
    It 'writes each example as a call that parses, calls only commands that exist and names whole parameters each command has' {
        # Every documented function, by name, so a call to another one inside an example is checked too.
        $byName = @{}
        foreach ($f in $Functions | Where-Object Help) { $byName[$f.Name] = $f }
        # The parameters of each function of the project's scripts: whole names, their [Alias()] names,
        # and whether it takes the common parameters (-ErrorAction and the like) as an advanced function does.
        $common = (Get-Command Get-Date).Parameters.Values | Where-Object { [System.Management.Automation.PSCmdlet]::CommonParameters -contains $_.Name }
        $project = @{}
        foreach ($f in $Functions) {
            $block = $f.Ast.Body.ParamBlock
            $parameters = if ($block) { @($block.Parameters) } else { @() }
            $advanced = $block -and (@($block.Attributes | Where-Object { $_.TypeName.Name -eq 'CmdletBinding' }).Count -gt 0 -or
                @($parameters | ForEach-Object { $_.Attributes } | Where-Object { $_.TypeName.Name -eq 'Parameter' }).Count -gt 0)
            $names = @($f.Parameters)
            $aliases = @($parameters | ForEach-Object { $_.Attributes } | Where-Object { $_.TypeName.Name -eq 'Alias' } | ForEach-Object { $_.PositionalArguments.Value })
            if ($advanced) { $names += @($common.Name); $aliases += @($common.Aliases) }
            $project[$f.Name] = [pscustomobject]@{ Names = $names; Accepted = $names + $aliases }
        }
        # A command that comes with Windows PowerShell 5.1: a cmdlet, function or alias of its default
        # session (Microsoft.PowerShell.* and functions such as Clear-Host and mkdir), or of a module in
        # $PSHOME. Any other command an example calls must be a function of the project's scripts, so a
        # renamed function leaves no example calling its old name.
        $default = [System.Management.Automation.Runspaces.InitialSessionState]::CreateDefault().Commands
        $defaultFunctions = @($default | Where-Object { $_ -is [System.Management.Automation.Runspaces.SessionStateFunctionEntry] } | ForEach-Object Name)
        $defaultAliases = @{}
        foreach ($e in $default | Where-Object { $_ -is [System.Management.Automation.Runspaces.SessionStateAliasEntry] }) { $defaultAliases[$e.Name] = $e.Definition }
        function Test-InBox($Info) {
            if ($Info.Module) { return $Info.Module.ModuleBase.StartsWith($PSHOME, [StringComparison]::OrdinalIgnoreCase) }
            if ($Info.PSSnapIn) { return $Info.PSSnapIn.Name -like 'Microsoft.PowerShell.*' }
            $Info.CommandType -eq 'Function' -and $defaultFunctions -contains $Info.Name
        }
        $inBox = @{}
        function Get-InBoxCommand([string]$Name) {
            if (-not $inBox.ContainsKey($Name)) {
                $target = if ($defaultAliases.ContainsKey($Name)) { $defaultAliases[$Name] } else { $Name }
                $inBox[$Name] = $null
                foreach ($info in @(Get-Command -Name $target -All -ErrorAction SilentlyContinue)) {
                    if ($info -is [System.Management.Automation.AliasInfo]) { if ($info.Module -and (Test-InBox $info)) { $info = $info.ResolvedCommand } else { continue } }
                    if ($info -and $info.CommandType -in 'Cmdlet', 'Function' -and (Test-InBox $info)) { $inBox[$Name] = $info; break }
                }
            }
            $inBox[$Name]
        }
        $bad = foreach ($f in $Functions | Where-Object Help) {
            foreach ($example in $f.Help.Examples) {
                $errors = $null
                $ast = [System.Management.Automation.Language.Parser]::ParseInput($example, [ref]$null, [ref]$errors)
                foreach ($call in @($ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.CommandAst] }, $true) | Where-Object { $_.GetCommandName() })) {
                    $name = $call.GetCommandName()
                    if ($project.ContainsKey($name)) { $names = $project[$name].Names; $accepted = $project[$name].Accepted }
                    elseif ($null -ne (Get-InBoxCommand $name)) { $info = Get-InBoxCommand $name; $names = @($info.Parameters.Keys); $accepted = $names + @($info.Parameters.Values | ForEach-Object { $_.Aliases }) }
                    else { "$($f.Name): calls $name, which is not a function of the project's scripts or a command that comes with Windows PowerShell"; continue }
                    # Stricter than PowerShell, which takes a short form such as -Win: a novice copies the
                    # example, and the usage line shows whole names.
                    foreach ($p in @($call.CommandElements | Where-Object { $_ -is [System.Management.Automation.Language.CommandParameterAst] })) {
                        if ($accepted -contains $p.ParameterName) { continue }
                        $long = @($names | Where-Object { $_ -like "$($p.ParameterName)*" })
                        if ($long) { "$($f.Name): -$($p.ParameterName) is short for -$($long -join ' or -') of $name; an example writes each parameter's whole name" }
                        else { "$($f.Name): $name has no parameter named -$($p.ParameterName)" }
                    }
                }
                $calls = @($ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.CommandAst] -and $byName.ContainsKey([string]$n.GetCommandName()) }, $true))
                if ($errors.Count -gt 0 -or -not ($calls | Where-Object { $_.GetCommandName() -eq $f.Name })) { "$($f.Name): does not parse or does not call it"; continue }
                foreach ($call in $calls) {
                    $els = @($call.CommandElements)
                    for ($i = 1; $i -lt $els.Count; $i++) {
                        $el = $els[$i]
                        # 'Send-Click 200, 300' passes one array, not two values; after a parameter name a list is meant.
                        $named = $els[$i - 1] -is [System.Management.Automation.Language.CommandParameterAst]
                        if ($el -is [System.Management.Automation.Language.ArrayLiteralAst] -and -not $named) { "$($f.Name): commas in $($call.Extent.Text)" }
                    }
                }
            }
        }
        $bad | Should -BeNullOrEmpty
    }
    It 'says what a function gives back when it returns a value' {
        $bad = foreach ($f in $Functions | Where-Object Help) {
            # A return with a value, outside any script block the function passes on (those return from the block).
            # It cannot see a value given back without return: a bare expression or a command whose output
            # is not caught, on the last line or anywhere else. A rule that guessed which of those give
            # something back would be wrong too often, so such a function needs its .OUTPUTS by hand.
            $returns = @($f.Ast.Body.FindAll({ param($n) $n -is [System.Management.Automation.Language.ReturnStatementAst] -and $n.Pipeline }, $false))
            if ($returns.Count -gt 0 -and $f.Help.Outputs.Count -eq 0) { $f.Name }
        }
        $bad | Should -BeNullOrEmpty
    }
    It 'keeps the first sentence of each synopsis short enough for a row' {
        $bad = foreach ($f in $Functions | Where-Object Help) {
            $first = ($f.Help.Synopsis.Trim() -split '(?<=\.)\s')[0]
            if ($first.Length -gt 90) { "$($f.Name) ($($first.Length))" }
        }
        $bad | Should -BeNullOrEmpty
    }
}
