$ErrorActionPreference = 'Stop'

$node = Get-Command node.exe -ErrorAction Stop
$handler = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot 'protocol-handler.mjs')).Path
$nodePath = $node.Source
$protocolKey = 'HKCU:\Software\Classes\sthstart-dsh'
$commandKey = Join-Path $protocolKey 'shell\open\command'
$command = '"{0}" "{1}" "%1"' -f $nodePath, $handler

if (Test-Path -LiteralPath $protocolKey) {
  $commandItem = Get-Item -LiteralPath $commandKey -ErrorAction SilentlyContinue
  $existing = if ($commandItem) { $commandItem.GetValue('') } else { $null }
  if (-not $existing -or $existing -notlike '*protocol-handler.mjs*') {
    throw 'The sthstart-dsh protocol is already registered by another app; registry was not changed.'
  }
}

New-Item -Path $commandKey -Force | Out-Null
Set-Item -LiteralPath $protocolKey -Value 'URL: SthStart DSH Launcher'
New-ItemProperty -LiteralPath $protocolKey -Name 'URL Protocol' -Value '' -PropertyType String -Force | Out-Null
Set-Item -LiteralPath $commandKey -Value $command
Write-Host 'Registered sthstart-dsh:// for the current Windows user.'
Write-Host 'You can now launch paired story projects from the SthStart Control Center.'
