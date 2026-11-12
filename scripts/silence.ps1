# Lệnh tắt PowerShell cho repo 5ilence. Nạp từ $PROFILE:
#   . "D:\vuhieu\5ilence\scripts\silence.ps1"
# Rồi gõ ở bất kỳ thư mục nào:
#   run s              -> npm run studio
#   run sw             -> npm run studio:watch  (UI HMR + Engine tự build/restart)
#   run rt             -> npm run runtime
#   run studio watch   -> npm run studio:watch  (tên đầy đủ vẫn dùng được)
# Các từ được nối bằng ":" thành tên npm script trong package.json gốc;
# phần đầu khớp bảng $script:Aliases thì được đổi sang tên đầy đủ.

$script:SilenceRoot = Split-Path -Parent $PSScriptRoot

$script:Aliases = @{
    s  = "studio"
    sw = "studio:watch"
    rt = "runtime"
}

function run {
    if ($args.Count -eq 0) {
        Write-Host "Cách dùng: run <script> [phần...]   vd. run sw, run studio watch" -ForegroundColor Yellow
        Write-Host ("Tên tắt: " + (($script:Aliases.GetEnumerator() | Sort-Object Name | ForEach-Object { "$($_.Name)=$($_.Value)" }) -join ", ")) -ForegroundColor Yellow
        Push-Location $script:SilenceRoot
        try { npm run } finally { Pop-Location }
        return
    }
    $parts = @($args | ForEach-Object { "$_" -split ":" })
    if ($script:Aliases.ContainsKey($parts[0])) { $parts[0] = $script:Aliases[$parts[0]] }
    $name = $parts -join ":"
    Push-Location $script:SilenceRoot
    try { npm run $name } finally { Pop-Location }
}
