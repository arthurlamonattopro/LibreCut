# Release builds

LibreCut ships Windows installers with FFmpeg and ffprobe as Tauri sidecars.
This document covers the build and verification flow.

## Prerequisites

- Windows 10/11 with the MSVC toolchain and Windows SDK
- Node.js 22+ and pnpm 10+
- Rust 1.77+
- 7-Zip (only needed for the `full` FFmpeg variant or installer inspection)

## One command

```powershell
pnpm build:release
```

`scripts/build-release.ps1`:

1. runs `scripts/fetch-ffmpeg.ps1` to download a verified FFmpeg build into
   `src-tauri/binaries/`
2. installs frontend dependencies and runs `pnpm tauri build`
3. runs `scripts/verify-installer.ps1` against the NSIS and MSI artifacts

To perform a silent install into a temporary directory as part of verification:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/build-release.ps1 -InstallTest
```

## FFmpeg sidecars

Tauri expects binaries named with the target triple:

```
src-tauri/binaries/ffmpeg-x86_64-pc-windows-msvc.exe
src-tauri/binaries/ffprobe-x86_64-pc-windows-msvc.exe
```

They are listed in `src-tauri/tauri.conf.json` under `bundle.externalBin` and
are installed next to `LibreCut.exe`. At runtime LibreCut resolves tools in this
order:

1. `LIBRECUT_FFMPEG` / `LIBRECUT_FFPROBE` environment overrides
2. the sidecar next to the executable (with or without the target triple)
3. `ffmpeg` / `ffprobe` on `PATH`

The first-run guide and Settings both show the resolved runtime and version.

## Verifying installer output

```powershell
pnpm verify:installer
```

The script checks:

- both sidecars are staged in `src-tauri/target/release/`
- NSIS and MSI artifacts exist
- 7-Zip listings contain `ffmpeg` and `ffprobe` (MSI resources live in
  `app.cab`, so their legal files are checked after extraction)
- with `-InstallTest`, a silent NSIS install and an MSI administrative install
  produce `LibreCut.exe`, both sidecars, and the license, privacy, third-party,
  and FFmpeg GPL files

## Licensing

The fetched build enables GPL components (including libx264). `fetch-ffmpeg.ps1`
verifies the archive SHA-256 and records the exact version and download details
in `FFMPEG-BUILD-INFO.txt`. It prefers the matching GitHub release asset for
speed and falls back to gyan.dev if the mirror is unavailable or does not match
the published checksum. Keep these files with any redistributed installer:

- `THIRD_PARTY_LICENSES.md`
- `PRIVACY.md`
- `LICENSE`
- `src-tauri/legal/FFMPEG-GPLv3.txt`
- `src-tauri/legal/FFMPEG-SOURCE-OFFER.md`
- the generated `src-tauri/legal/FFMPEG-BUILD-INFO.txt`

Provide the corresponding FFmpeg source for at least three years as required by
GPLv3 section 6. See <https://ffmpeg.org/legal.html>.
