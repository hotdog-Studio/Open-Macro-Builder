# Runs the Pester suite, plus the tests for your own commands in local\powershell\tests when that
# folder exists (git ignores it). -Ci (the Jenkins Windows stage) writes JUnit XML to
# results/pester/test-results.xml at the repo root and leaves out the Integration tests, which
# open windows and send real keys. -Ci alone also measures code coverage of powershell\lib,
# powershell\commands (custom ones included) and powershell\config.ps1: Pester prints the figure and
# writes JaCoCo XML to results/pester/coverage.xml; nothing fails on it. -Integration runs those tests (tag Integration) alone, the
# end-to-end test still left out: with -Ci its JUnit XML goes to results/pester/integration-results.xml.
# Like -EndToEnd it takes the screen and the keyboard, and it prints the same photosensitivity
# warning. -Integration with -EndToEnd is refused: run them apart. The end-to-end test (tag EndToEnd)
# is left out of every run but -EndToEnd, which runs it alone: it takes the keyboard, the mouse and
# the screen for a few minutes.
# -EndToEnd always runs it in a PowerShell process started here for it, never in the shell this script
# was called from: the test's banner watches that process and cleans up when it has ended.
# With -Ci -EndToEnd its JUnit XML goes to results/pester/end-to-end-results.xml, and a case that
# would act on a window left open on the desktop fails instead of skipping (the CI desktop must be
# clean). -Case runs only the end-to-end cases whose name matches a regular expression, such as
# -Case 'ChromeNewTab|E2eStep'. -EndToEndCleanup runs no test: it cleans up after end-to-end runs that
# did not end themselves (ends their processes, closes their windows and virtual desktops, lets go of
# held keys, starts again the macropads they stopped, removes their folders), touching only what each
# run's state file shows is still that run's; it exits 1 when something could not be cleaned up.
# -EarlierBuilds, with -EndToEndCleanup and only in a Jenkins build (BUILD_TAG and WORKSPACE set, this
# script inside that workspace), first ends what an earlier build of the job left in the workspace: a
# process that runs from it or works in it and started before this clean-up did, the build's own steps
# left out. It prints each one. Never use it on your own checkout: your shells stand in it.
# -LimitMinutes changes the end-to-end run's time limit (20 minutes), after which it stops and cleans
# up. -Repeat says how many times the cases that repeat a moment (the Calculator series) run it (2).
param([string[]]$ExcludeTag = @(), [switch]$Ci, [switch]$Integration, [switch]$EndToEnd, [string]$Case, [switch]$EndToEndCleanup, [switch]$EarlierBuilds, [int]$LimitMinutes = 20, [int]$Repeat = 0)
$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
if ($EndToEndCleanup) {
    foreach ($f in 'Native', 'Interop', 'Pump', 'Input', 'AhkSyntax', 'WinTitle', 'WindowOps', 'Window') { . (Join-Path $root "powershell\lib\$f.ps1") }
    foreach ($f in 'Ahk', 'CommandSource', 'EndToEnd') { . (Join-Path $PSScriptRoot "helpers\$f.ps1") }
    $workspace = ''
    if ($EarlierBuilds) {
        $inWorkspace = $env:WORKSPACE -and ($root.TrimEnd('\') + '\').StartsWith($env:WORKSPACE.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)
        if ($env:BUILD_TAG -and $inWorkspace) { $workspace = $env:WORKSPACE.TrimEnd('\') }
        else { Write-Host 'End-to-end clean-up: -EarlierBuilds is for a Jenkins build only (BUILD_TAG, and WORKSPACE with this script in it); nothing outside the runs'' own folders is looked at.' }
    }
    $result = Clear-E2eLeftovers -Workspace $workspace
    Write-Host "End-to-end clean-up: $($result.Done.Count) thing(s) done, $($result.Problems.Count) not done."
    if ($result.Problems.Count -gt 0) { exit 1 }
    exit 0
}
if ($Integration -and $EndToEnd) {
    Write-Host '-Integration and -EndToEnd cannot be used together: run them apart.'
    exit 1
}
if ($EndToEnd -and $env:OMB_E2E -ne '1') {
    # The process the end-to-end test runs in: it gets what was asked for through these variables.
    $env:OMB_E2E = '1'
    if ($Ci) { $env:OMB_E2E_CI = '1' }
    if ($Case) { $env:OMB_E2E_CASE = $Case }
    $env:OMB_E2E_LIMIT = "$LimitMinutes"
    if ($Repeat -gt 0) { $env:OMB_E2E_REPEAT = "$Repeat" }
    try {
        $arguments = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $PSCommandPath, '-EndToEnd') + @(if ($Ci) { '-Ci' })
        & powershell.exe @arguments
        $code = $LASTEXITCODE
    } finally { Remove-Item Env:\OMB_E2E, Env:\OMB_E2E_CASE, Env:\OMB_E2E_CI, Env:\OMB_E2E_LIMIT, Env:\OMB_E2E_REPEAT -ErrorAction SilentlyContinue }
    exit $code
}
Import-Module Pester -MinimumVersion 5.0 -Force
$c = New-PesterConfiguration
$c.Run.Path = @($PSScriptRoot) + @(Join-Path $root 'local\powershell\tests' | Where-Object { Test-Path -LiteralPath $_ })
$c.Run.Exit = $true
$c.Output.Verbosity = 'Detailed'
$resultFile = 'test-results.xml'
if ($EndToEnd -or $Integration) {
    Write-Host 'Photosensitivity warning: this run opens, moves and closes windows. Look away if flashing affects you.'
}
if ($EndToEnd) {
    $c.Run.Path = @(Join-Path $PSScriptRoot 'EndToEnd.Tests.ps1')
    $c.Filter.Tag = @('EndToEnd')
    $resultFile = 'end-to-end-results.xml'
} elseif ($Integration) {
    $c.Filter.Tag = @('Integration')
    $resultFile = 'integration-results.xml'
}
if (-not $EndToEnd) { $ExcludeTag = @($ExcludeTag) + 'EndToEnd' }
if ($Ci) {
    if (-not $EndToEnd -and -not $Integration) { $ExcludeTag = @($ExcludeTag) + 'Integration' }
    $results = Join-Path $root 'results\pester'
    New-Item -ItemType Directory -Force -Path $results | Out-Null
    $c.TestResult.Enabled = $true
    $c.TestResult.OutputFormat = 'JUnitXml'
    $c.TestResult.OutputPath = Join-Path $results $resultFile
    if (-not $EndToEnd -and -not $Integration) {
        # The plain -Ci run is the one that measures which of the PowerShell version's code the suite
        # executes: lib, commands (the built-in and the example custom ones) and config.ps1, not the
        # tests, their helpers, the C# shim, main.ps1 or tools. The figure goes to the console, the
        # JaCoCo file to results/pester/coverage.xml (the Jenkins stage archives it). Nothing fails on
        # it: the run's exit code is the count of failed tests.
        $c.CodeCoverage.Enabled = $true
        $c.CodeCoverage.Path = @(@('powershell\lib\*.ps1', 'powershell\commands\*.ps1', 'powershell\commands\custom\*.ps1', 'powershell\config.ps1') | ForEach-Object { Join-Path $root $_ })
        $c.CodeCoverage.OutputFormat = 'JaCoCo'
        $c.CodeCoverage.OutputPath = Join-Path $results 'coverage.xml'
        $c.CodeCoverage.ReportRoot = $root
    }
}
$c.Filter.ExcludeTag = $ExcludeTag
Invoke-Pester -Configuration $c
