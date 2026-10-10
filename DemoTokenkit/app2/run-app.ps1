[CmdletBinding()]
param(
    [switch]$Install
)

$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot

if (-not (Test-Path (Join-Path $projectRoot 'package.json'))) {
    throw "Could not find package.json in $projectRoot"
}

if (-not (Get-Command node.exe -ErrorAction SilentlyContinue)) {
    throw 'Node.js is required. Install the Node.js LTS release, then run this script again.'
}

$npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
if (-not $npm) {
    throw 'npm was not found. Reinstall Node.js with npm included, then run this script again.'
}

Push-Location $projectRoot
try {
    if (-not (Test-Path (Join-Path $projectRoot 'node_modules'))) {
        if (-not $Install) {
            throw 'Dependencies are missing. Run this script with -Install to install them first.'
        }

        Write-Host 'Installing project dependencies...'
        & $npm.Source install
        if ($LASTEXITCODE -ne 0) {
            throw "npm install failed with exit code $LASTEXITCODE"
        }
    }

    Write-Host 'Starting the web app and API. Press Ctrl+C to stop both.'
    & $npm.Source run dev
    if ($LASTEXITCODE -ne 0) {
        throw "npm run dev exited with code $LASTEXITCODE"
    }
}
finally {
    Pop-Location
}
