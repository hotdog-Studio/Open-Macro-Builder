# End-to-end fixture: writes "<A>|<the other arguments>" to ps-out-args.txt beside itself, or to
# ps-out-none.txt when it got no arguments, then waits a moment so that its console window stays up
# longer than a flash.
param($A)
$name = if ($PSBoundParameters.Count -eq 0 -and $args.Count -eq 0) { 'none' } else { 'args' }
Set-Content -LiteralPath (Join-Path $PSScriptRoot "ps-out-$name.txt") -Value "$A|$($args -join ' ')" -NoNewline
[System.Threading.Thread]::Sleep(500)
