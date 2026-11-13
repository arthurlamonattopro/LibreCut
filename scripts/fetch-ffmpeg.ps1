<#
.SYNOPSIS
    Downloads and unpacks the FFmpeg/ffprobe build that LibreCut releases bundle.

.DESCRIPTION
    Fetches a Windows x64 FFmpeg build, verifies its SHA-256 checksum against a
    pinned value, extracts ffmpeg.exe and ffprobe.exe into src-tauri/binaries, and
    renames them to Tauri's sidecar target-triple naming. It also copies the
    build license and README into src-tauri/legal so installers can ship them.

    The build is pinned, version and checksum together. A bundled binary that
    changes underneath a release is not reproducible, and here the version
    matters for more than the checksum: FFmpeg 9.0.2 reverted "fftools/
    ffmpeg_sched: allow throttling decoder outputs", which brought back a
    scheduler deadlock. The export filter graph of a timeline that contains a
    transition never finishes on 9.0.2 - FFmpeg spins at full CPU and writes
    nothing - while 9.0.1 renders the same graph in about a second. LibreCut
    therefore bundles 9.0.1 until a newer build is verified against the export
    graph.

.PARAMETER Variant
    "essentials" (default) or "full". The essentials build carries every
    filter and codec LibreCut uses and renders the same output, in about half
    the size. The full build adds the encoders and filters LibreCut does not
    use - VVC, JPEG XL, Blu-ray and SFTP sources, the whisper filter - and
    costs about 230 MB more in the installer.

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

# The FFmpeg version that ships with LibreCut. The archives are zip files, so
# no extra unpacker is needed on a developer machine or on a CI runner.
$ffmpegVersion = "9.0.1"

# The builds LibreCut is allowed to bundle, with the checksum of the archive
# they came from. Add an entry here only after the build has been verified
# against the export filter graph; see src-tauri/tests/export_regression.rs.
$bundles = @{
    "9.0.1/full" = @{
        archive = "ffmpeg-9.0.1-full_build.zip"
        sha256  = "2e8e28af97c2ae338ccef92e36da9b2a4cd21d0cad9dde093545606cb07f5b00"
    }
    "9.0.1/essentials" = @{
        archive = "ffmpeg-9.0.1-essentials_build.zip"
        sha256  = "fec81ae03971d9dd4be3ebe02e263bd2ec1d789483f931bdba5f5715e65da2e9"
    }
}

$key = "$ffmpegVersion/$Variant"
if (-not $bundles.ContainsKey($key)) {
    Write-Error "No pinned FFmpeg build for $key. Add one to the bundle table in $PSCommandPath after verifying it against the export graph."
    exit 1
}
$bundle = $bundles[$key]
$archiveName = $bundle.archive
$expected = $bundle.sha256
$baseUrl = "https://github.com/GyanD/codexffmpeg/releases/download/$ffmpegVersion/$archiveName"

function Find-SevenZip {
    # The known install locations come first. `Get-Command 7z` alone is not
    # enough: unrelated programs ship a file called `7z.exe`, and pointing the
    # extraction at one of those fails with a confusing error.
    $candidates = @(
        "$env:ProgramFiles\7-Zip\7z.exe",
        "${env:ProgramFiles(x86)}\7-Zip\7z.exe",
        "$env:LOCALAPPDATA\Programs\7-Zip\7z.exe",
        "$env:USERPROFILE\scoop\apps\7zip\current\7z.exe"
    )
    foreach ($candidate in $candidates) {
        if (Test-Path $candidate) {
            return $candidate
        }
    }
    $command = Get-Command 7z.exe, 7z -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($command) {
        return $command.Source
    }
    return $null
}

function Save-Download {
    param([string]$Url, [string]$Destination)
    $curl = Get-Command curl.exe -ErrorAction SilentlyContinue
    if ($curl) {
        # curl.exe ships with Windows 10 1803+ and is much faster than
        # Invoke-WebRequest. It also resumes interrupted downloads, which
        # matters for the ~250 MB full archive.
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

$buildInfo = Join-Path $legal "FFMPEG-BUILD-INFO.txt"

# The archive that produced the installed sidecars is recorded in the build
# info, so a checkout that still holds another build is refreshed instead of
# silently keeping it.
$installedArchive = ""
if (Test-Path $buildInfo) {
    $archiveLine = Get-Content $buildInfo | Where-Object { $_ -like "Archive: *" } | Select-Object -First 1
    if ($archiveLine) {
        $installedArchive = $archiveLine.Substring("Archive: ".Length).Trim()
    }
}

$sidecarsPresent =
    (Test-Path (Join-Path $dest $ffmpegName)) -and
    (Test-Path (Join-Path $dest $ffprobeName)) -and
    (Test-Path $buildInfo) -and
    (Test-Path (Join-Path $legal "FFMPEG-BUILD-LICENSE.txt"))

if (-not $Force -and $sidecarsPresent -and $installedArchive -eq $archiveName) {
    Write-Host "FFmpeg sidecars already exist in $dest" -ForegroundColor Green
    exit 0
}
if (-not $Force -and $sidecarsPresent -and $installedArchive -ne $archiveName) {
    Write-Host "Replacing the $installedArchive build with $archiveName." -ForegroundColor Yellow
}

# Keep a stable cache path so an interrupted download can resume on the next run.
$temp = Join-Path ([System.IO.Path]::GetTempPath()) "librecut-ffmpeg-$key"
$archive = Join-Path $temp $archiveName
New-Item -ItemType Directory -Force -Path $temp | Out-Null

if ($Force -and (Test-Path $archive)) {
    Remove-Item $archive -Force
}

$actual = if (Test-Path $archive) {
    (Get-FileHash -Algorithm SHA256 -Path $archive).Hash.ToLowerInvariant()
} else {
    ""
}

if ($actual -ne $expected) {
    Write-Host "Downloading $baseUrl" -ForegroundColor Cyan
    $downloaded = $false
    try {
        Save-Download -Url $baseUrl -Destination $archive
        $downloaded = $true
    } catch {
        # A partial or stale archive can make a resume fail. Retry once from
        # scratch before giving up.
        Write-Host "Download interrupted: $($_.Exception.Message). Retrying from scratch." -ForegroundColor Yellow
        if (Test-Path $archive) {
            Remove-Item $archive -Force
        }
        try {
            Save-Download -Url $baseUrl -Destination $archive
            $downloaded = $true
        } catch {
            Write-Host "Download failed." -ForegroundColor Yellow
        }
    }
    if ($downloaded) {
        $actual = (Get-FileHash -Algorithm SHA256 -Path $archive).Hash.ToLowerInvariant()
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
    $sevenZip = Find-SevenZip
    if (-not $sevenZip) {
        Write-Error "7-Zip is required to extract $archiveName. Install 7-Zip (https://www.7-zip.org)."
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
$header = @(
    "LibreCut bundled FFmpeg build",
    "Version: $ffmpegVersion ($Variant)",
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
