<#
.SYNOPSIS
    Verifies that LibreCut installer output contains FFmpeg sidecars and legal files.

.DESCRIPTION
    Checks the staged release binary directory, the NSIS/MSI artifacts, and
    optionally performs a silent install into a temporary directory. Exits with
    a non-zero code if any required file is missing.

.PARAMETER BundleDir
    The Tauri bundle directory. Defaults to src-tauri/target/release/bundle.

.PARAMETER InstallTest
    Silently install the NSIS package into a temporary directory and inspect the
    installed files. This is the strongest check and is safe on disposable CI
    runners.

.PARAMETER KeepTemp
    Keep the temporary install directory for inspection.

.EXAMPLE
    ./scripts/verify-installer.ps1

.EXAMPLE
    ./scripts/verify-installer.ps1 -InstallTest
#>

[CmdletBinding()]
param(
    [string]$BundleDir,
    [switch]$InstallTest,
    [switch]$KeepTemp
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
if (-not $BundleDir) {
    $BundleDir = Join-Path $root "src-tauri/target/release/bundle"
}

$triple = "x86_64-pc-windows-msvc"
$failures = [System.Collections.Generic.List[string]]::new()

function Check {
    param([bool]$Ok, [string]$Message)
    if ($Ok) {
        Write-Host "PASS  $Message" -ForegroundColor Green
    } else {
        Write-Host "FAIL  $Message" -ForegroundColor Red
        $script:failures.Add($Message)
    }
}

function Find-SevenZip {
    $candidates = @(
        (Get-Command 7z -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -ErrorAction SilentlyContinue),
        "$env:USERPROFILE\scoop\apps\7zip\current\7z.exe",
        "$env:ProgramFiles\7-Zip\7z.exe",
        "${env:ProgramFiles(x86)}\7-Zip\7z.exe"
    )
    return $candidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
}

Write-Host "LibreCut installer verification" -ForegroundColor Cyan
Write-Host "Bundle directory: $BundleDir"

# 1. The release build must have staged both sidecars next to the app.
$releaseDir = Join-Path $root "src-tauri/target/release"
$staged = @(Get-ChildItem -Path $releaseDir -File -ErrorAction SilentlyContinue | Where-Object {
    $_.Name -match '^ffmpeg(-x86_64-pc-windows-msvc)?\.exe$' -or
    $_.Name -match '^ffprobe(-x86_64-pc-windows-msvc)?\.exe$'
})
Check (@($staged | Where-Object { $_.Name -match '^ffmpeg' }).Count -gt 0) "ffmpeg is staged next to the app"
Check (@($staged | Where-Object { $_.Name -match '^ffprobe' }).Count -gt 0) "ffprobe is staged next to the app"

# 2. Both installer formats should exist.
$nsis = @(Get-ChildItem -Path (Join-Path $BundleDir "nsis") -Filter "*.exe" -File -ErrorAction SilentlyContinue)
$msi = @(Get-ChildItem -Path (Join-Path $BundleDir "msi") -Filter "*.msi" -File -ErrorAction SilentlyContinue)
Check ($nsis.Count -gt 0) "NSIS installer artifact exists"
Check ($msi.Count -gt 0) "MSI installer artifact exists"

if ($nsis.Count -gt 0) {
    Write-Host "NSIS: $($nsis[0].FullName)"
}
if ($msi.Count -gt 0) {
    Write-Host "MSI:  $($msi[0].FullName)"
}

# 3. Inspect the archives with 7-Zip when available.
$sevenZip = Find-SevenZip
Check ($sevenZip -or $InstallTest) "Installer contents can be inspected (7-Zip or -InstallTest)"
if ($sevenZip) {
    foreach ($installer in $nsis) {
        $listing = (& $sevenZip l -slt $installer.FullName 2>&1) -join "`n"
        Check ($listing -match '(?im)^Path = .*ffmpeg[^\\/]*\.exe') "NSIS contains an ffmpeg sidecar"
        Check ($listing -match '(?im)^Path = .*ffprobe[^\\/]*\.exe') "NSIS contains an ffprobe sidecar"
        Check ($listing -match '(?im)^Path = .*THIRD_PARTY_LICENSES\.md') "NSIS contains third-party notices"
        Check ($listing -match '(?im)^Path = .*PRIVACY\.md') "NSIS contains the privacy notice"
    }
    foreach ($installer in $msi) {
        $listing = (& $sevenZip l -slt $installer.FullName 2>&1) -join "`n"
        Check ($listing -match '(?im)^Path = .*ffmpeg[^\\/]*\.exe') "MSI contains an ffmpeg sidecar"
        Check ($listing -match '(?im)^Path = .*ffprobe[^\\/]*\.exe') "MSI contains an ffprobe sidecar"
        # MSI stores resources in app.cab under generated names, so legal files
        # are verified by the administrative install below instead.
    }
}

# 4. Optional end-to-end install check.
if ($InstallTest -and $nsis.Count -gt 0) {
    $target = Join-Path ([System.IO.Path]::GetTempPath()) "librecut-install-$([guid]::NewGuid().ToString('n'))"
    New-Item -ItemType Directory -Force -Path $target | Out-Null
    Write-Host "Installing NSIS package into $target" -ForegroundColor Cyan
    try {
        $install = Start-Process -FilePath $nsis[0].FullName -ArgumentList @("/S", "/D=$target") -Wait -PassThru
        Check ($install.ExitCode -eq 0) "NSIS silent install completed"

        $installed = @(Get-ChildItem -Path $target -Recurse -File -ErrorAction SilentlyContinue)
        Check (@($installed | Where-Object { $_.Name -eq "LibreCut.exe" }).Count -gt 0) "Installed LibreCut.exe is present"
        Check (@($installed | Where-Object { $_.Name -match '^ffmpeg[^\\/]*\.exe$' }).Count -gt 0) "Installed ffmpeg sidecar is present"
        Check (@($installed | Where-Object { $_.Name -match '^ffprobe[^\\/]*\.exe$' }).Count -gt 0) "Installed ffprobe sidecar is present"
        Check (@($installed | Where-Object { $_.Name -eq "THIRD_PARTY_LICENSES.md" }).Count -gt 0) "Installed third-party notices are present"
        Check (@($installed | Where-Object { $_.Name -eq "LICENSE" }).Count -gt 0) "Installed LibreCut license is present"
        Check (@($installed | Where-Object { $_.Name -eq "PRIVACY.md" }).Count -gt 0) "Installed privacy notice is present"
        Check (@($installed | Where-Object { $_.Name -eq "FFMPEG-GPLv3.txt" }).Count -gt 0) "Installed FFmpeg GPL text is present"

        $uninstaller = @($installed | Where-Object { $_.Name -match '^uninstall.*\.exe$' } | Select-Object -First 1)
        if ($uninstaller.Count -gt 0) {
            Start-Process -FilePath $uninstaller[0].FullName -ArgumentList "/S" -Wait | Out-Null
        }
    } finally {
        if (-not $KeepTemp) {
            Remove-Item -Recurse -Force $target -ErrorAction SilentlyContinue
        }
    }
}

# 5. MSI administrative install check.
if ($InstallTest -and $msi.Count -gt 0) {
    $target = Join-Path ([System.IO.Path]::GetTempPath()) "librecut-msi-$([guid]::NewGuid().ToString('n'))"
    New-Item -ItemType Directory -Force -Path $target | Out-Null
    Write-Host "Extracting MSI into $target" -ForegroundColor Cyan
    try {
        $install = Start-Process -FilePath "msiexec.exe" -ArgumentList @(
            "/a", "`"$($msi[0].FullName)`"", "/qn", "TARGETDIR=`"$target`""
        ) -Wait -PassThru
        Check ($install.ExitCode -eq 0) "MSI administrative install completed"

        $installed = @(Get-ChildItem -Path $target -Recurse -File -ErrorAction SilentlyContinue)
        Check (@($installed | Where-Object { $_.Name -eq "LibreCut.exe" }).Count -gt 0) "MSI contains LibreCut.exe"
        Check (@($installed | Where-Object { $_.Name -match '^ffmpeg[^\\/]*\.exe$' }).Count -gt 0) "MSI contains ffmpeg"
        Check (@($installed | Where-Object { $_.Name -match '^ffprobe[^\\/]*\.exe$' }).Count -gt 0) "MSI contains ffprobe"
        Check (@($installed | Where-Object { $_.Name -eq "THIRD_PARTY_LICENSES.md" }).Count -gt 0) "MSI contains third-party notices"
        Check (@($installed | Where-Object { $_.Name -eq "LICENSE" }).Count -gt 0) "MSI contains the LibreCut license"
        Check (@($installed | Where-Object { $_.Name -eq "PRIVACY.md" }).Count -gt 0) "MSI contains the privacy notice"
        Check (@($installed | Where-Object { $_.Name -eq "FFMPEG-GPLv3.txt" }).Count -gt 0) "MSI contains the FFmpeg GPL text"
    } finally {
        if (-not $KeepTemp) {
            Remove-Item -Recurse -Force $target -ErrorAction SilentlyContinue
        }
    }
}

Write-Host ""
if ($failures.Count -gt 0) {
    Write-Host "$($failures.Count) installer check(s) failed." -ForegroundColor Red
    exit 1
}

Write-Host "All installer checks passed." -ForegroundColor Green
