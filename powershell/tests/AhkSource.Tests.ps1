# What the AutoHotkey version calls, read from its source text and run never. AutoHotkey gets no unit
# test (nothing here starts it, sends a key or shows a window), but six of its commands can run in no
# test at all, for they restart, shut down, lock, sleep, hibernate or blank the monitors of the PC.
# The PowerShell versions of those are tested with the system calls replaced (Power.Tests.ps1); this
# file holds the AutoHotkey ones to the same calls, with the same numbers: shutdown /r /t 1 and
# shutdown /s /t 1, SetSuspendState with Hibernate 0 for sleep and 1 for hibernate, a wait of 1000
# milliseconds and then WM_SYSCOMMAND (0x112) SC_MONITORPOWER (0xF170) with 2 (off) for the monitors.
# It also holds OpenPowershell and OpenCommandPrompt to the same window titles in both versions.
#
# How a call is compared: the function's body (comments and blank lines are already left out by
# Get-AhkFunctionSource) loses its spaces and tabs outside quotes, as does the expected call, and
# must contain the call exactly once. Spaces inside a string stay, so "shutdown /r /t 1" and
# "shutdown /r/t 1" are two calls. Case and the kind of quote are not normalised: a changed spelling
# fails and is read by a person, where a changed number or program would never be told from a changed
# spelling. What AutoHotkey reads without regard to case is matched the same way here: the names of
# functions, of the system calls counted below, of Sleep, SendMessage, GroupAdd and ActivateOrOpen, and
# the name of a window group. Window titles are compared exactly. The body must also make no other system call (a second Run, DllCall, SendMessage ...),
# whatever it is called with.
BeforeAll {
    $root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
    . "$PSScriptRoot\helpers\CommandSource.ps1"
    $script:powerAhk = Join-Path $root 'ahk\commands\power.ahk'
    $script:windowsAhk = Join-Path $root 'ahk\commands\windows.ahk'
    $script:windowsPs = Join-Path $root 'powershell\commands\windows.ps1'
    $script:ahkDir = Join-Path $root 'ahk'

    # AHK code without the spaces and tabs outside quotes (-DropSpace), and/or with the text of its
    # strings emptied (-DropStrings). A backtick in a string escapes the next character.
    function Format-AhkCode {
        param([string]$Text, [switch]$DropSpace, [switch]$DropStrings)
        $out = [System.Text.StringBuilder]::new()
        $quote = [char]0
        for ($k = 0; $k -lt $Text.Length; $k++) {
            $c = $Text[$k]
            if ($quote -ne [char]0) {
                if ($c -eq '`' -and $k + 1 -lt $Text.Length) { if (-not $DropStrings) { [void]$out.Append($c).Append($Text[$k + 1]) }; $k++; continue }
                if ($c -eq $quote) { $quote = [char]0; [void]$out.Append($c); continue }
                if (-not $DropStrings) { [void]$out.Append($c) }
                continue
            }
            if ($c -eq '"' -or $c -eq "'") { $quote = $c; [void]$out.Append($c); continue }
            if ($DropSpace -and ($c -eq ' ' -or $c -eq "`t")) { continue }
            [void]$out.Append($c)
        }
        $out.ToString()
    }

    # Calls that start a program, send to a window or key, or ask Windows to do something. AutoHotkey
    # reads function names without regard to case, so run("calc") counts as Run.
    $script:systemCall = '(?i)(?<![\w.])(?:Run|RunWait|RunAs|DllCall|ComCall|ComObject|SendMessage|PostMessage|Send|SendInput|SendText|SendEvent|SendPlay|ControlSend|Shutdown|ProcessClose|WinClose|WinKill|Click|MouseMove|SoundPlay)(?!\w)(?!\s*(?::=|=|\.))'

    # What is wrong with a function body for the call it should make: nothing (no output), or one line each.
    function Get-AhkCallProblem {
        param([string[]]$Body, [string]$Expected)
        $want = Format-AhkCode $Expected -DropSpace
        $text = (@($Body | ForEach-Object { Format-AhkCode $_ -DropSpace })) -join "`n"
        $found = [regex]::Matches($text, [regex]::Escape($want)).Count
        if ($found -ne 1) { "contains $want $found times, not once" }
        $code = (@($Body | ForEach-Object { Format-AhkCode $_ -DropStrings })) -join "`n"
        $names = @([regex]::Matches($code, $script:systemCall) | ForEach-Object { $_.Value })
        if ($names.Count -ne 1) { "makes $($names.Count) system calls ($($names -join ', ')), not one" }
    }

    # The body lines of one function of an AHK file, as the helper reads them (the lookup is case-
    # insensitive, as AutoHotkey's). The lines come out one by one, so a caller that indexes or counts
    # them wraps the call in @(...). A function without a statement stops the test with a message.
    function Get-AhkBody {
        param([string]$Path, [string]$Name)
        $functions = Get-AhkFunctionSource $Path
        if (-not $functions.Contains($Name)) { throw "$Name is not a function of $Path" }
        $lines = @($functions[$Name].Body)
        if ($lines.Count -eq 0) { throw "$Name has no statements in $Path" }
        $lines
    }

    # What is wrong with the wait of a function body that turns the monitors off: one 'Sleep 1000' line,
    # one SendMessage line, the wait first.
    function Get-AhkWaitProblem {
        param([string[]]$Body)
        $lines = @($Body)
        $wait = @(for ($k = 0; $k -lt $lines.Count; $k++) { if ($lines[$k] -match '^Sleep\s*\(?\s*1000\s*\)?$') { $k } })
        $send = @(for ($k = 0; $k -lt $lines.Count; $k++) { if ((Format-AhkCode $lines[$k] -DropSpace) -match 'SendMessage\(') { $k } })
        if ($wait.Count -ne 1) { "has $($wait.Count) lines that wait 1000 milliseconds, not one" }
        if ($send.Count -ne 1) { "has $($send.Count) SendMessage lines, not one" }
        if ($wait.Count -eq 1 -and $send.Count -eq 1 -and $wait[0] -gt $send[0]) { 'sends the message before it waits' }
    }

    # The titles an AHK function adds to its window group with GroupAdd("Group", "Title"): objects with
    # Group and Title. A GroupAdd line of another shape, such as the command style GroupAdd "Group",
    # "Title" that AutoHotkey also reads, stops the test, so it cannot be skipped.
    function Get-AhkGroupTitle {
        param([string]$Path, [string]$Name)
        foreach ($line in (Get-AhkBody $Path $Name)) {
            if ($line -notmatch '^GroupAdd\b') { continue }
            if ($line -notmatch '^GroupAdd\(\s*("[^"]*")\s*,\s*("[^"]*")\s*\)$') { throw "$Name has a GroupAdd line that is not two string literals: $line" }
            [pscustomobject]@{ Group = ConvertFrom-AhkStringLiteral $Matches[1]; Title = ConvertFrom-AhkStringLiteral $Matches[2] }
        }
    }

    # Every code line under a folder's .ahk files that names GroupAdd, as 'file: line' (comment and doc-
    # comment lines left out). A title added to a window group anywhere else, such as from a helper
    # function, would not be seen by Get-AhkGroupTitle; counting these lines finds it.
    function Get-AhkGroupAddLine {
        param([string]$Directory)
        foreach ($file in (Get-ChildItem -LiteralPath $Directory -Filter '*.ahk' -Recurse -File)) {
            foreach ($line in (Get-Content -LiteralPath $file.FullName)) {
                $code = Remove-AhkComment $line
                if ($code -match '^(\*|/\*)') { continue }
                if ($code -match '\bGroupAdd\b') { "$($file.Name): $code" }
            }
        }
    }

    # What is wrong with the window group a function activates: it adds its titles to one group, and
    # activates that one with ActivateOrOpen("ahk_group Name", ...). Group names are read without
    # regard to case, as AutoHotkey reads them.
    function Get-AhkGroupProblem {
        param([string]$Path, [string]$Name)
        $groups = @(Get-AhkGroupTitle $Path $Name | ForEach-Object { $_.Group } | Sort-Object -Unique)
        if ($groups.Count -ne 1) { "adds titles to $($groups.Count) groups, not one"; return }
        $activated = @(foreach ($line in (Get-AhkBody $Path $Name)) {
                if ($line -match '^ActivateOrOpen\(\s*"ahk_group (\w+)"') { $Matches[1] }
            })
        if ($activated.Count -ne 1) { "activates $($activated.Count) groups, not one"; return }
        if ($activated[0] -ne $groups[0]) { "adds its titles to $($groups[0]) and activates $($activated[0])" }
    }

    # The titles a PowerShell function passes as -WinTitle to ActivateOrOpenWindow, read from the syntax
    # tree: only string constants count, anything else stops the test.
    function Get-PsWinTitle {
        param([string]$Path, [string]$Name)
        $ast = [System.Management.Automation.Language.Parser]::ParseFile($Path, [ref]$null, [ref]$null)
        $fn = $ast.Find({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $Name }, $false)
        if (-not $fn) { throw "$Name is not a function of $Path" }
        $calls = $fn.FindAll({ param($n) $n -is [System.Management.Automation.Language.CommandAst] -and $n.GetCommandName() -eq 'ActivateOrOpenWindow' }, $true)
        if (@($calls).Count -ne 1) { throw "$Name should call ActivateOrOpenWindow once, and calls it $(@($calls).Count) times" }
        $elements = @($calls[0].CommandElements)
        for ($k = 0; $k -lt $elements.Count; $k++) {
            $element = $elements[$k]
            if ($element -isnot [System.Management.Automation.Language.CommandParameterAst] -or $element.ParameterName -ne 'WinTitle') { continue }
            $value = $element.Argument
            if ($null -eq $value) { $value = $elements[$k + 1] }
            $items = if ($value -is [System.Management.Automation.Language.ArrayLiteralAst]) { $value.Elements } else { @($value) }
            foreach ($item in $items) {
                if ($item -isnot [System.Management.Automation.Language.StringConstantExpressionAst]) { throw "$Name gives -WinTitle something that is not a string constant: $($item.Extent.Text)" }
                $item.Value
            }
        }
    }

    function Join-Sorted { param([string[]]$Text) (@($Text | Sort-Object -CaseSensitive) | ForEach-Object { "'$_'" }) -join ', ' }
}

Describe 'The AutoHotkey power commands make the calls the PowerShell ones are tested for' {
    It '<Command> calls <Call>' -ForEach @(
        @{ Command = 'Restart'; Call = 'Run("shutdown /r /t 1")' }
        @{ Command = 'Shutdown'; Call = 'Run("shutdown /s /t 1")' }
        @{ Command = 'Lock'; Call = 'DllCall("LockWorkStation")' }
        @{ Command = 'WinSleep'; Call = 'DllCall("PowrProf\SetSuspendState", "Int", 0, "Int", 0, "Int", 0, "UChar")' }
        @{ Command = 'Hibernate'; Call = 'DllCall("PowrProf\SetSuspendState", "Int", 1, "Int", 0, "Int", 0, "UChar")' }
        @{ Command = 'TurnMonitorsOff'; Call = 'SendMessage(0x112,0xF170,2,,"Program Manager")' }
    ) {
        $body = @(Get-AhkBody $script:powerAhk $Command)
        @(Get-AhkCallProblem -Body $body -Expected $Call) | Should -BeNullOrEmpty
    }
    It 'waits a second before it turns the monitors off, as the PowerShell version does' {
        @(Get-AhkWaitProblem (Get-AhkBody $script:powerAhk 'TurnMonitorsOff')) | Should -BeNullOrEmpty
    }
}

Describe 'The check of a call notices what a changed copy of power.ahk does' {
    BeforeAll {
        # Copies of the source text in a string, written to the test drive and read from there: the real
        # file is never edited.
        $script:powerText = Get-Content -LiteralPath $script:powerAhk -Raw
        function Get-CopyBody {
            param([string]$Text, [string]$Name)
            $copy = Join-Path $TestDrive 'power-copy.ahk'
            Set-Content -LiteralPath $copy -Value $Text
            Get-AhkBody $copy $Name
        }
    }
    It 'accepts the real source and a copy that differs only in spaces outside the quotes' {
        $spaced = $script:powerText.Replace('Run("shutdown /r /t 1")', 'Run( "shutdown /r /t 1" )')
        ($spaced -ceq $script:powerText) | Should -BeFalse
        @(Get-AhkCallProblem -Body (Get-CopyBody $spaced 'Restart') -Expected 'Run("shutdown /r /t 1")') | Should -BeNullOrEmpty
    }
    It 'fails when the call is missing' {
        $missing = $script:powerText.Replace('Run("shutdown /r /t 1")', 'Sleep 1')
        @(Get-AhkCallProblem -Body (Get-CopyBody $missing 'Restart') -Expected 'Run("shutdown /r /t 1")') | Should -Not -BeNullOrEmpty
    }
    It 'fails when the call appears twice' {
        $twice = $script:powerText.Replace('Run("shutdown /r /t 1")', "Run(`"shutdown /r /t 1`")`n   Run(`"shutdown /r /t 1`")")
        $problem = @(Get-AhkCallProblem -Body (Get-CopyBody $twice 'Restart') -Expected 'Run("shutdown /r /t 1")')
        $problem | Should -Not -BeNullOrEmpty
        $problem -join '; ' | Should -BeLike '*2 times*'
    }
    It 'fails when a second system call is added beside it: <Added>' -ForEach @(
        @{ Added = 'Run("calc")' }
        @{ Added = 'DllCall("LockWorkStation")' }
        @{ Added = 'SendMessage(0x112,0xF170,2,,"Program Manager")' }
        @{ Added = 'Run "calc"' }
        @{ Added = 'run("calc")' }
        @{ Added = 'DLLCALL("LockWorkStation")' }
        @{ Added = 'sendmessage(0x112,0xF170,2,,"Program Manager")' }
    ) {
        $copyText = $script:powerText.Replace('Run("shutdown /r /t 1")', "Run(`"shutdown /r /t 1`")`n   $Added")
        $problem = @(Get-AhkCallProblem -Body (Get-CopyBody $copyText 'Restart') -Expected 'Run("shutdown /r /t 1")')
        $problem -join '; ' | Should -BeLike '*2 system calls*'
    }
    It 'fails when <Was> becomes <Is>' -ForEach @(
        @{ Was = 'Run("shutdown /s /t 1")'; Is = 'Run("shutdown /s /t 5")' }
        @{ Was = 'Run("shutdown /s /t 1")'; Is = 'Run("shutdown /h /t 1")' }
        @{ Was = 'Run("shutdown /s /t 1")'; Is = 'Run("shutdown /s/t 1")' }
        @{ Was = 'DllCall("PowrProf\SetSuspendState", "Int", 1,'; Is = 'DllCall("PowrProf\SetSuspendState", "Int", 0,' }
    ) {
        $copyText = $script:powerText.Replace($Was, $Is)
        ($copyText -ceq $script:powerText) | Should -BeFalse
        $name = if ($Was -like 'Run*') { 'Shutdown' } else { 'Hibernate' }
        $expected = if ($Was -like 'Run*') { $Was } else { 'DllCall("PowrProf\SetSuspendState", "Int", 1, "Int", 0, "Int", 0, "UChar")' }
        @(Get-AhkCallProblem -Body (Get-CopyBody $copyText $name) -Expected $expected) | Should -Not -BeNullOrEmpty
    }
    It 'finds a function whose name is written in another case, as AutoHotkey does' {
        $copyText = $script:powerText.Replace('Restart(Macro)', 'restart(Macro)')
        ($copyText -ceq $script:powerText) | Should -BeFalse
        @(Get-AhkCallProblem -Body (Get-CopyBody $copyText 'Restart') -Expected 'Run("shutdown /r /t 1")') | Should -BeNullOrEmpty
    }
    It 'stops with a message at a function that has no statement' {
        $copyText = $script:powerText.Replace('   DllCall("LockWorkStation")', '   ; nothing')
        ($copyText -ceq $script:powerText) | Should -BeFalse
        { Get-CopyBody $copyText 'Lock' } | Should -Throw 'Lock has no statements*'
    }
    It 'reads the body of one line, as Shutdown has, as one line' {
        $body = @(Get-CopyBody $script:powerText 'Shutdown')
        $body.Count | Should -Be 1
        @(Get-AhkCallProblem -Body $body -Expected 'Run("shutdown /s /t 1")') | Should -BeNullOrEmpty
    }
}

Describe 'The check of the wait notices what a changed copy of power.ahk does' {
    BeforeAll {
        $script:powerText = Get-Content -LiteralPath $script:powerAhk -Raw
        $script:sendLine = 'SendMessage(0x112,0xF170,2,,"Program Manager")'
        function Get-CopyBody {
            param([string]$Text, [string]$Name)
            $copy = Join-Path $TestDrive 'power-copy.ahk'
            Set-Content -LiteralPath $copy -Value $Text
            Get-AhkBody $copy $Name
        }
    }
    It 'accepts the wait written in another case or as a call' {
        $copyText = $script:powerText.Replace('Sleep 1000', 'sleep(1000)').Replace($script:sendLine, $script:sendLine.ToUpperInvariant())
        ($copyText -ceq $script:powerText) | Should -BeFalse
        @(Get-AhkWaitProblem (Get-CopyBody $copyText 'TurnMonitorsOff')) | Should -BeNullOrEmpty
    }
    It 'fails when the message is sent before the wait' {
        $copyText = $script:powerText.Replace('Sleep 1000', '@@WAIT@@').Replace($script:sendLine, 'Sleep 1000').Replace('@@WAIT@@', $script:sendLine)
        ($copyText -ceq $script:powerText) | Should -BeFalse
        (@(Get-AhkWaitProblem (Get-CopyBody $copyText 'TurnMonitorsOff')) -join '; ') | Should -BeLike '*before it waits*'
    }
    It 'fails when the wait is another length or missing: <Is>' -ForEach @(
        @{ Is = 'Sleep 100' }
        @{ Is = 'Sleep 10000' }
        @{ Is = '; no wait' }
    ) {
        $copyText = $script:powerText.Replace('Sleep 1000', $Is)
        ($copyText -ceq $script:powerText) | Should -BeFalse
        @(Get-AhkWaitProblem (Get-CopyBody $copyText 'TurnMonitorsOff')) | Should -Not -BeNullOrEmpty
    }
    It 'fails, without an error of its own, for a body of one line' {
        $problem = @(Get-AhkWaitProblem $script:sendLine)
        $problem.Count | Should -Be 1
        $problem[0] | Should -BeLike '*0 lines that wait*'
    }
}

Describe 'The two versions look for the same shell windows' {
    It 'sees a title that one version adds or changes' -ForEach @(
        @{ Was = "'Command Prompt ahk_exe WindowsTerminal.exe'"; Is = "'Eingabeaufforderung ahk_exe WindowsTerminal.exe'" }
        @{ Was = ", 'cmd.exe ahk_exe WindowsTerminal.exe'"; Is = '' }
    ) {
        # A copy of windows.ps1 in a string, read from the test drive: the real file is never edited.
        $text = (Get-Content -LiteralPath $script:windowsPs -Raw).Replace($Was, $Is)
        ($text -ceq (Get-Content -LiteralPath $script:windowsPs -Raw)) | Should -BeFalse
        $copy = Join-Path $TestDrive 'windows-copy.ps1'
        Set-Content -LiteralPath $copy -Value $text
        $ahkTitles = @(Get-AhkGroupTitle $script:windowsAhk 'OpenCommandPrompt' | ForEach-Object { $_.Title })
        Join-Sorted $ahkTitles | Should -Not -BeExactly (Join-Sorted @(Get-PsWinTitle $copy 'OpenCommandPrompt'))
    }
    It 'gives <Command> the same shell windows in both versions' -ForEach @(@{ Command = 'OpenPowershell' }, @{ Command = 'OpenCommandPrompt' }) {
        $ahkTitles = @(Get-AhkGroupTitle $script:windowsAhk $Command | ForEach-Object { $_.Title })
        $psTitles = @(Get-PsWinTitle $script:windowsPs $Command)
        $ahkTitles.Count | Should -BeGreaterThan 0
        Join-Sorted $ahkTitles | Should -BeExactly (Join-Sorted $psTitles)
    }
    It 'activates the window group <Command> adds its titles to' -ForEach @(@{ Command = 'OpenPowershell' }, @{ Command = 'OpenCommandPrompt' }) {
        @(Get-AhkGroupProblem $script:windowsAhk $Command) | Should -BeNullOrEmpty
    }
    It 'adds to a window group nowhere but in OpenPowershell and OpenCommandPrompt' {
        $own = @('OpenPowershell', 'OpenCommandPrompt' | ForEach-Object { Get-AhkGroupTitle $script:windowsAhk $_ })
        $all = @(Get-AhkGroupAddLine $script:ahkDir)
        $all.Count | Should -Be $own.Count -Because "every GroupAdd under ahk\ must be one the two functions are read for, and found: $($all -join '; ')"
    }
}

Describe 'The check of the shell windows notices what a changed copy of windows.ahk does' {
    BeforeAll {
        $script:windowsText = Get-Content -LiteralPath $script:windowsAhk -Raw
        function Get-CopyFile {
            param([string]$Text)
            $copy = Join-Path $TestDrive 'windows-copy.ahk'
            Set-Content -LiteralPath $copy -Value $Text
            $copy
        }
    }
    It 'stops at a GroupAdd in the command style, also in another case: <Line>' -ForEach @(
        @{ Line = 'GroupAdd "MacropadPowerShell", "ahk_exe powershell.exe"' }
        @{ Line = 'groupadd "MacropadPowerShell", "ahk_exe powershell.exe"' }
    ) {
        $copyText = $script:windowsText.Replace('GroupAdd("MacropadPowerShell", "ahk_exe powershell.exe")', $Line)
        ($copyText -ceq $script:windowsText) | Should -BeFalse
        { Get-AhkGroupTitle (Get-CopyFile $copyText) 'OpenPowershell' } | Should -Throw '*not two string literals*'
    }
    It 'counts a GroupAdd that another file of the folder makes: <Line>' -ForEach @(
        @{ Line = 'GroupAdd("MacropadPowerShell", "ahk_exe pwsh.exe")' }
        @{ Line = 'GroupAdd "MacropadPowerShell", "ahk_exe pwsh.exe"' }
        @{ Line = 'groupadd(Name, "ahk_exe pwsh.exe")' }
    ) {
        $folder = Join-Path $TestDrive ([guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Path $folder -Force | Out-Null
        Set-Content -LiteralPath (Join-Path $folder 'windows.ahk') -Value $script:windowsText
        $own = @('OpenPowershell', 'OpenCommandPrompt' | ForEach-Object { Get-AhkGroupTitle (Join-Path $folder 'windows.ahk') $_ })
        @(Get-AhkGroupAddLine $folder).Count | Should -Be $own.Count
        Set-Content -LiteralPath (Join-Path $folder 'helper.ahk') -Value "AddShell() {`n    $Line`n}"
        @(Get-AhkGroupAddLine $folder).Count | Should -Be ($own.Count + 1)
    }
    It 'reads the name of a window group without regard to case, and sees another group: <Is>' -ForEach @(
        @{ Is = 'ahk_group macropadpowershell'; Fails = $false }
        @{ Is = 'ahk_group MacropadCommandPrompt'; Fails = $true }
    ) {
        $copyText = $script:windowsText.Replace('ahk_group MacropadPowerShell', $Is)
        ($copyText -ceq $script:windowsText) | Should -BeFalse
        (@(Get-AhkGroupProblem (Get-CopyFile $copyText) 'OpenPowershell').Count -gt 0) | Should -Be $Fails
    }
}
