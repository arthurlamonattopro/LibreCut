# Privacy

LibreCut is local-first by design. This document describes exactly what the app
does with your data.

## Summary

- No account, sign-in, or cloud service.
- No telemetry, analytics, crash reporting, or advertising identifiers.
- No update checks unless you enable them in Settings.
- Media and project files are processed on your PC only.

## What is stored locally

| Data | Location | Purpose |
| --- | --- | --- |
| Project index and autosave | WebView local storage (`librecut:projects:v1`, `librecut:project:<id>:v1`) | Reopen projects after restart |
| First-run guide flag | WebView local storage (`librecut:first-run:v1`) | Avoid showing onboarding on every launch |
| Update preference | WebView local storage (`librecut.autoUpdate.v1`) | Remember whether opt-in update checks are enabled |
| Saved project copies | The path you choose (`.librecut`) | Portable backups |
| Project backups | `<name>.librecut.bak` next to the saved copy | Crash-safe overwrite |
| Thumbnails | `%LOCALAPPDATA%\<app identifier>\thumbs` | Timeline and library previews |
| Preview proxies | `%LOCALAPPDATA%\<app identifier>\proxies` | Smooth scrubbing for 4K/non-web codecs |
| Export filter scripts | `%LOCALAPPDATA%\<app identifier>\exports` | Temporary FFmpeg graph files, deleted after export |

You can delete autosaved projects from the Settings dialog or by removing the
app's local data directory.

## Media handling

- Imported media is read from its original path. LibreCut does not move or
  modify your source files.
- FFmpeg/ffprobe are executed as local processes to probe metadata, generate
  thumbnails and waveforms, create proxies, and render exports.
- The custom `librecut://` protocol serves media to the app's own WebView only.
  It is not exposed to the network.

## Updates

Update checks are off by default. When enabled, LibreCut requests the stable
release manifest from this project's GitHub Releases endpoint:
`https://github.com/arthurlamonattopro/LibreCut/releases/latest/download/latest.json`.
The request includes the current app version, operating system, and CPU
architecture so GitHub can return the matching release. It does not include
project names, media paths, media, or account identifiers. Manual update checks
are available in Settings even when automatic checks are off. Disable the
**Check automatically** setting to stop automatic requests and clear the saved
opt-in. Release notes are shown before an update is downloaded. The installer
package's signature is verified locally before installation.

## Children and sensitive data

LibreCut does not collect personal information from anyone, including children.
Because nothing is transmitted, no special handling of sensitive media is
required beyond normal device security.

## Contact

Open an issue in the project repository for privacy questions.
