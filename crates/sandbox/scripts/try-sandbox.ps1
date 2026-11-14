# Thử sandbox Phase 2 trên máy thật. Chạy trong PowerShell THƯỜNG (không Admin), từ gốc repo:
#   powershell -ExecutionPolicy Bypass -File .\crates\sandbox\scripts\try-sandbox.ps1
# `sandbox setup` sẽ bật 1 hộp thoại UAC (bấm Yes). Kết quả: crates\sandbox\scripts\try-result.txt
param([string]$Root = 'D:\5ilence-sbx-test')
$ErrorActionPreference = 'Continue'
$exe = Join-Path $PSScriptRoot '..\..\..\target\debug\silence-engine.exe' | Resolve-Path
$out = Join-Path $PSScriptRoot 'try-result.txt'
"" | Out-File $out -Encoding utf8
function Log($s) { $s; $s | Out-File $out -Append -Encoding utf8 }

Log "== status (truoc setup)"; Log (& $exe sandbox status)
Log "== setup (UAC)"; Log (& $exe sandbox setup 2>&1 | Out-String).Trim()
if ($LASTEXITCODE -ne 0) { Log "DUNG: setup that bai (xem %LOCALAPPDATA%\silence\sandbox\setup.log)"; exit 1 }

$ws = Join-Path $Root 'ws'; $other = Join-Path $Root 'other'
New-Item -ItemType Directory -Force $ws, $other, (Join-Path $ws '.silence') | Out-Null
'x' | Set-Content (Join-Path $ws 'existing.txt')
Log "== grant $ws"; Log (& $exe sandbox grant $ws 2>&1 | Out-String).Trim()
if ($LASTEXITCODE -ne 0) { Log "DUNG: grant that bai"; exit 1 }

$env:SILENCE_API_KEY = 'sk-should-not-leak'
$checks = @(
  @{ n = 'whoami + FullLanguage'; ok = $true;  c = "whoami; if (`$ExecutionContext.SessionState.LanguageMode -ne 'FullLanguage') { throw 'CLM' }" },
  @{ n = 'ghi workspace (file moi)'; ok = $true; c = "Set-Content -LiteralPath '$ws\new.txt' 'x'" },
  @{ n = 'ghi file co san'; ok = $true; c = "Add-Content -LiteralPath '$ws\existing.txt' 'y'" },
  @{ n = 'ghi thu muc khac tren D:'; ok = $false; c = "Set-Content -LiteralPath '$other\x.txt' 'x'" },
  @{ n = 'ghi .silence trong workspace'; ok = $false; c = "Set-Content -LiteralPath '$ws\.silence\x.txt' 'x'" },
  @{ n = 'doc profile user that'; ok = $false; c = "Get-ChildItem -LiteralPath '$env:USERPROFILE' -Force | Out-Null" },
  @{ n = 'env khong lo SILENCE_API_KEY'; ok = $true; c = "if (`$env:SILENCE_API_KEY) { throw 'leaked' }" },
  @{ n = 'git/node chay duoc'; ok = $true; c = "git --version; if (!`$?) { throw 'git' }; node --version; if (!`$?) { throw 'node' }" }
)
Log "== exec"
foreach ($k in $checks) {
  $t = [Diagnostics.Stopwatch]::StartNew()
  $r = & $exe sandbox exec --ws $ws -- "`$ErrorActionPreference='Stop'; $($k.c)" 2>&1 | Out-String
  $code = $LASTEXITCODE; $t.Stop()
  # Lỗi của chính sandbox (không chạy được lệnh) không bao giờ tính là "bị chặn đúng".
  $infra = ($r -notmatch '\[sandbox\] exit=') -or ($r -match 'silence-sbx-runner:')
  $pass = (-not $infra) -and (($code -eq 0) -eq $k.ok)
  $tail = ($r -replace '\s+', ' ').Trim(); if ($tail.Length -gt 160) { $tail = $tail.Substring($tail.Length - 160) }
  Log ("[{0}] {1}: exit={2} {3}ms | {4}" -f ($(if ($pass) { 'PASS' } else { 'FAIL' })), $k.n, $code, $t.ElapsedMilliseconds, $tail)
}
$r = & $exe sandbox exec --ws $ws --timeout-secs 3 -- "Start-Sleep 30" 2>&1 | Out-String
Log ("[{0}] timeout 3s: exit={1}" -f ($(if ($LASTEXITCODE -eq 124) { 'PASS' } else { 'FAIL' })), $LASTEXITCODE)
Remove-Item Env:SILENCE_API_KEY
Log "== status (sau)"; Log (& $exe sandbox status)
Log "Xong. Go bo: & '$exe' sandbox uninstall   (1 UAC)"
