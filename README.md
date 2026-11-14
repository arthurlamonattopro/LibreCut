# LibreCut

**A free, open-source, local-first video editor.** No account. No watermark. No telemetry.

LibreCut is a desktop editor built for fast, everyday cuts: import media, edit a multi-track timeline, add effects, titles, and music, then export an MP4 locally with FFmpeg. Windows is the primary development platform; macOS and Linux packaging workflows are also available, with hands-on verification still in progress.

> LibreCut is not affiliated with CapCut or ByteDance. It is an independent open-source project inspired by the simplicity of modern creator tools.

## Status

**LibreCut 1.1.0** is the latest stable release (see the [changelog](CHANGELOG.md)). Windows is verified end to end; macOS and Linux packages still need hands-on verification on supported systems.

Verified today:

- `pnpm tauri dev` launches: Vite stays alive, Rust compiles, the LibreCut window opens
- `pnpm check` (TypeScript), `pnpm build`, and `cargo check` (Rust) pass
- `pnpm test` passes the Vitest suites
- `cargo test` passes the Rust suites, including real-media export and preview-frame checks
- `pnpm test:e2e` renders real generated media through the FFmpeg export graph
- Windows installers bundle `ffmpeg.exe` and `ffprobe.exe` as Tauri sidecars; `scripts/verify-installer.ps1` checks NSIS and MSI output

Working today:

- Project library with local autosave and crash-safe project copies (`.librecut`)
- Media import with metadata probing, thumbnail strips, waveforms, and automatic preview proxies
- Multi-track timeline with video, audio, text, and miscellaneous effect tracks
- Optional magnetic main track with packed inserts, plus a track-scoped ripple toggle for deletes and trims
- Multi-select, clip move, trim, split, duplicate, delete, snapping, zoom, and state-restoring undo/redo
- Track creation, deletion, reordering, and overlap-free placement
- Speed ramps with editable speed points, in the preview and the export
- Live canvas preview with compositing, transforms, opacity, transitions, keyframes, text, and audio effects, plus an export-accurate paused frame and an optional export-accurate whole-timeline playback mode via the same FFmpeg graph the export uses
- Searchable effect presets, color adjustments, masks, blur, vignette, fades, motion blur, and imported `.cube` LUTs
- Every transition FFmpeg's `xfade` filter supports: cross fades, wipes, slides, irises, slices, and effects, previewed on the canvas and rendered with `xfade` on export
- Text styling, animation presets, safe-area guides, and customizable transitions and keyframes
- Audio ducking, expanded EQ, stereo panning, compression, track volume, automation curves, and per-clip fades
- Local AI captions, speech generation, and image background removal; models can download on first use or be installed as offline bundles
- Optional cloud AI through user-provided endpoints and API keys
- Effect-pack plugins and broader editor plugins, with permissions and lifecycle controls
- Built-in and custom project templates
- Community preset packs: reviewed color filters and text styles, published under CC0-1.0 ([pack](presets/community/README.md))
- H.264 export with size presets, NVENC or CPU encoding, AAC (96–320 kbps) or ALAC lossless audio at 44.1, 48, or 96 kHz, progress, and cancellation
- Opt-in update checks and updates, with release notes
- English, Spanish, and Brazilian Portuguese UI, keyboard shortcuts, and a local-first privacy model
- Keyboard-operable editing and screen-reader announcements for progress, errors, and dialogs ([accessibility notes](docs/accessibility.md))

Platform status:

- Windows: verified end to end; installers are built and checked by `scripts/verify-installer.ps1`.
- macOS: Intel DMG build workflow is implemented.
- Linux: Ubuntu 22.04 x64 DEB and AppImage build workflows are implemented.
- macOS/Linux install, launch, editing, and export verification remains open. See [ROADMAP.md](ROADMAP.md).

## Requirements

- Windows 10/11 (WebView2 Evergreen); macOS and Linux build workflows are available
- Node.js 22+ and pnpm 10+
- Rust 1.77+ with the MSVC toolchain and Windows SDK
- FFmpeg 9.x with `ffprobe` for development
  - Run `pnpm fetch:ffmpeg` to download verified sidecars into `src-tauri/binaries/`.
    The script pins FFmpeg 9.0.1 and its checksum: FFmpeg 9.0.2 and later
    deadlock on the export graph of a timeline that contains a transition.
    The essentials build is the default; `-Variant full` adds the encoders and
    filters LibreCut does not use, at about 230 MB more.
  - If you prefer a system install, put `ffmpeg`/`ffprobe` on `PATH` or set `LIBRECUT_FFMPEG` and `LIBRECUT_FFPROBE`.
  - The export pipeline uses FFmpeg 9's `-/filter_complex` script option.

## Development

```powershell
pnpm install
pnpm tauri dev
```

Useful checks:

```powershell
pnpm check             # TypeScript
pnpm test              # unit tests
pnpm test:e2e          # real-media Rust export/probe tests
pnpm build             # production frontend build
pnpm fetch:ffmpeg      # download verified FFmpeg sidecars
pnpm fetch:models      # download local AI model bundles
pnpm verify:installer  # inspect built NSIS/MSI artifacts
cargo check            # Rust (run from src-tauri)
cargo test             # Rust tests
```

If your shell cannot see FFmpeg after installation, refresh `PATH` or restart the terminal. LibreCut reads `LIBRECUT_FFMPEG` and `LIBRECUT_FFPROBE` as optional overrides. Release builds resolve the bundled sidecars first.

### Offline AI models

Local AI tools download a Hugging Face model on first use and cache it. To use captions, speech, or background removal without any download, put model folders in LibreCut's models directory:

```text
%APPDATA%\app.librecut.desktop\models\<organization>\<model>\
```

Run `pnpm fetch:models` to download the recommended set (Whisper Small, MMS voices for English/Spanish/Portuguese/French, and MODNet). Pass `-Models organization/model` to fetch another Transformers.js-compatible repository. Then open AI tools and use **Refresh** to rescan the folder. Enable **Strict offline** to block remote downloads and verify that a local bundle is complete.

### Release builds

```powershell
pnpm build:release
```

This fetches FFmpeg, builds the frontend and Tauri bundles, and verifies that the NSIS and MSI installers contain the sidecars and notices. Add `-InstallTest` to perform a silent install into a temporary directory. See [docs/release.md](docs/release.md).

## Architecture

```
React 19 + TypeScript
  │  Tauri IPC (commands + events)
  ▼
Rust (src-tauri)
  ├── media protocol: librecut:// with HTTP Range support
  ├── model protocol: librecutmodel:// for bundled and app-data model files
  ├── project file I/O and atomic saves
  ├── export orchestration and progress/cancel
  ▼
librecut media helpers
  ├── ffprobe metadata
  ├── thumbnails, waveforms, proxy generation
  └── FFmpeg filter-graph builder
  ▼
ffmpeg / ffprobe
```

- **Timeline timebase:** integer-friendly seconds in the UI, authoritative FFmpeg timestamps in export.
- **Preview:** HTML media element pool → 2D canvas compositor → Web Audio graph (EQ → pan → compressor → gain), with a **Match export** frame and an optional **Exact** playback mode rendered by the FFmpeg export graph.
- **Proxies:** 720p/1080p H.264 copies are generated for 4K or non-web-friendly codecs so scrubbing stays responsive.
- **Export:** overlay-by-timestamp filter graph; supports gaps, overlaps, speed, text, and mixed audio. Filters are written to a script file to avoid Windows command-line limits.
- **Runtime tools:** `ffmpeg.exe` and `ffprobe.exe` are Tauri sidecars next to the app. Resolution order is `LIBRECUT_FFMPEG`/`LIBRECUT_FFPROBE`, bundled sidecar, then `PATH`.
- **Project storage:** local JSON in app storage for the preview; Save copy writes a versioned `.librecut` file atomically with a `.bak` backup.

More detail: [docs/architecture.md](docs/architecture.md) and [docs/project-format.md](docs/project-format.md).

## Documentation

New to LibreCut? Start with the tutorials:

- [Tutorial 1: Import your media](docs/tutorials/01-import-media.md)
- [Tutorial 2: Cut and edit](docs/tutorials/02-cut-and-edit.md)
- [Tutorial 3: Mix the audio](docs/tutorials/03-audio.md)
- [Tutorial 4: Add titles and captions](docs/tutorials/04-titles-and-captions.md)
- [Tutorial 5: Export the video](docs/tutorials/05-export.md)

Reference:

- [Supported formats and platform requirements](docs/formats-and-platforms.md)
- [Known limitations and recovery](docs/known-limitations.md)
- [Community preset packs](docs/community-presets.md)
- [Changelog](CHANGELOG.md)
- [Plugin API](docs/plugins.md) · [Project format](docs/project-format.md) · [Architecture](docs/architecture.md) · [Accessibility](docs/accessibility.md) · [Performance](docs/performance.md) · [Release process](docs/release.md)

## Privacy

Media never leaves the machine. Local AI models contact Hugging Face only when a model is missing from the local bundle and strict offline mode is off. There is no analytics, account system, or cloud dependency. Stable-release update checks are opt-in in Settings and contact this project's GitHub Releases only when enabled. See [PRIVACY.md](PRIVACY.md).

## License

LibreCut is licensed under **GPL-3.0-only**. See [LICENSE](LICENSE).

FFmpeg is distributed separately under its own license. The development build uses a GPL-enabled FFmpeg build (libx264). See [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md) before distributing binaries.

## Contributing

Contributions are welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md), keep changes focused, and include tests where behavior changes.

If you find a bug, include:

- Windows version and WebView2 version
- LibreCut version
- Source media codec/container and a minimal reproduction
- Relevant `%LOCALAPPDATA%\app.librecut.desktop\logs` output if available

## Roadmap

- **v0.2:** magnetic main track, ripple edits, speed ramps, offline model bundles, audio ducking and expanded EQ — landed
- **v0.3:** effects, LUTs, templates, broader plugin API, opt-in auto-update, and macOS/Linux packaging workflows — implemented; platform verification remains
- **v0.4:** export presets, render diagnostics, subtitles, proxy controls, and long-session resilience — landed
- **v1.0:** performance hardening, accessibility, UI localization, documentation, community presets, and a pinned, reproducible FFmpeg runtime — released; see the [changelog](CHANGELOG.md)

See [ROADMAP.md](ROADMAP.md) for details and current open work.
