$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

if (!(Test-Path ".venv\Scripts\python.exe")) {
  python -m venv .venv
}

& ".\.venv\Scripts\python.exe" -m pip install --upgrade pip
& ".\.venv\Scripts\python.exe" -m pip install -r ".\worker\requirements.txt"
npm install
npm run check

Write-Host "Install complete. Start with: .\Start-SynthetiqVoice.cmd"
