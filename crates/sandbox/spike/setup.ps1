# Phase 0 spike setup — RUN ELEVATED (Administrator PowerShell) from the repo root.
# Creates: hidden local user `silence-sbx`, test folders under $Root, 5ilence-SID ACEs on ws/tmp,
# and an outbound firewall block for that user (all remote addresses except loopback).
# Undo with spike\teardown.ps1.
param([string]$Root = 'D:\5ilence-spike', [string]$User = 'silence-sbx')
$ErrorActionPreference = 'Stop'

$spike = Join-Path $PSScriptRoot '..\..\..\target\debug\examples\spike.exe'
if (-not (Test-Path $spike)) { throw "Build first: .\scripts\cargo-msvc.bat build -p silence-sandbox --example spike" }
$sids = @(& $spike sid)   # capability SID + synthetic SID, one per line

# 1. Sandbox user with a random password, stored DPAPI-encrypted for the current account only.
Add-Type -AssemblyName System.Web
$plain = [System.Web.Security.Membership]::GeneratePassword(32, 6)
$secure = ConvertTo-SecureString $plain -AsPlainText -Force
if (Get-LocalUser -Name $User -ErrorAction SilentlyContinue) { Set-LocalUser -Name $User -Password $secure }
else { New-LocalUser -Name $User -Password $secure -PasswordNeverExpires -UserMayNotChangePassword -AccountNeverExpires -Description '5ilence sandbox (spike)' | Out-Null }
Add-LocalGroupMember -Group 'Users' -Member $User -ErrorAction SilentlyContinue
$store = Join-Path $env:LOCALAPPDATA 'silence'
New-Item -ItemType Directory -Force $store | Out-Null
$secure | ConvertFrom-SecureString | Set-Content -Encoding ascii (Join-Path $store 'spike-sbx.pwd')
$plain = $null

# Hide from the sign-in screen.
$ul = 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon\SpecialAccounts\UserList'
New-Item -Force $ul | Out-Null
New-ItemProperty -Path $ul -Name $User -Value 0 -PropertyType DWord -Force | Out-Null

# 2. Folders: ws + tmp get a Modify ACE for the 5ilence SID; `other` gets nothing (inherits D:\).
foreach ($d in 'ws', 'other', 'tmp') { New-Item -ItemType Directory -Force (Join-Path $Root $d) | Out-Null }
# Set-Acl with a raw SecurityIdentifier: icacls refuses SIDs that map to no account (synthetic SID).
foreach ($d in 'ws', 'tmp') {
  $path = Join-Path $Root $d
  $acl = Get-Acl -LiteralPath $path
  foreach ($s in $sids) {
    $rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
      (New-Object System.Security.Principal.SecurityIdentifier($s)), 'Modify',
      'ContainerInherit,ObjectInherit', 'None', 'Allow')
    $acl.AddAccessRule($rule)
  }
  Set-Acl -LiteralPath $path -AclObject $acl
}

# 3. Firewall: block every outbound remote address except loopback, for this user only.
$userSid = (Get-LocalUser -Name $User).SID.Value
Get-NetFirewallRule -DisplayName '5ilence spike: block sandbox outbound' -ErrorAction SilentlyContinue | Remove-NetFirewallRule
New-NetFirewallRule -DisplayName '5ilence spike: block sandbox outbound' -Direction Outbound -Action Block -Profile Any `
  -LocalUser "D:(A;;CC;;;$userSid)" `
  -RemoteAddress @('0.0.0.0-126.255.255.255', '128.0.0.0-255.255.255.255', '::2-ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff') | Out-Null

Write-Host "OK. user=$User sid=$userSid sandboxSids=$($sids -join ',') root=$Root"
Write-Host "Now, in a NORMAL (non-admin) PowerShell: .\crates\sandbox\spike\run.ps1"
