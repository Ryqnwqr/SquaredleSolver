# Push SquaredleSolver to GitHub (run after: gh auth login)
$Gh = "C:\Program Files\GitHub CLI\gh.exe"
if (-not (Test-Path $Gh)) {
    Write-Error "GitHub CLI not found. Install from https://cli.github.com/"
    exit 1
}

$env:Path = "C:\Program Files\GitHub CLI;" + $env:Path
Set-Location (Split-Path $PSScriptRoot -Parent)

& $Gh auth status
if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "Run: gh auth login"
    Write-Host "  (use web browser, then press Enter when prompted)"
    exit 1
}

$remote = git remote get-url origin 2>$null
if (-not $remote) {
    & $Gh repo create SquaredleSolver --public --source=. --remote=origin --push
} else {
    git push -u origin main
}

if ($LASTEXITCODE -eq 0) {
    $user = & $Gh api user --jq .login 2>$null
    if ($user) { Write-Host "`nRepository: https://github.com/$user/SquaredleSolver" }
}
