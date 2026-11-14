# Undo spike\setup.ps1 — RUN ELEVATED.
param([string]$Root = 'D:\5ilence-spike', [string]$User = 'silence-sbx')
$ErrorActionPreference = 'Continue'
Get-NetFirewallRule -DisplayName '5ilence spike: block sandbox outbound' -ErrorAction SilentlyContinue | Remove-NetFirewallRule
$u = Get-LocalUser -Name $User -ErrorAction SilentlyContinue
if ($u) {
  $profile = Get-CimInstance Win32_UserProfile | Where-Object SID -eq $u.SID.Value
  if ($profile) { $profile | Remove-CimInstance }
  Remove-LocalUser -Name $User
}
Remove-ItemProperty -Path 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon\SpecialAccounts\UserList' -Name $User -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force $Root -ErrorAction SilentlyContinue
Remove-Item -Force (Join-Path $env:LOCALAPPDATA 'silence\spike-sbx.pwd') -ErrorAction SilentlyContinue
Remove-Item -Force 'C:\Users\Public\5ilence-spike.txt' -ErrorAction SilentlyContinue
Write-Host 'Spike removed.'
