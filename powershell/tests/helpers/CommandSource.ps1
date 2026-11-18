# Reads command functions from the source text of a command file pair (ahk\commands\X.ahk and
# powershell\commands\X.ps1) and turns a key chord into the taps it presses, so the two languages
# can be compared without sending anything. Needs lib\Input.ps1 and lib\AhkSyntax.ps1.

# AHK functions of a file: name -> @{ Params = 'Macro'; Body = @(statement lines) }.
# A function starts at column 0 with Name(params), its body ends at the next line that starts with
# '}' (the layout of every file in ahk\commands). Blank lines and ; comments are left out of Body.
function Get-AhkFunctionSource {
    param([Parameter(Mandatory)][string]$Path)
    $lines = @(Get-Content -LiteralPath $Path)
    $result = [ordered]@{}
    for ($i = 0; $i -lt $lines.Count; $i++) {
        if ($lines[$i] -notmatch '^(\w+)\(([^)]*)\)\s*\{?\s*$') { continue }
        $name = $Matches[1]; $params = $Matches[2].Trim()
        $body = [System.Collections.Generic.List[string]]::new()
        for ($j = $i + 1; $j -lt $lines.Count -and $lines[$j] -notmatch '^\}'; $j++) {
            $text = Remove-AhkComment $lines[$j]
            if ($text -eq '' -or $text -eq '{') { continue }
            $body.Add($text)
        }
        $result[$name] = [pscustomobject]@{ Params = $params; Body = $body.ToArray() }
        $i = $j
    }
    $result
}

# One line of AHK code without its ; comment. As in AutoHotkey, a ; that starts the line or follows
# a space or tab starts a comment, even inside quotes (a string writes such a ; as `;).
function Remove-AhkComment {
    param([string]$Line)
    for ($k = 0; $k -lt $Line.Length; $k++) {
        if ($Line[$k] -eq ';' -and ($k -eq 0 -or [char]::IsWhiteSpace($Line[$k - 1]))) { return $Line.Substring(0, $k).Trim() }
    }
    $Line.Trim()
}

# The text of an AHK string literal ("..." or '...'), with its backtick escapes undone; $null when
# $Literal is not exactly one string literal.
function ConvertFrom-AhkStringLiteral {
    param([string]$Literal)
    if ($Literal.Length -lt 2) { return $null }
    $quote = $Literal[0]
    if (($quote -ne '"' -and $quote -ne "'") -or $Literal[-1] -ne $quote) { return $null }
    $sb = [System.Text.StringBuilder]::new()
    for ($k = 1; $k -lt $Literal.Length - 1; $k++) {
        $c = $Literal[$k]
        if ($c -eq $quote) { return $null }   # the literal ends early: more than one literal
        if ($c -eq '`' -and $k + 1 -lt $Literal.Length - 1) {
            $k++
            switch -CaseSensitive ([string]$Literal[$k]) {
                'n' { [void]$sb.Append("`n") }
                't' { [void]$sb.Append("`t") }
                'r' { [void]$sb.Append("`r") }
                default { [void]$sb.Append($Literal[$k]) }
            }
            continue
        }
        [void]$sb.Append($c)
    }
    $sb.ToString()
}

# The guard of an AHK function whose whole body is 'if Name(Macro)' followed by one statement, or by
# statements in braces, such as 'if EnsureActiveOrOpenChrome(Macro)' then a Send: Guard is the name
# and Body the guarded statements. Without such a guard, Guard is '' and Body the whole body.
function Split-AhkGuard {
    param($Function)
    $body = @($Function.Body)
    $none = [pscustomobject]@{ Guard = ''; Body = $body }
    if ($body.Count -lt 2 -or $body[0] -notmatch '^if\s*\(?\s*(\w+)\(Macro\)\s*\)?\s*(\{?)$') { return $none }
    $name = $Matches[1]
    # Get-AhkFunctionSource leaves out a line that is only '{', so a block shows as its closing '}'.
    if ($Matches[2] -eq '' -and $body.Count -eq 2) { return [pscustomobject]@{ Guard = $name; Body = @($body[1]) } }
    if ($body.Count -lt 3 -or $body[-1] -ne '}') { return $none }
    [pscustomobject]@{ Guard = $name; Body = @($body[1..($body.Count - 2)]) }
}

# The guard's name of an AHK function (Split-AhkGuard), or '' when its body has no such guard.
function Get-AhkGuard {
    param($Function)
    (Split-AhkGuard $Function).Guard
}

# The keys of an AHK function whose whole body is Send("...") calls with a string literal, one per
# statement and nothing else (no wait between them), perhaps under a guard (Split-AhkGuard): the
# Send texts in order, or $null.
function Get-AhkSends {
    param($Function)
    $body = @((Split-AhkGuard $Function).Body)
    if ($body.Count -eq 0) { return $null }
    $sends = [System.Collections.Generic.List[string]]::new()
    foreach ($statement in $body) {
        if ($statement -notmatch '^Send\((.*)\)$') { return $null }
        $text = ConvertFrom-AhkStringLiteral $Matches[1].Trim()
        if ($null -eq $text) { return $null }
        $sends.Add($text)
    }
    , $sends.ToArray()
}

# The one command of a list of statements: a CommandAst when the list is exactly one pipeline of one
# command; else $null.
function Get-PsSingleCommand {
    param($Statements)
    $statements = @($Statements)
    if ($statements.Count -ne 1 -or $statements[0] -isnot [System.Management.Automation.Language.PipelineAst] -or $statements[0].PipelineElements.Count -ne 1) { return $null }
    $cmd = $statements[0].PipelineElements[0]
    if ($cmd -isnot [System.Management.Automation.Language.CommandAst]) { return $null }
    $cmd
}

# PowerShell functions of a file: name -> @{ Params = 'Macro'; Chord = chords or $null; Guard }. Chord
# is set when the whole body (after param) is Send-Chord or Send-Key calls with literal arguments and
# nothing else (no wait between them), one per statement, in order; or those sends alone inside
# 'if (Name $Macro) { ... }' with no else, and Guard is then Name, otherwise ''.
function Get-PsFunctionSource {
    param([Parameter(Mandatory)][string]$Path)
    $ast = [System.Management.Automation.Language.Parser]::ParseFile($Path, [ref]$null, [ref]$null)
    $result = [ordered]@{}
    foreach ($fn in $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] }, $false)) {
        $params = ''
        if ($fn.Body.ParamBlock) { $params = (@($fn.Body.ParamBlock.Parameters | ForEach-Object { $_.Name.VariablePath.UserPath })) -join ', ' }
        $chord = $null; $guard = ''
        $statements = @($fn.Body.EndBlock.Statements)
        if ($statements.Count -eq 1 -and $statements[0] -is [System.Management.Automation.Language.IfStatementAst] -and
            $statements[0].Clauses.Count -eq 1 -and $null -eq $statements[0].ElseClause) {
            $test = Get-PsSingleCommand @($statements[0].Clauses[0].Item1)
            if ($null -ne $test -and $test.CommandElements.Count -eq 2 -and $test.CommandElements[1].Extent.Text -eq '$Macro') {
                $guard = $test.GetCommandName()
                $statements = @($statements[0].Clauses[0].Item2.Statements)
            }
        }
        $sends = [System.Collections.Generic.List[string]]::new()
        foreach ($statement in $statements) {
            $cmd = Get-PsSingleCommand @($statement)
            if ($null -eq $cmd -or $cmd.GetCommandName() -notin 'Send-Chord', 'Send-Key' -or $cmd.CommandElements.Count -ne 2 -or
                $cmd.CommandElements[1] -isnot [System.Management.Automation.Language.StringConstantExpressionAst]) { $sends = $null; break }
            $sends.Add($cmd.CommandElements[1].Value)
        }
        if ($null -ne $sends -and $sends.Count -gt 0) { $chord = $sends.ToArray() } else { $guard = '' }
        $result[$fn.Name] = [pscustomobject]@{ Params = $params; Chord = $chord; Guard = $guard }
    }
    $result
}

# The left modifier keys count as the plain ones (LAlt is Alt): Windows reads both the same way for
# a shortcut. The right ones and the Windows keys stay as they are.
function Get-ComparableVk {
    param([int]$Vk)
    switch ($Vk) { 0xA0 { 0x10 } 0xA2 { 0x11 } 0xA4 { 0x12 } default { $Vk } }
}

function Get-KeyDisplayName {
    param([int]$Vk)
    $names = @{ 0x10 = 'Shift'; 0x11 = 'Ctrl'; 0x12 = 'Alt'; 0x5B = 'LWin'; 0x5C = 'RWin' }
    if ($names.ContainsKey($Vk)) { return $names[$Vk] }
    $name = $script:VirtualKeys.Keys | Where-Object { $script:VirtualKeys[$_] -eq $Vk } | Sort-Object Length, { $_ } | Select-Object -First 1
    if ($name) { return $name }
    'vk{0:X2}' -f $Vk
}

# Key events (Vk, Up, and for AHK Char) -> the taps they make, such as 'Alt+Shift+Tab': each key
# that goes down and straight up again, with the keys held around it. Throws on events that are not
# a series of chords (a key released that was not held, or a key still held at the end).
function ConvertTo-ChordTap {
    param([object[]]$Events)
    $flat = [System.Collections.Generic.List[object]]::new()
    foreach ($e in $Events) {
        $char = 0
        if ($e.PSObject.Properties['Char']) { $char = [int]$e.Char }
        if ($char -eq 0) { $flat.Add([pscustomobject]@{ Vk = (Get-ComparableVk $e.Vk); Up = [bool]$e.Up }); continue }
        # A typed character: the key that types it on a US layout, with Shift for a capital letter.
        $text = [string][char]$char
        $shift = $text -cmatch '^[A-Z]$'
        $vk = Get-AhkVirtualKey $text.ToLowerInvariant()
        if ($shift -and -not $e.Up) { $flat.Add([pscustomobject]@{ Vk = 0x10; Up = $false }) }
        $flat.Add([pscustomobject]@{ Vk = $vk; Up = [bool]$e.Up })
        if ($shift -and $e.Up) { $flat.Add([pscustomobject]@{ Vk = 0x10; Up = $true }) }
    }
    $held = [System.Collections.Generic.List[int]]::new()
    $taps = [System.Collections.Generic.List[string]]::new()
    for ($i = 0; $i -lt $flat.Count; $i++) {
        $e = $flat[$i]
        if (-not $e.Up) {
            if ($i + 1 -lt $flat.Count -and $flat[$i + 1].Up -and $flat[$i + 1].Vk -eq $e.Vk) {
                $mods = @($held | ForEach-Object { Get-KeyDisplayName $_ } | Sort-Object)
                $taps.Add((@($mods) + (Get-KeyDisplayName $e.Vk)) -join '+')
                $i++
            } else { $held.Add($e.Vk) }
        } elseif (-not $held.Remove($e.Vk)) {
            throw "$(Get-KeyDisplayName $e.Vk) is let go without being held"
        }
    }
    if ($held.Count -gt 0) { throw "$((@($held | ForEach-Object { Get-KeyDisplayName $_ })) -join ', ') still held at the end" }
    , $taps.ToArray()
}
