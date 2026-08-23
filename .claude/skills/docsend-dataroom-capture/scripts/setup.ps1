# One-time setup for the docsend-dataroom-capture skill (Windows / PowerShell).
#
# Creates a dedicated virtualenv, installs Playwright + python-docx + Pillow,
# and downloads the Chromium build Playwright drives. Re-running is safe.
#
# Usage:  powershell -ExecutionPolicy Bypass -File setup.ps1 [venv-path]
#         default venv path: %USERPROFILE%\.docsend-capture\venv
param(
    [string]$VenvPath = "$env:USERPROFILE\.docsend-capture\venv"
)

$ErrorActionPreference = 'Stop'
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path

# Prefer the py launcher (installed with python.org builds); fall back to python.
$Launcher = if (Get-Command py -ErrorAction SilentlyContinue) { @('py', '-3') }
            elseif (Get-Command python -ErrorAction SilentlyContinue) { @('python') }
            else { $null }
if (-not $Launcher) {
    Write-Error "No Python found. Install Python 3.10+ from python.org or the Microsoft Store, then re-run."
    exit 1
}

$Py = Join-Path $VenvPath 'Scripts\python.exe'
if (-not (Test-Path $Py)) {
    Write-Host "Creating virtualenv at $VenvPath"
    & $Launcher[0] @($Launcher[1..($Launcher.Count - 1)] + @('-m', 'venv', $VenvPath))
    if ($LASTEXITCODE -ne 0) { Write-Error "venv creation failed"; exit 1 }
}

& $Py -m pip install --quiet --upgrade pip
& $Py -m pip install --quiet -r (Join-Path $Here 'requirements.txt')
if ($LASTEXITCODE -ne 0) { Write-Error "dependency install failed"; exit 1 }

# A failed browser download is not fatal: the Python side is usable, and the
# capture script can drive any Chromium via --browser-path.
$BrowserOk = $true
& $Py -m playwright install chromium
if ($LASTEXITCODE -ne 0) { $BrowserOk = $false }

Write-Host ""
Write-Host "Ready. Use this interpreter for the skill's scripts:"
Write-Host "  $Py"

if (-not $BrowserOk) {
    Write-Host ""
    Write-Host "NOTE: Chromium could not be downloaded (offline, or a proxy blocked"
    Write-Host "cdn.playwright.dev). Python packages installed fine. Either retry:"
    Write-Host "  & '$Py' -m playwright install chromium"
    Write-Host "or point the capture script at a Chromium already on this machine:"
    Write-Host "  --browser-path 'C:\Program Files\Google\Chrome\Application\chrome.exe'"
}

Write-Host ""
Write-Host "Example:"
Write-Host "  & '$Py' '$Here\capture_dataroom.py' <room-url> --email you@example.com --out `$env:USERPROFILE\Desktop\room"
