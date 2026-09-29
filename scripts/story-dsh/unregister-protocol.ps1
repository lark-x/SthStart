$ErrorActionPreference = 'Stop'
$protocolKey = 'HKCU:\Software\Classes\sthstart-dsh'
$commandKey = Join-Path $protocolKey 'shell\open\command'

if (-not (Test-Path -LiteralPath $protocolKey)) {
  Write-Host 'The sthstart-dsh protocol is not registered for the current user.'
  exit 0
}

$commandItem = Get-Item -LiteralPath $commandKey -ErrorAction SilentlyContinue
$existing = if ($commandItem) { $commandItem.GetValue('') } else { $null }
if (-not $existing -or $existing -notlike '*protocol-handler.mjs*') {
  throw 'The registration does not belong to SthStart DSH; it was not removed.'
}

Remove-Item -LiteralPath $protocolKey -Recurse -Force
Write-Host 'Removed the sthstart-dsh protocol registration for the current Windows user.'
