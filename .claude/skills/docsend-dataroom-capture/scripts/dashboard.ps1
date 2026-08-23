# Launch the DocSend Capture dashboard on Windows.
#
# Finds the virtualenv setup.ps1 created and starts the local server, which
# opens your browser. Right-click > "Run with PowerShell", or:
#   powershell -ExecutionPolicy Bypass -File dashboard.ps1 [-Port 8765]
param(
    [int]$Port = 8765,
    [string]$VenvPath = "$env:USERPROFILE\.docsend-capture\venv"
)

$ErrorActionPreference = 'Stop'
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
$Py = Join-Path $VenvPath 'Scripts\python.exe'

# Keep this file pure ASCII. Windows PowerShell 5.1 reads a BOM-less .ps1 as
# ANSI, so a UTF-8 em dash arrives as 'a EUR "' - and that last byte decodes to a
# right smart quote, which PowerShell treats as a real string delimiter. One
# stray dash in a comment silently unbalances the whole file.
if (-not (Test-Path $Py)) {
    $setup = Join-Path $Here 'setup.ps1'
    Write-Host "No virtualenv at $VenvPath. Run setup first:"
    Write-Host "  powershell -ExecutionPolicy Bypass -File '$setup'"
    exit 1
}

& $Py (Join-Path $Here 'dashboard.py') --port $Port
