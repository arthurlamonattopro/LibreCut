<#
.SYNOPSIS
    Generates the NSIS header and sidebar bitmaps from the LibreCut palette.

.DESCRIPTION
    Produces src-tauri/icons/installer-header.bmp (150x57) and
    src-tauri/icons/installer-sidebar.bmp (164x314). Run this after changing the
    brand palette or wordmark, then rebuild the installer.
#>

[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$outDir = Join-Path $root "src-tauri/icons"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

$bg = [System.Drawing.ColorTranslator]::FromHtml("#101114")
$panel = [System.Drawing.ColorTranslator]::FromHtml("#22252b")
$ink = [System.Drawing.ColorTranslator]::FromHtml("#f5f6f7")
$muted = [System.Drawing.ColorTranslator]::FromHtml("#a5a9b1")
$dim = [System.Drawing.ColorTranslator]::FromHtml("#797f89")
$accent = [System.Drawing.ColorTranslator]::FromHtml("#36c8d0")
$mint = [System.Drawing.ColorTranslator]::FromHtml("#69d9a2")
$blue = [System.Drawing.ColorTranslator]::FromHtml("#7daeff")

function New-RoundedPath {
    param([float]$X, [float]$Y, [float]$Width, [float]$Height, [float]$Radius)
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $diameter = $Radius * 2
    $path.AddArc($X, $Y, $diameter, $diameter, 180, 90)
    $path.AddArc($X + $Width - $diameter, $Y, $diameter, $diameter, 270, 90)
    $path.AddArc($X + $Width - $diameter, $Y + $Height - $diameter, $diameter, $diameter, 0, 90)
    $path.AddArc($X, $Y + $Height - $diameter, $diameter, $diameter, 90, 90)
    $path.CloseFigure()
    return $path
}

function New-Canvas {
    param([int]$Width, [int]$Height)
    $bitmap = New-Object System.Drawing.Bitmap($Width, $Height, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit
    $graphics.Clear($bg)
    return @($bitmap, $graphics)
}

# Header: 150x57, shown on NSIS installer pages.
$header = New-Canvas 150 57
$bitmap = $header[0]
$graphics = $header[1]
$accentBrush = New-Object System.Drawing.SolidBrush($accent)
$inkBrush = New-Object System.Drawing.SolidBrush($ink)
$mutedBrush = New-Object System.Drawing.SolidBrush($muted)
$titleFont = New-Object System.Drawing.Font("Segoe UI Semibold", 16, [System.Drawing.FontStyle]::Regular)
$subtitleFont = New-Object System.Drawing.Font("Segoe UI", 7.5, [System.Drawing.FontStyle]::Regular)
$graphics.FillRectangle($accentBrush, 0, 0, 4, 57)
$graphics.DrawString("LibreCut", $titleFont, $inkBrush, 14, 7)
$graphics.DrawString("Local-first video editor", $subtitleFont, $mutedBrush, 15, 32)
$graphics.FillRectangle($accentBrush, 14, 47, 28, 2)
$headerPath = Join-Path $outDir "installer-header.bmp"
$bitmap.Save($headerPath, [System.Drawing.Imaging.ImageFormat]::Bmp)

# Sidebar: 164x314, shown on the NSIS welcome and finish pages.
$sidebar = New-Canvas 164 314
$bitmap = $sidebar[0]
$graphics = $sidebar[1]
$accentBrush = New-Object System.Drawing.SolidBrush($accent)
$inkBrush = New-Object System.Drawing.SolidBrush($ink)
$mutedBrush = New-Object System.Drawing.SolidBrush($muted)
$dimBrush = New-Object System.Drawing.SolidBrush($dim)
$mintBrush = New-Object System.Drawing.SolidBrush($mint)
$blueBrush = New-Object System.Drawing.SolidBrush($blue)
$panelBrush = New-Object System.Drawing.SolidBrush($panel)

$graphics.FillRectangle($accentBrush, 0, 0, 164, 4)
$monogram = New-RoundedPath 44 38 76 76 18
$graphics.FillPath($panelBrush, $monogram)
$monogramFont = New-Object System.Drawing.Font("Segoe UI", 34, [System.Drawing.FontStyle]::Bold)
$graphics.DrawString("L", $monogramFont, $accentBrush, 53, 50)
$graphics.DrawString("C", $monogramFont, $inkBrush, 81, 50)

$wordmarkFont = New-Object System.Drawing.Font("Segoe UI Semibold", 15, [System.Drawing.FontStyle]::Regular)
$taglineFont = New-Object System.Drawing.Font("Segoe UI", 8.5, [System.Drawing.FontStyle]::Regular)
$smallFont = New-Object System.Drawing.Font("Segoe UI", 7, [System.Drawing.FontStyle]::Regular)
$graphics.DrawString("LibreCut", $wordmarkFont, $inkBrush, 22, 132)
$graphics.DrawString("Local-first video editor", $taglineFont, $mutedBrush, 23, 158)
$graphics.FillRectangle($accentBrush, 23, 184, 34, 2)

# A restrained three-track timeline mark.
$track = New-RoundedPath 23 210 118 7 3.5
$graphics.FillPath((New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(60, 105, 217, 162))), $track)
$track2 = New-RoundedPath 23 226 88 7 3.5
$graphics.FillPath((New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(60, 125, 174, 255))), $track2)
$track3 = New-RoundedPath 23 242 54 7 3.5
$graphics.FillPath((New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(60, 54, 200, 208))), $track3)

$graphics.DrawString("GPL-3.0  /  Local only", $smallFont, $dimBrush, 22, 282)
$sidebarPath = Join-Path $outDir "installer-sidebar.bmp"
$bitmap.Save($sidebarPath, [System.Drawing.Imaging.ImageFormat]::Bmp)

$graphics.Dispose()
$bitmap.Dispose()
Write-Host "Wrote $headerPath" -ForegroundColor Green
Write-Host "Wrote $sidebarPath" -ForegroundColor Green
