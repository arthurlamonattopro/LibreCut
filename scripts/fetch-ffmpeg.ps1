<#
.SYNOPSIS
    Downloads and unpacks FFmpeg/ffprobe for LibreCut release builds.

.DESCRIPTION
    Fetches a Windows x64 FFmpeg build, extracts ffmpeg.exe and ffprobe.exe into
    src-tauri/binaries, and renames them to Tauri's sidecar target-triple naming
    (ffmpeg-x86_64-pc-windows-msvc.exe). Review the FFmpeg license before you
    redistribute a bundled build.

.PARAMETER Version
    FFmpeg release tag to fetch. Defaults to a known GPL build.

.PARAMETER Force
    Re-download even if the binaries already exist.

.EXAMPLE
    ./scripts/fetch-ffmpeg.ps1 -Version 9.0.1

.NOTES
    This script is for development/release packaging. The app also works with
    ffmpeg/ffprobe on PATH via LIBRECUT_FFMPEG and LIBRECUT_FFPROBE.
#>

[CmdletBinding()]
param(
    [string]$Version = "9.0.1",
    [switch]$Force
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$dest = Join-Path $root "src-tauri/binaries"
$triple = "x86_64-pc-windows-msvc"
$ffmpegName = "ffmpeg-$triple.exe"
$ffprobeName = "ffprobe-$triple.exe"

New-Item -ItemType Directory -Force -Path $dest | Out-Null

if (-not $Force -and (Test-Path (Join-Path $dest $ffmpegName)) -and (Test-Path (Join-Path $dest $ffprobeName))) {
    Write-Host "FFmpeg sidecars already exist in $dest" -ForegroundColor Green
    exit 0
}

# gyan.dev provides full GPL builds for Windows. Verify the release name before
# bumping the default version.
$archiveName = "ffmpeg-$Version-full_build.zip"
$url = "https://www.gyan.dev/ffmpeg/builds/$archiveName"
$temp = Join-Path ([System.IO.Path]::GetTempPath()) "librecut-ffmpeg-$([guid]::NewGuid().ToString('n'))"

Write-Host "Downloading $url" -ForegroundColor Cyan
New-Item -ItemType Directory -Force -Path $temp | Out-Null
$zip = Join-Path $temp $archiveName

try {
    Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing
} catch {
    Write-Error "Download failed: $($_.Exception.Message). Check the version and network access, or place ffmpeg/ffprobe on PATH instead."
    exit 1
}

Write-Host "Extracting" -ForegroundColor Cyan
Expand-Archive -Path $zip -DestinationPath $temp -Force

$binRoot = Get-ChildItem -Path $temp -Directory -Filter "ffmpeg-*" | Select-Object -First 1
if (-not $binRoot) {
    Write-Error "Could not find the extracted FFmpeg directory."
    exit 1
}

$binDir = Join-Path $binRoot.FullName "bin"
$ffmpeg = Join-Path $binDir "ffmpeg.exe"
$ffprobe = Join-Path $binDir "ffprobe.exe"

if (-not (Test-Path $ffmpeg) -or -not (Test-Path $ffprobe)) {
    Write-Error "The archive did not contain ffmpeg.exe and ffprobe.exe."
    exit 1
}

Copy-Item $ffmpeg (Join-Path $dest $ffmpegName) -Force
Copy-Item $ffprobe (Join-Path $dest $ffprobeName) -Force

Write-Host "Installed sidecars:" -ForegroundColor Green
Get-ChildItem $dest | Select-Object Name, Length | Format-Table -AutoSize

Write-Host ""
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "  1. Add the sidecars to src-tauri/tauri.conf.json under bundle.externalBin."
Write-Host "  2. Update THIRD_PARTY_LICENSES.md and ship FFmpeg's license + source offer."
Write-Host "  3. Build with: pnpm tauri build"

Remove-Item -Recurse -Force $temp -ErrorAction SilentlyContinue
