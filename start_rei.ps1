[CmdletBinding()]
param(
  [switch]$DryRun,
  [switch]$SkipElectronInstall
)

$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$ElectronDir = Join-Path $RepoRoot "rei_control_center_electron"
$ExtensionDir = Join-Path $RepoRoot "extension\extension"

function Write-Step {
  param([string]$Message)
  Write-Host "[REI] $Message" -ForegroundColor Cyan
}

function Quote-PSArg {
  param([string]$Value)
  return "'" + ($Value -replace "'", "''") + "'"
}

function Get-WorkingPython {
  $candidates = @()

  if ($env:REI_PYTHON_EXE) {
    $candidates += $env:REI_PYTHON_EXE
  }

  $candidates += @(
    (Join-Path $env:USERPROFILE "miniconda3\envs\scamshield\python.exe"),
    (Join-Path $env:LOCALAPPDATA "Programs\Python\Python314\python.exe"),
    (Join-Path $env:LOCALAPPDATA "Programs\Python\Python313\python.exe"),
    "python",
    "py"
  )

  foreach ($candidate in ($candidates | Select-Object -Unique)) {
    try {
      $resolved = $null

      if (Test-Path $candidate) {
        $resolved = (Resolve-Path $candidate).Path
        & $resolved -c "import torch, fastapi, transformers, uvicorn" *> $null
      } elseif ($candidate -eq "py") {
        & py -3 -c "import torch, fastapi, transformers, uvicorn" *> $null
        $resolved = "py"
      } else {
        $cmd = Get-Command $candidate -ErrorAction Stop
        $resolved = $cmd.Source
        & $resolved -c "import torch, fastapi, transformers, uvicorn" *> $null
      }

      if ($LASTEXITCODE -eq 0) {
        if ($candidate -eq "py") {
          return @{
            FilePath = "py"
            ArgumentPrefix = @("-3")
            Display = "py -3"
          }
        }

        return @{
          FilePath = $resolved
          ArgumentPrefix = @()
          Display = $resolved
        }
      }
    } catch {
      continue
    }
  }

  throw "Could not find a Python runtime with torch, fastapi, transformers, and uvicorn available. Set REI_PYTHON_EXE to a working python.exe."
}

function Test-ScannerOnline {
  try {
    $response = Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:8000/docs" -TimeoutSec 3
    return $response.StatusCode -eq 200
  } catch {
    return $false
  }
}

function Get-ProcessMatches {
  param([string]$Marker)

  try {
    return @(Get-CimInstance Win32_Process -ErrorAction Stop |
      Where-Object { $_.CommandLine -and $_.CommandLine -like "*$Marker*" })
  } catch {
    return @()
  }
}

function Start-InNewPowerShellWindow {
  param(
    [string]$Title,
    [string]$WorkingDirectory,
    [string]$FilePath,
    [string[]]$Arguments
  )

  $quotedArgs = @($Arguments | ForEach-Object { Quote-PSArg $_ }) -join " "
  $command = @(
    '$host.UI.RawUI.WindowTitle = ' + (Quote-PSArg $Title)
    'Set-Location -LiteralPath ' + (Quote-PSArg $WorkingDirectory)
    '& ' + (Quote-PSArg $FilePath) + ($(if ($quotedArgs) { " $quotedArgs" } else { "" }))
  ) -join "; "

  if ($DryRun) {
    Write-Step "Dry run: would launch [$Title] in $WorkingDirectory"
    return
  }

  Start-Process -FilePath "powershell.exe" -ArgumentList @("-NoExit", "-Command", $command) | Out-Null
}

Write-Step "Resolving Python runtime"
$python = Get-WorkingPython
Write-Step "Using Python: $($python.Display)"

if (-not $SkipElectronInstall) {
  $nodeModulesDir = Join-Path $ElectronDir "node_modules"
  if (-not (Test-Path $nodeModulesDir)) {
    Write-Step "Installing Electron dependencies"
    if (-not $DryRun) {
      Push-Location $ElectronDir
      try {
        npm install
      } finally {
        Pop-Location
      }
    }
  }
}

if (Test-ScannerOnline) {
  Write-Step "Scanner already reachable at http://127.0.0.1:8000/docs"
} else {
  Write-Step "Starting scanner API"
  Start-InNewPowerShellWindow `
    -Title "REI Scanner API" `
    -WorkingDirectory $RepoRoot `
    -FilePath $python.FilePath `
    -Arguments @($python.ArgumentPrefix + @("rei_scanner_api.py"))
}

$monitorMatches = Get-ProcessMatches "file_monitor.py"
if ($monitorMatches.Count -gt 0) {
  Write-Step "File monitor already running"
} else {
  Write-Step "Starting file monitor"
  Start-InNewPowerShellWindow `
    -Title "REI File Monitor" `
    -WorkingDirectory $RepoRoot `
    -FilePath $python.FilePath `
    -Arguments @($python.ArgumentPrefix + @("file_monitor.py"))
}

Write-Step "Starting Electron control center"
Start-InNewPowerShellWindow `
  -Title "REI Control Center" `
  -WorkingDirectory $ElectronDir `
  -FilePath "npm.cmd" `
  -Arguments @("start")

Write-Host ""
Write-Host "Next step: load the Chrome extension from this folder:" -ForegroundColor Yellow
Write-Host "  $ExtensionDir"
Write-Host ""
Write-Host "Chrome steps:" -ForegroundColor Yellow
Write-Host "  1. Open chrome://extensions/"
Write-Host "  2. Enable Developer mode"
Write-Host "  3. Click Load unpacked"
Write-Host "  4. Select the folder above"
Write-Host ""
Write-Host "Optional dry run:" -ForegroundColor Yellow
Write-Host "  .\start_rei.ps1 -DryRun"
