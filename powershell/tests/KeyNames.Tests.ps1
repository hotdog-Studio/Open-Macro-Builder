# Every key name a command sends exists. A typo in a key name only fails when the key is pressed
# ("Unknown key name"), so this reads every Send-Chord, Send-Key and Send-Ahk call under
# powershell\commands and puts each literal argument through the library's own conversion, which
# checks every name and sends nothing. An argument held in a variable cannot be checked here; those
# calls are counted and listed in $Dynamic, so a new one is noticed.
BeforeAll {
    $ps = Split-Path $PSScriptRoot -Parent
    foreach ($f in 'Input', 'AhkSyntax') { . "$ps\lib\$f.ps1" }
    # file (relative to powershell\commands) -> how many calls send a key held in a variable
    $Dynamic = @{ 'custom\automation.ps1' = 1 }

    $Calls = foreach ($file in Get-ChildItem "$ps\commands" -Recurse -Filter *.ps1) {
        $ast = [System.Management.Automation.Language.Parser]::ParseFile($file.FullName, [ref]$null, [ref]$null)
        $commands = $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.CommandAst] -and $n.GetCommandName() -in 'Send-Chord', 'Send-Key', 'Send-Ahk' }, $true)
        foreach ($c in $commands) {
            # The first argument that is not a parameter name: positional, or the value after -Chord, -Name or -Keys.
            $arg = @($c.CommandElements | Select-Object -Skip 1 | Where-Object { $_ -isnot [System.Management.Automation.Language.CommandParameterAst] })[0]
            [pscustomobject]@{
                File    = $file.FullName.Substring("$ps\commands\".Length)
                Line    = $c.Extent.StartLineNumber
                Command = $c.GetCommandName()
                Value   = if ($arg -is [System.Management.Automation.Language.StringConstantExpressionAst]) { $arg.Value } else { $null }
                Text    = $c.Extent.Text
            }
        }
    }
}
Describe 'Key names in powershell\commands' {
    It 'finds the key sends of the commands' {
        @($Calls | Where-Object { $null -ne $_.Value }).Count | Should -BeGreaterThan 50
    }
    It 'resolves every literal key name' {
        $bad = foreach ($call in $Calls | Where-Object { $null -ne $_.Value }) {
            try {
                if ($call.Command -eq 'Send-Ahk') { [void](ConvertFrom-AhkSend $call.Value) }
                else { [void](ConvertTo-KeyEvent $call.Value) }
            } catch { "$($call.File):$($call.Line) $($call.Text): $($_.Exception.Message)" }
        }
        $bad | Should -BeNullOrEmpty
    }
    It 'skips only the sends of a key held in a variable that are counted' {
        $found = @{}
        foreach ($call in $Calls | Where-Object { $null -eq $_.Value }) { $found[$call.File] = 1 + [int]$found[$call.File] }
        ($found.Keys | Sort-Object | ForEach-Object { "$_=$($found[$_])" }) -join ', ' |
            Should -Be (($Dynamic.Keys | Sort-Object | ForEach-Object { "$_=$($Dynamic[$_])" }) -join ', ')
    }
}
