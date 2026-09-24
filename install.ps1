# Installs adactus globally via npm and runs the doctor check (Windows).
$ErrorActionPreference = "Stop"

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Error "adactus install: node is not installed. Install Node.js >= 20 first."
  exit 1
}

$nodeMajor = [int](node -e "console.log(process.versions.node.split('.')[0])")
if ($nodeMajor -lt 20) {
  Write-Error "adactus install: Node.js >= 20 is required (found $(node -v))."
  exit 1
}

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  Write-Error "adactus install: npm is not installed."
  exit 1
}

Write-Host "Installing adactus from $PSScriptRoot ..."
# --install-links copies the package and installs node-pty; a plain
# `npm install -g .` would only link this folder without dependencies.
Push-Location $PSScriptRoot
try {
  npm install -g --install-links .
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally {
  Pop-Location
}

$globalPrefix = (npm prefix -g).Trim()

Write-Host ""
Write-Host "Running adactus doctor..."
& (Join-Path $globalPrefix "adactus.cmd") doctor
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

if (-not (Get-Command adactus -ErrorAction SilentlyContinue)) {
  Write-Host ""
  Write-Host "adactus install: installed to $globalPrefix, which is not on your PATH."
  Write-Host "Add it with:  [Environment]::SetEnvironmentVariable('Path', `$env:Path + ';$globalPrefix', 'User')"
  exit 1
}
