# Privacy

LibreCut is local-first by design. This document describes exactly what the app
does with your data.

## Summary

- No account, sign-in, or cloud service.
- No telemetry, analytics, crash reporting, or advertising identifiers.
- No network requests at runtime.
- Media and project files are processed on your PC only.

## What is stored locally

| Data | Location | Purpose |
| --- | --- | --- |
| Project index and autosave | WebView local storage (`librecut:projects:v1`, `librecut:project:<id>:v1`) | Reopen projects after restart |
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

v0.1 has no auto-updater and makes no update checks. A future release may add
an opt-in updater; if it does, this document will describe the endpoints and
data involved before it ships.

## Children and sensitive data

LibreCut does not collect personal information from anyone, including children.
Because nothing is transmitted, no special handling of sensitive media is
required beyond normal device security.

## Contact

Open an issue in the project repository for privacy questions.
