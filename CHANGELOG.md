# Changelog

All notable changes to LibreCut are recorded here. The project follows
[semantic versioning](https://semver.org/).

## Unreleased

### Added

- Multi-select with `Ctrl`-click, `Shift`-click ranges, and rubber-band
  selection, including bulk move, delete, duplicate, and split.
- Track deletion and reordering from the track actions menu, and a footer
  button for every track kind.

### Fixed

- Ripple edits stay on the track they change instead of moving audio and text
  on other tracks.
- The magnetic main track no longer reassigns itself on open or repacks after
  an ordinary move, trim, or delete. Ripple is respected when it is off.
- Clips settle into the nearest free gap instead of overlapping.
- The timeline follows the playhead.
- Undo restores the selection, playhead, zoom, and Snap/Ripple toggles, and
  selecting a clip no longer creates a history step.

## 1.0.0

The first stable release. LibreCut is now a dependable editor for everyday
cuts: import, edit, mix, title, and export, all on your own machine, with no
account, no watermark, and no telemetry.

### Highlights

- **Every transition renders on export.** The FFmpeg runtime is pinned to
  **9.0.1**, because FFmpeg 9.0.2 and later deadlock on the export filter
  graph of a timeline that contains a transition.
- **Beginner tutorials.** Five lessons for import, editing, audio, titles, and
  export, in `docs/tutorials/`.
- **A community preset pack.** Reviewed color filters and text styles, public
  domain under CC0-1.0, installable from the **Plugins** tab.
- **Regression suites.** Project compatibility, editing, and export are checked
  against real media, including rendered output.

### Added

- **Effects, LUTs, and templates** — searchable color filter presets, `.cube`
  LUT import and application, and built-in plus custom project templates.
- **Plugin API 1.0.0** — declarative JSON packs that add effect presets and
  text styles, with permissions, lifecycle handling, and clear failure
  reporting.
- **Auto-update** — opt-in checks against GitHub Releases, with release notes
  shown before installation and recovery from an interrupted update.
- **Local AI** — captions, text to speech, and background removal on your own
  machine, with optional offline model bundles.
- **Subtitles** — `.srt` and `.vtt` import as editable text clips, and
  export back to `.srt`.
- **Export presets** — named settings for resolution, frame rate, quality, and
  encoder, with an estimated output size.
- **Render diagnostics** — reports frame-rate mismatches, the features queued
  for the render, and codecs that depend on the installed FFmpeg build.
- **macOS and Linux packaging** — DMG, DEB, and AppImage workflows. Windows
  remains the only platform verified end to end.
- **Interface localization** — English, Spanish, and Brazilian Portuguese.

### Fixed

- **A muted audio track is now silent in the exported file.** It was silent in
  the preview but still audible in the export.
- **Keyframed position, scale, and rotation now export correctly.** The filter
  expression was written unquoted, so FFmpeg read its commas as the end of a
  filter.
- **The export no longer hangs.** The bundled runtime is pinned to a version
  that renders a transition, and the fetch script refuses a build whose
  checksum does not match.
- **A corrupt project document falls back to its `.bak` copy** automatically.
- **Proxy and export work is recoverable.** An interrupted proxy is rebuilt, and
  a failed or cancelled export never leaves a partial file at the destination.

### Changed

- The bundled FFmpeg is the **essentials** build of 9.0.1, pinned with its
  SHA-256. It carries every filter, codec, and encoder LibreCut uses and is
  about 230 MB smaller than the full build.
- `cargo test` and `cargo clippy --all-targets` run clean in CI.

### Upgrading

- **Projects open unchanged.** The project format is still schema version 1, so
  a project saved by an earlier build opens in 1.0.0 and the other way round.
  No migration is needed and nothing has to be re-imported.
- **The project library is unchanged.** Your projects stay where they are on
  this PC.
- **Check your FFmpeg if you use your own build.** LibreCut bundles FFmpeg
  9.0.1. A system FFmpeg of 9.0.2 or newer hangs on an export that contains a
  transition; 9.0.1 and older are fine.
- **The interface keeps its three languages.** English, Spanish, and Brazilian
  Portuguese, chosen in Settings.

### Known limitations

- macOS and Linux packages are built but not yet verified end to end.
- The preview and the export are two renderers. Scaling, colour processing,
  and font rendering can differ slightly, and the exotic transitions are
  approximated in the preview.
- Variable frame rate sources are normalised on export, so small differences
  in seek accuracy and audio sync can remain.

See [known limitations and recovery](docs/known-limitations.md) for the full
list and the recovery steps, and [supported formats and platform
requirements](docs/formats-and-platforms.md) for what the editor reads and
writes.

## 0.3.0

- Effects, LUTs, templates, the broader plugin API, opt-in auto-update, and
  the macOS and Linux build workflows.

## 0.2.0

- Magnetic main track, ripple edits, speed ramps, offline model bundles,
  audio ducking, and expanded equaliser controls.

## 0.1.0

- The first development preview: import, a multi-track timeline, a canvas
  preview, text clips, effects, transitions, and H.264 export.
