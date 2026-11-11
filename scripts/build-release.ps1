<#
.SYNOPSIS
    Builds the LibreCut Windows installers and verifies their contents.

.DESCRIPTION
    Fetches the FFmpeg sidecars, builds the frontend and Tauri bundles, then runs
    the installer verification script. Use -InstallTest to perform a silent
    install into a temporary directory as part of verification.

.EXAMPLE
    ./scripts/build-release.ps1

.EXAMPLE
    ./scripts/build-release.ps1 -InstallTest
#>

[CmdletBinding()]
param(
    [switch]$SkipFetch,
    [switch]$SkipVerify,
    [switch]$InstallTest
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

function Resolve-Command {
    param([string]$Name, [string[]]$Fallbacks)
    $command = Get-Command $Name -ErrorAction SilentlyContinue
    if ($command) {
        return $command.Source
    }
    foreach ($candidate in $Fallbacks) {
        if ($candidate -and (Test-Path $candidate)) {
            return $candidate
        }
    }
    throw "Could not find '$Name'. Install it and add it to PATH, then retry."
}

$pnpm = Resolve-Command "pnpm" @(
    "$env:USERPROFILE\scoop\shims\pnpm.exe",
    "$env:LOCALAPPDATA\pnpm\pnpm.exe"
)
$cargo = Resolve-Command "cargo" @("$env:USERPROFILE\.cargo\bin\cargo.exe")
$node = Resolve-Command "node" @(
    "$env:USERPROFILE\scoop\apps\nodejs\current\node.exe",
    "$env:ProgramFiles\nodejs\node.exe"
)

# Make child processes see the same toolchain.
$toolPaths = @(
    (Split-Path -Parent $pnpm),
    (Split-Path -Parent $cargo),
    (Split-Path -Parent $node)
) | Where-Object { $_ -and (Test-Path $_) }
$env:PATH = ($toolPaths -join ";") + ";" + $env:PATH

if (-not $SkipFetch) {
    & (Join-Path $PSScriptRoot "fetch-ffmpeg.ps1")
    if ($LASTEXITCODE -ne 0) {
        throw "FFmpeg fetch failed."
    }
}

Push-Location $root
try {
    Write-Host "Installing frontend dependencies" -ForegroundColor Cyan
    & $pnpm install --frozen-lockfile
    if ($LASTEXITCODE -ne 0) {
        throw "pnpm install failed."
    }

    Write-Host "Building LibreCut installers" -ForegroundColor Cyan
    & $pnpm tauri build
    if ($LASTEXITCODE -ne 0) {
        throw "Tauri build failed."
    }
} finally {
    Pop-Location
}

if (-not $SkipVerify) {
    $verify = Join-Path $PSScriptRoot "verify-installer.ps1"
    if ($InstallTest) {
        & $verify -InstallTest
    } else {
        & $verify
    }
    if ($LASTEXITCODE -ne 0) {
        throw "Installer verification failed."
    }
}

Write-Host "Release build complete." -ForegroundColor Green
