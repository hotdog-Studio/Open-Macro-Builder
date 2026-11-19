# Runs the Pester suite, plus the tests for your own commands in local\powershell\tests when that
# folder exists (git ignores it). -Ci (the Jenkins Windows stage) writes JUnit XML to
# results/pester/test-results.xml at the repo root and leaves out the Integration tests, which
# open windows and send real keys. The end-to-end test (tag EndToEnd) is left out of every run but
# -EndToEnd, which runs it alone: it takes the keyboard, the mouse and the screen for a few minutes.
# -EndToEnd always runs it in a PowerShell process started here for it, never in the shell this script
# was called from: the test's banner watches that process and cleans up when it has ended.
# With -Ci -EndToEnd its JUnit XML goes to results/pester/end-to-end-results.xml, and a case that
# would act on a window left open on the desktop fails instead of skipping (the CI desktop must be
# clean). -Case runs only the end-to-end cases whose name matches a regular expression, such as
# -Case 'ChromeNewTab|E2eStep'. -EndToEndCleanup runs no test: it cleans up after end-to-end runs that
# did not end themselves (ends their processes, closes their windows and virtual desktops, lets go of
# held keys, starts again the macropads they stopped, removes their folders), touching only what each
# run's state file shows is still that run's; it exits 1 when something could not be cleaned up.
# -LimitMinutes changes the end-to-end run's time limit (20 minutes), after which it stops and cleans
# up. -Repeat says how many times the cases that repeat a moment (the Calculator series) run it (2).
param([string[]]$ExcludeTag = @(), [switch]$Ci, [switch]$EndToEnd, [string]$Case, [switch]$EndToEndCleanup, [int]$LimitMinutes = 20, [int]$Repeat = 0)
$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
if ($EndToEndCleanup) {
    foreach ($f in 'Native', 'Interop', 'Pump', 'Input', 'AhkSyntax', 'WinTitle', 'WindowOps', 'Window') { . (Join-Path $root "powershell\lib\$f.ps1") }
    foreach ($f in 'Ahk', 'CommandSource', 'EndToEnd') { . (Join-Path $PSScriptRoot "helpers\$f.ps1") }
    $result = Clear-E2eLeftovers
    Write-Host "End-to-end clean-up: $($result.Done.Count) thing(s) done, $($result.Problems.Count) not done."
    if ($result.Problems.Count -gt 0) { exit 1 }
    exit 0
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
if ($EndToEnd) {
    Write-Host 'Photosensitivity warning: this test opens, moves and closes windows. Look away if flashing affects you.'
    $c.Run.Path = @(Join-Path $PSScriptRoot 'EndToEnd.Tests.ps1')
    $c.Filter.Tag = @('EndToEnd')
    $resultFile = 'end-to-end-results.xml'
} else {
    $ExcludeTag = @($ExcludeTag) + 'EndToEnd'
}
if ($Ci) {
    if (-not $EndToEnd) { $ExcludeTag = @($ExcludeTag) + 'Integration' }
    $results = Join-Path $root 'results\pester'
    New-Item -ItemType Directory -Force -Path $results | Out-Null
    $c.TestResult.Enabled = $true
    $c.TestResult.OutputFormat = 'JUnitXml'
    $c.TestResult.OutputPath = Join-Path $results $resultFile
}
$c.Filter.ExcludeTag = $ExcludeTag
Invoke-Pester -Configuration $c
