param(
  [Parameter(Mandatory = $true)][ValidatePattern('^[A-Za-z0-9-]{8,128}$')][string]$ProjectId,
  [string]$PortalUrl = 'http://127.0.0.1:9320',
  [switch]$Pair
)

$ErrorActionPreference = 'Stop'
$credentialRoot = Join-Path $env:LOCALAPPDATA 'SthStart\StoryBridge'
$credentialPath = Join-Path $credentialRoot "$ProjectId.cred"
New-Item -ItemType Directory -Path $credentialRoot -Force | Out-Null
$currentSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
& icacls.exe $credentialRoot /inheritance:r /grant:r "*$currentSid`:(OI)(CI)F" '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' /T /C | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Unable to restrict bridge credential access to the current user and system.' }

function Protect-CredentialFile {
  if (-not (Test-Path -LiteralPath $credentialPath)) { return }
  & icacls.exe $credentialPath /inheritance:r /grant:r "*$currentSid`:F" '*S-1-5-18:F' '*S-1-5-32-544:F' | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Unable to restrict access to the project bridge credential.' }
}

if ($Pair -or -not (Test-Path -LiteralPath $credentialPath)) {
  if ($Pair -and (Test-Path -LiteralPath $credentialPath)) { Write-Host 'Replacing the locally saved bridge credential for this project.' }
  $secureToken = Read-Host 'Paste the one-time project bridge token shown by SthStart' -AsSecureString
  $protected = ConvertFrom-SecureString -SecureString $secureToken
  Set-Content -LiteralPath $credentialPath -Value $protected -Encoding ascii
  Protect-CredentialFile
} else {
  Protect-CredentialFile
  $protected = (Get-Content -LiteralPath $credentialPath -Raw).Trim()
  $secureToken = ConvertTo-SecureString -String $protected
}

$tokenPointer = [IntPtr]::Zero
try {
  $tokenPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)
  $plainToken = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($tokenPointer)
  if ($plainToken -notmatch '^[A-Za-z0-9_-]{40,128}$') { throw 'The local bridge credential is invalid. Generate a new token in SthStart and pair again with -Pair.' }
  $env:STHSTART_STORY_BRIDGE_TOKEN = $plainToken
  $env:STHSTART_STORY_PROJECT_ID = $ProjectId
  $env:STHSTART_STORY_PORTAL_URL = $PortalUrl
  $launcher = Join-Path $PSScriptRoot 'launcher.mjs'
  & node $launcher --project $ProjectId --portal $PortalUrl
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally {
  if ($tokenPointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($tokenPointer) }
  Remove-Item Env:STHSTART_STORY_BRIDGE_TOKEN -ErrorAction SilentlyContinue
  Remove-Item Env:STHSTART_STORY_PROJECT_ID -ErrorAction SilentlyContinue
  Remove-Item Env:STHSTART_STORY_PORTAL_URL -ErrorAction SilentlyContinue
}
