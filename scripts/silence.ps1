# PowerShell shortcuts for the 5ilence repo. Load from $PROFILE:
#   . "D:\vuhieu\5ilence\scripts\silence.ps1"
# Then type from any directory:
#   run s              -> npm run studio
#   run sw             -> npm run studio:watch  (UI HMR + Engine auto build/restart)
#   run rt             -> npm run runtime
#   run studio watch   -> npm run studio:watch  (full name still works)
# Words are joined with ":" into an npm script name from the root package.json;
# a first word matching $script:Aliases is expanded to its full name.

$script:SilenceRoot = Split-Path -Parent $PSScriptRoot

$script:Aliases = @{
    s  = "studio"
    sw = "studio:watch"
    rt = "runtime"
}

function run {
    if ($args.Count -eq 0) {
        Write-Host "Usage: run <script> [parts...]   e.g. run sw, run studio watch" -ForegroundColor Yellow
        Write-Host ("Aliases: " + (($script:Aliases.GetEnumerator() | Sort-Object Name | ForEach-Object { "$($_.Name)=$($_.Value)" }) -join ", ")) -ForegroundColor Yellow
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
