<#
.SYNOPSIS
    Downloads and unpacks FFmpeg/ffprobe for LibreCut release builds.

.DESCRIPTION
    Fetches a Windows x64 FFmpeg build, verifies the SHA-256 checksum published
    by gyan.dev, extracts ffmpeg.exe and ffprobe.exe into src-tauri/binaries, and
    renames them to Tauri's sidecar target-triple naming. It also copies the
    build license and README into src-tauri/legal so installers can ship them.
    The matching GitHub release asset is used when available for faster,
    resumable downloads; gyan.dev remains the fallback and checksum source.

    The essentials build contains the GPL libx264 encoder and the freetype
    drawtext filter that LibreCut uses. Review the FFmpeg license before you
    redistribute a bundled build.

.PARAMETER Variant
    "essentials" (default) or "full". The full variant is a 7z archive and
    requires 7-Zip.

.PARAMETER Force
    Re-download even if the sidecars already exist.

.EXAMPLE
    ./scripts/fetch-ffmpeg.ps1

.EXAMPLE
    ./scripts/fetch-ffmpeg.ps1 -Variant full -Force

.NOTES
    This script is for development/release packaging. The app also works with
    ffmpeg/ffprobe on PATH via LIBRECUT_FFMPEG and LIBRECUT_FFPROBE.
#>

[CmdletBinding()]
param(
    [ValidateSet("essentials", "full")]
    [string]$Variant = "essentials",
    [switch]$Force
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$dest = Join-Path $root "src-tauri/binaries"
$legal = Join-Path $root "src-tauri/legal"
$triple = "x86_64-pc-windows-msvc"
$ffmpegName = "ffmpeg-$triple.exe"
$ffprobeName = "ffprobe-$triple.exe"

function Get-GitHubMirrorUrl {
    param([string]$Variant)
    $suffix = if ($Variant -eq "full") { "-full_build.7z" } else { "-essentials_build.zip" }
    try {
        $release = Invoke-RestMethod `
            -Uri "https://api.github.com/repos/GyanD/codexffmpeg/releases/latest" `
            -Headers @{ "User-Agent" = "LibreCut" } `
            -TimeoutSec 30
        $asset = $release.assets |
            Where-Object { $_.name.EndsWith($suffix) } |
            Select-Object -First 1
        if ($asset) {
            return $asset.browser_download_url
        }
    } catch {
        # GitHub is a speed optimization; gyan.dev remains the source of truth.
    }
    return $null
}

function Save-Download {
    param([string]$Url, [string]$Destination)
    $curl = Get-Command curl.exe -ErrorAction SilentlyContinue
    if ($curl) {
        # curl.exe ships with Windows 10 1803+ and is much faster than
        # Invoke-WebRequest. It also resumes interrupted downloads, which
        # matters for the ~110 MB essentials archive.
        #
        # curl writes progress to stderr. Windows PowerShell 5.1 turns native
        # stderr into error records, so temporarily relax ErrorActionPreference
        # to keep a redirected log (`2>&1`) from aborting the download.
        $previous = $ErrorActionPreference
        $ErrorActionPreference = "Continue"
        try {
            & $curl.Source --silent --show-error --location --fail --retry 3 --retry-delay 2 --continue-at - --output $Destination $Url
            $exitCode = $LASTEXITCODE
        } finally {
            $ErrorActionPreference = $previous
        }
        if ($exitCode -ne 0) {
            throw "curl exited with code $exitCode"
        }
    } else {
        Invoke-WebRequest -Uri $Url -OutFile $Destination -UseBasicParsing
    }
}

New-Item -ItemType Directory -Force -Path $dest, $legal | Out-Null

if (
    -not $Force -and
    (Test-Path (Join-Path $dest $ffmpegName)) -and
    (Test-Path (Join-Path $dest $ffprobeName)) -and
    (Test-Path (Join-Path $legal "FFMPEG-BUILD-INFO.txt")) -and
    (Test-Path (Join-Path $legal "FFMPEG-BUILD-LICENSE.txt"))
) {
    Write-Host "FFmpeg sidecars already exist in $dest" -ForegroundColor Green
    exit 0
}

$archiveName = if ($Variant -eq "full") { "ffmpeg-release-full.7z" } else { "ffmpeg-release-essentials.zip" }
$baseUrl = "https://www.gyan.dev/ffmpeg/builds/$archiveName"
# Keep a stable cache path so an interrupted download can resume on the next run.
$temp = Join-Path ([System.IO.Path]::GetTempPath()) "librecut-ffmpeg-$Variant"
$archive = Join-Path $temp $archiveName
New-Item -ItemType Directory -Force -Path $temp | Out-Null

if ($Force -and (Test-Path $archive)) {
    Remove-Item $archive -Force
}

try {
    $checksumResponse = Invoke-WebRequest -Uri "${baseUrl}.sha256" -UseBasicParsing
    $checksumContent = $checksumResponse.Content
    if ($checksumContent -is [byte[]]) {
        $expected = [System.Text.Encoding]::UTF8.GetString($checksumContent).Trim()
    } else {
        $expected = $checksumContent.ToString().Trim()
    }
} catch {
    Write-Error "Could not fetch the FFmpeg checksum: $($_.Exception.Message). Check network access, or place ffmpeg/ffprobe on PATH instead."
    exit 1
}
if ($expected -notmatch '^[0-9a-f]{64}$') {
    Write-Error "The checksum endpoint returned an unexpected value: '$expected'."
    exit 1
}

$actual = if (Test-Path $archive) {
    (Get-FileHash -Algorithm SHA256 -Path $archive).Hash.ToLowerInvariant()
} else {
    ""
}

if ($actual -ne $expected) {
    $sources = [System.Collections.Generic.List[string]]::new()
    $mirror = Get-GitHubMirrorUrl -Variant $Variant
    if ($mirror) {
        $sources.Add($mirror)
    }
    $sources.Add($baseUrl)

    foreach ($source in $sources) {
        if ($actual -eq $expected) {
            break
        }
        Write-Host "Downloading $source" -ForegroundColor Cyan
        $downloaded = $false
        try {
            Save-Download -Url $source -Destination $archive
            $downloaded = $true
        } catch {
            # A partial or stale archive can make a resume fail. Retry once
            # from scratch before trying the next source.
            Write-Host "Download interrupted: $($_.Exception.Message). Retrying from scratch." -ForegroundColor Yellow
            if (Test-Path $archive) {
                Remove-Item $archive -Force
            }
            try {
                Save-Download -Url $source -Destination $archive
                $downloaded = $true
            } catch {
                Write-Host "Download failed from $source." -ForegroundColor Yellow
            }
        }
        if (-not $downloaded) {
            continue
        }
        $actual = (Get-FileHash -Algorithm SHA256 -Path $archive).Hash.ToLowerInvariant()
        if ($actual -ne $expected) {
            Write-Host "Checksum mismatch from $source; trying the next source." -ForegroundColor Yellow
            Remove-Item $archive -Force -ErrorAction SilentlyContinue
            $actual = ""
        }
    }
}

if ($actual -ne $expected) {
    Remove-Item $archive -Force -ErrorAction SilentlyContinue
    Write-Error "SHA-256 verification failed for $archiveName. Expected '$expected', got '$actual'."
    exit 1
}
Write-Host "Checksum verified: $actual" -ForegroundColor Green

Write-Host "Extracting" -ForegroundColor Cyan
if ($archiveName.EndsWith(".7z")) {
    $sevenZip = Get-Command 7z -ErrorAction SilentlyContinue
    if (-not $sevenZip) {
        $sevenZip = @(
            "$env:USERPROFILE\scoop\apps\7zip\current\7z.exe",
            "$env:ProgramFiles\7-Zip\7z.exe",
            "${env:ProgramFiles(x86)}\7-Zip\7z.exe"
        ) | Where-Object { Test-Path $_ } | Select-Object -First 1
    }
    if (-not $sevenZip) {
        Write-Error "7-Zip is required to extract $archiveName. Install 7-Zip or use -Variant essentials."
        exit 1
    }
    & $sevenZip x $archive "-o$temp" -y | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Write-Error "7-Zip failed to extract $archiveName."
        exit 1
    }
} else {
    Expand-Archive -Path $archive -DestinationPath $temp -Force
}

$extractRoot = Get-ChildItem -Path $temp -Directory |
    Where-Object { Test-Path (Join-Path $_.FullName "bin/ffmpeg.exe") } |
    Select-Object -First 1
if (-not $extractRoot) {
    Write-Error "Could not find the extracted FFmpeg directory."
    exit 1
}

$binDir = Join-Path $extractRoot.FullName "bin"
$ffmpeg = Join-Path $binDir "ffmpeg.exe"
$ffprobe = Join-Path $binDir "ffprobe.exe"

if (-not (Test-Path $ffmpeg) -or -not (Test-Path $ffprobe)) {
    Write-Error "The archive did not contain ffmpeg.exe and ffprobe.exe."
    exit 1
}

Copy-Item $ffmpeg (Join-Path $dest $ffmpegName) -Force
Copy-Item $ffprobe (Join-Path $dest $ffprobeName) -Force

$license = Join-Path $extractRoot.FullName "LICENSE"
if (Test-Path $license) {
    Copy-Item $license (Join-Path $legal "FFMPEG-BUILD-LICENSE.txt") -Force
}

$readme = Join-Path $extractRoot.FullName "README.txt"
$buildInfo = Join-Path $legal "FFMPEG-BUILD-INFO.txt"
$header = @(
    "LibreCut bundled FFmpeg build",
    "Archive: $archiveName",
    "SHA-256: $actual",
    "Downloaded: $(Get-Date -Format o)",
    "Provider: https://www.gyan.dev/ffmpeg/builds/",
    ""
)
Set-Content -Path $buildInfo -Value $header -Encoding UTF8
if (Test-Path $readme) {
    Get-Content $readme | Add-Content -Path $buildInfo -Encoding UTF8
}

Write-Host "Installed sidecars:" -ForegroundColor Green
Get-ChildItem $dest | Select-Object Name, Length | Format-Table -AutoSize

$versionLines = @(& (Join-Path $dest $ffmpegName) -version 2>&1)
$version = $versionLines | Select-Object -First 1
Write-Host "Runtime: $version" -ForegroundColor Green

Write-Host ""
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "  1. Review THIRD_PARTY_LICENSES.md and src-tauri/legal/."
Write-Host "  2. Build with: pnpm tauri build"
Write-Host "  3. Verify with: ./scripts/verify-installer.ps1"

Remove-Item -Recurse -Force $temp -ErrorAction SilentlyContinue

exit 0
