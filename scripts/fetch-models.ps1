<#
.SYNOPSIS
    Downloads Hugging Face model repositories for LibreCut's offline AI tools.

.DESCRIPTION
    Fetches every file in the selected model repositories and stores them in the
    folder LibreCut reads at startup:

        %APPDATA%\app.librecut.desktop\models\<organization>\<model>\...

    Transformers.js can then load the local copy without contacting Hugging
    Face. Existing files are skipped unless -Force is supplied, so rerunning the
    script resumes an interrupted download. The default set covers the
    recommended transcription, speech, and background-removal models in
    English, Spanish, Portuguese, and French.

.PARAMETER Models
    Hugging Face repository IDs to download. Defaults to LibreCut's recommended
    set. Any repository that works with Transformers.js can be added.

.PARAMETER Destination
    Models folder. Defaults to the folder LibreCut uses on Windows.

.PARAMETER Force
    Re-download files that already exist.

.EXAMPLE
    pnpm fetch:models

.EXAMPLE
    ./scripts/fetch-models.ps1 -Models Xenova/whisper-base

.NOTES
    Model repositories can be several gigabytes. Check each model's license on
    Hugging Face before redistributing the files.
#>

[CmdletBinding()]
param(
    [string[]]$Models = @(
        "Xenova/whisper-small",
        "Xenova/mms-tts-eng",
        "Xenova/mms-tts-spa",
        "Xenova/mms-tts-por",
        "Xenova/mms-tts-fra",
        "Xenova/modnet"
    ),
    [string]$Destination = (Join-Path $env:APPDATA "app.librecut.desktop\models"),
    [switch]$Force
)

$ErrorActionPreference = "Stop"

function Save-Download {
    param([string]$Url, [string]$Path)
    $directory = Split-Path -Parent $Path
    New-Item -ItemType Directory -Force -Path $directory | Out-Null
    $curl = Get-Command curl.exe -ErrorAction SilentlyContinue
    if ($curl) {
        # curl writes progress to stderr. Windows PowerShell 5.1 treats native
        # stderr as errors, so relax the preference for the call.
        $previous = $ErrorActionPreference
        $ErrorActionPreference = "Continue"
        try {
            & $curl.Source --silent --show-error --location --fail --retry 3 --retry-delay 2 --continue-at - --output $Path $Url
            $exitCode = $LASTEXITCODE
        } finally {
            $ErrorActionPreference = $previous
        }
        if ($exitCode -ne 0) {
            throw "curl exited with code $exitCode"
        }
    } else {
        Invoke-WebRequest -Uri $Url -OutFile $Path -UseBasicParsing
    }
}

New-Item -ItemType Directory -Force -Path $Destination | Out-Null

$failures = [System.Collections.Generic.List[string]]::new()
$fileCount = 0

foreach ($model in $Models) {
    $model = $model.Trim().TrimEnd("/")
    if (-not $model) { continue }

    Write-Host "Reading file list for $model" -ForegroundColor Cyan
    try {
        $info = Invoke-RestMethod `
            -Uri "https://huggingface.co/api/models/$model" `
            -Headers @{ "User-Agent" = "LibreCut" } `
            -TimeoutSec 60
    } catch {
        Write-Host "Could not read $model : $($_.Exception.Message)" -ForegroundColor Yellow
        $failures.Add($model)
        continue
    }

    $files = @($info.siblings | ForEach-Object { $_.rfilename } | Where-Object {
        $_ -and $_ -ne ".gitattributes" -and $_.ToLowerInvariant() -notmatch '\.(md|png|jpg|jpeg|gif|svg)$'
    })
    if (-not $files.Count) {
        Write-Host "No downloadable files found for $model" -ForegroundColor Yellow
        $failures.Add($model)
        continue
    }

    foreach ($file in $files) {
        $target = Join-Path (Join-Path $Destination ($model -replace '/', '\')) ($file -replace '/', '\')
        if (-not $Force -and (Test-Path $target)) {
            continue
        }
        $url = "https://huggingface.co/$model/resolve/main/$file"
        Write-Host "  $model/$file" -ForegroundColor DarkGray
        try {
            Save-Download -Url $url -Path $target
            $fileCount++
        } catch {
            Write-Host "  Failed: $($_.Exception.Message)" -ForegroundColor Yellow
            $failures.Add("$model/$file")
        }
    }
}

Write-Host ""
if ($failures.Count) {
    Write-Host "Finished with $($failures.Count) failure(s):" -ForegroundColor Yellow
    $failures | ForEach-Object { Write-Host "  $_" }
    Write-Host "Rerun the script to resume; completed files are skipped."
    exit 1
}

Write-Host "Downloaded $fileCount file(s) into $Destination" -ForegroundColor Green
Write-Host "Enable strict offline mode in AI tools to verify that local models load without network access."
exit 0
