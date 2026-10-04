# Seal Forge Windows installer.
# Run from an extracted repo folder: powershell -ExecutionPolicy Bypass -File installer\install.ps1
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $root

function Need($name) {
  if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
    Write-Error "$name is not on PATH. Install Node.js 22 LTS from https://nodejs.org and reopen PowerShell."
  }
}
Need node
Need npm

$ver = (node -p "process.versions.node")
$major = [int]($ver.Split(".")[0])
if ($major -lt 22) { Write-Error "Node $ver is too old. Seal Forge needs Node 22 or newer." }

Write-Host "Installing Seal Forge files..."
npm install
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$desktop = [Environment]::GetFolderPath("Desktop")
$launcher = Join-Path $root "installer\SealForge.cmd"
$shortcut = Join-Path $desktop "Seal Forge.lnk"
$shell = New-Object -ComObject WScript.Shell
$link = $shell.CreateShortcut($shortcut)
$link.TargetPath = $launcher
$link.WorkingDirectory = $root
$link.WindowStyle = 1
$link.Description = "Seal Forge"
$link.Save()

Write-Host "Installed. Desktop shortcut: $shortcut"
Write-Host "Starting the table at http://127.0.0.1:8080"
& $launcher
