# Run the spike matrix as a NORMAL user (the way the Engine runs). Output: spike\result.txt
param([string]$Root = 'D:\5ilence-spike', [string]$User = 'silence-sbx')
$ErrorActionPreference = 'Stop'
$spike = Join-Path $PSScriptRoot '..\..\..\target\debug\examples\spike.exe'
$pwdFile = Join-Path $env:LOCALAPPDATA 'silence\spike-sbx.pwd'
$secure = Get-Content $pwdFile | ConvertTo-SecureString
$env:SBX_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
$env:SBX_USER = $User
$env:SPIKE_ROOT = $Root
try {
  $isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  "admin=$isAdmin  firewall=" + ((Get-NetFirewallProfile | ForEach-Object { "$($_.Name):$($_.Enabled)" }) -join ',') |
    Tee-Object -FilePath (Join-Path $PSScriptRoot 'result.txt')
  & $spike run 2>&1 | Tee-Object -FilePath (Join-Path $PSScriptRoot 'result.txt') -Append
} finally {
  Remove-Item Env:SBX_PASSWORD
}
