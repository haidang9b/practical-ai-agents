$ErrorActionPreference = 'Stop'

Set-Location -Path $PSScriptRoot

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    throw 'npm was not found. Install Node.js and npm, then run this script again.'
}

if (-not (Test-Path -Path (Join-Path $PSScriptRoot 'node_modules'))) {
    throw 'Dependencies are not installed. Run "npm install" in the project folder first.'
}

Write-Host 'Starting frontend (Vite) and backend (Express API)...'
Write-Host 'Frontend: http://localhost:5173'
Write-Host 'Backend API: http://localhost:3001'
Write-Host 'Press Ctrl+C to stop both processes.'
& npm run dev
exit $LASTEXITCODE