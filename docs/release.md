# Release builds

LibreCut release builds package Windows installers, macOS DMGs, and Linux DEB
and AppImage packages with FFmpeg and ffprobe as Tauri sidecars. This document
covers the build and verification flow.

## macOS and Linux builds

Tagged releases build on native runners: Intel macOS (`macos-15-intel`) produces
an app bundle and DMG; Ubuntu 22.04 x64 produces DEB and AppImage packages. The
Linux runner installs Tauri's WebKitGTK 4.1 and GTK build dependencies. macOS
builds are currently Intel-only; Apple Silicon and other Linux distributions
are not release targets yet.

macOS DMGs are not Developer ID signed or notarized by this workflow. The
packages are suitable for CI review and manual testing, but a signed notarized
release requires the maintainer's Apple signing credentials and a follow-up
Gatekeeper verification pass.

On macOS and Linux, run `bash ./scripts/fetch-ffmpeg-unix.sh` before building. It
stages static FFmpeg and ffprobe binaries under Tauri's target-triple sidecar
names. Linux uses John Van Sickle's GPLv3 static builds; macOS uses the static
x86_64 builds from evermeet.cx. Both platforms use native Tauri dialogs and
platform data/cache directories. On Linux and macOS, media paths preserve case
when checking for duplicate imports.

CI builds the app and native packages on both platforms. The install, launch,
project-editing, and export smoke checks still need to be completed on actual
macOS and Linux systems before marking cross-platform support verified.

## Automatic updates

Automatic update checks are opt-in and off by default. When enabled, LibreCut
requests the stable channel's `latest.json` from this repository's GitHub
Releases. Manual **Check for updates** works even when automatic checks are
off. The app shows the available version and release notes before the user can
start an install. Tauri verifies the downloaded NSIS update against the
embedded Minisign public key before handing it to the installer; interrupted
downloads are discarded and can be retried without replacing the running app.

### Signing setup for maintainers

The matching private signing key must never be committed. The public key is
embedded in `src-tauri/tauri.conf.json`; the release workflow needs the private
key as the repository Actions secret `TAURI_SIGNING_PRIVATE_KEY`. Create an
updater key pair once with `pnpm tauri signer generate -w <private-key-path>`
and add the private key contents to that secret. If the key has a password,
also add `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. The public key in the app config
must match that key pair. Losing the private key prevents signing future
updates for existing installations.

Tagged release builds create a draft GitHub release with signed NSIS updater
artifacts and `latest.json`; publish the draft to make it available to the
stable channel. Prereleases are not offered. MSI users can install releases
manually from GitHub Releases; in-app updates use the NSIS installer format.
To disable checks, leave **Settings → Application updates → Check
automatically** off, or turn it off to remove the saved opt-in. Manual checks
remain available. No update request is made while the opt-in is off.

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
