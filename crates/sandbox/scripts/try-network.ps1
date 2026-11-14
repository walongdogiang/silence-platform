# Thử chặn mạng (Phase 3). Chạy trong PowerShell THƯỜNG, từ gốc worktree/repo:
#   powershell -ExecutionPolicy Bypass -File .\crates\sandbox\scripts\try-network.ps1
# `sandbox setup` chạy lại để thêm firewall rule: 1 hộp thoại UAC (bấm Yes).
# Kết quả: crates\sandbox\scripts\try-network.txt
param([string]$Root = 'D:\5ilence-sbx-test')
$ErrorActionPreference = 'Continue'
$exe = Join-Path $PSScriptRoot '..\..\..\target\debug\silence-engine.exe' | Resolve-Path
$out = Join-Path $PSScriptRoot 'try-network.txt'
"" | Out-File $out -Encoding utf8
function Log($s) { $s; $s | Out-File $out -Append -Encoding utf8 }

$st = (& $exe sandbox status | Out-String).Trim()
if ($st -notmatch '"ready"') {
  Log "== setup (UAC, them firewall rule)"; Log (& $exe sandbox setup 2>&1 | Out-String).Trim()
  $st = (& $exe sandbox status | Out-String).Trim()
}
Log "status: $st"
if ($st -notmatch '"ready"') { Log "DUNG: sandbox chua ready"; exit 1 }
$ws = Join-Path $Root 'ws'
New-Item -ItemType Directory -Force $ws | Out-Null
& $exe sandbox grant $ws 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { Log "DUNG: grant that bai"; exit 1 }

# Đối chứng NGOÀI sandbox (user thật): mạng phải chạy, để chắc "bị chặn" là do sandbox.
$c = [Net.Sockets.TcpClient]::new(); try { $c.Connect('1.1.1.1', 443); Log "[doi chung] user that TCP 1.1.1.1:443: OK" } catch { Log "[doi chung] user that TCP 1.1.1.1:443: LOI ($($_.Exception.Message)) - mang may nay co van de, ket qua ben duoi khong dang tin" } finally { $c.Close() }

$checks = @(
  @{ n = 'DNS van phan giai duoc (DNS khong phai thu chan)'; ok = $true; c = "Resolve-DnsName example.com -Type A -ErrorAction Stop | Out-Null" },
  @{ n = 'TCP thang toi IP 1.1.1.1:443 (bo qua proxy)'; ok = $false; c = "`$t=[Net.Sockets.TcpClient]::new(); `$t.Connect('1.1.1.1',443)" },
  @{ n = 'curl --noproxy registry (bo qua proxy)'; ok = $false; c = "curl.exe -sS --max-time 10 --noproxy '*' -o NUL https://registry.npmjs.org/; if (`$LASTEXITCODE) { throw 'curl' }" },
  @{ n = 'curl qua proxy -> registry.npmjs.org'; ok = $true; c = "`$code = curl.exe -sS --max-time 20 -o NUL -w '%{http_code}' https://registry.npmjs.org/react; if (`$code -ne '200') { throw ('http ' + `$code) }" },
  @{ n = 'curl qua proxy -> example.com (ngoai allowlist)'; ok = $false; c = "curl.exe -sS --max-time 10 -o NUL https://example.com/; if (`$LASTEXITCODE) { throw 'curl' }" },
  @{ n = 'npm view react version (qua proxy)'; ok = $true; c = "npm view react version; if (`$LASTEXITCODE) { throw 'npm' }" },
  @{ n = 'git ls-remote github.com (ngoai allowlist)'; ok = $false; c = "git ls-remote https://github.com/git/git HEAD; if (`$LASTEXITCODE) { throw 'git' }" }
)
foreach ($k in $checks) {
  $t = [Diagnostics.Stopwatch]::StartNew()
  $r = & $exe sandbox exec --ws $ws -- "`$ErrorActionPreference='Stop'; $($k.c)" 2>&1 | Out-String
  $code = $LASTEXITCODE; $t.Stop()
  $infra = ($r -notmatch '\[sandbox\] exit=') -or ($r -match 'silence-sbx-runner:')
  $pass = (-not $infra) -and (($code -eq 0) -eq $k.ok)
  $net = (($r -split "`n") | Where-Object { $_ -match '\[sandbox\] net' } | ForEach-Object { $_.Trim() -replace '^.*\[sandbox\] net ', '' }) -join '; '
  $tail = ($r -replace '\s+', ' ').Trim(); if ($tail.Length -gt 140) { $tail = $tail.Substring($tail.Length - 140) }
  Log ("[{0}] {1}: exit={2} {3}ms | net: {4} | {5}" -f ($(if ($pass) { 'PASS' } else { 'FAIL' })), $k.n, $code, $t.ElapsedMilliseconds, $net, $tail)
}
# Cho phép thêm github.com cho đúng một lần chạy: phải qua được.
$r = & $exe sandbox exec --ws $ws --allow github.com -- "`$ErrorActionPreference='Stop'; git ls-remote https://github.com/git/git HEAD; if (`$LASTEXITCODE) { throw 'git' }" 2>&1 | Out-String
Log ("[{0}] git ls-remote voi --allow github.com: exit={1}" -f ($(if ($LASTEXITCODE -eq 0) { 'PASS' } else { 'FAIL' })), $LASTEXITCODE)
Log "Xong."
