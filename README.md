# LibreCut

**A free, open-source, local-first video editor for Windows.** No account. No watermark. No telemetry.

LibreCut is an early-stage desktop editor built for fast, everyday cuts: import media, trim and split on a multi-track timeline, add text and music, then export a clean MP4 rendered locally with FFmpeg.

> LibreCut is not affiliated with CapCut or ByteDance. It is an independent open-source project inspired by the simplicity of modern creator tools.

## Status

This repository contains the **v0.1 development preview**. The core editing loop is implemented and the Tauri window launches successfully on Windows; expect rough edges and missing advanced features.

Verified today:

- `pnpm tauri dev` launches: Vite stays alive, Rust compiles, the LibreCut window opens
- `pnpm check` (TypeScript) passes
- `pnpm build` (Vite production build) passes
- `cargo check` (Rust) passes
- `pnpm test` (Vitest unit tests) passes (10/10)
- FFmpeg 9 export spike passed: `-/filter_complex` script, overlay, drawtext, audio mix all render

Working today:

- Project library with local autosave and crash-safe project copies (`.librecut`)
- Media import with metadata probing, thumbnail strips, waveforms, and automatic preview proxies
- Multi-track timeline with video, audio, text, and miscellaneous effect tracks
- Clip move, trim, split, duplicate, delete, snapping, zoom, and undo/redo
- Live canvas preview with compositing, transforms, opacity, transitions, keyframes, text, speed, and audio effects
- Inspector for clip transitions, animation presets, keyframes, color filters with masks, audio pitch/EQ, and typography
- H.264/AAC export with size presets, NVENC or CPU encoding, progress, and cancellation
- English UI, keyboard shortcuts, and a local-only privacy model

Not in v0.1:

- Speed ramps, filters/LUTs, chroma key, motion tracking
- Auto-captions, audio ducking, multi-cam, nested sequences
- Templates, effects store, plugins, cloud sync, mobile
- macOS/Linux release builds (the architecture is cross-platform, Windows is the focus)

## Requirements

- Windows 10/11 (WebView2 Evergreen)
- Node.js 22+ and pnpm 10+
- Rust 1.77+ with the MSVC toolchain and Windows SDK
- FFmpeg 9.x with `ffprobe` available on `PATH` for development
  - The export pipeline uses FFmpeg 9's `-/filter_complex` script option.
  - A bundled FFmpeg sidecar is planned for release builds; the build script is in `scripts/fetch-ffmpeg.ps1`.

## Development

```powershell
pnpm install
pnpm tauri dev
```

Useful checks:

```powershell
pnpm check        # TypeScript
pnpm test         # unit tests
pnpm build        # production frontend build
cargo check       # Rust (run from src-tauri)
cargo test        # Rust tests
```

If your shell cannot see FFmpeg after installation, refresh `PATH` or restart the terminal. LibreCut reads `LIBRECUT_FFMPEG` and `LIBRECUT_FFPROBE` as optional overrides.

## Architecture

```
React 19 + TypeScript
  │  Tauri IPC (commands + events)
  ▼
Rust (src-tauri)
  ├── media protocol: librecut:// with HTTP Range support
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
- **Preview:** HTML media element pool → 2D canvas compositor → Web Audio gain graph.
- **Proxies:** 720p/1080p H.264 copies are generated for 4K or non-web-friendly codecs so scrubbing stays responsive.
- **Export:** overlay-by-timestamp filter graph; supports gaps, overlaps, speed, text, and mixed audio. Filters are written to a script file to avoid Windows command-line limits.
- **Project storage:** local JSON in app storage for the preview; Save copy writes a versioned `.librecut` file atomically with a `.bak` backup.

More detail: [docs/architecture.md](docs/architecture.md) and [docs/project-format.md](docs/project-format.md).

## Privacy

LibreCut makes no network requests at runtime. Media never leaves the machine. There is no analytics, account system, or cloud dependency. See [PRIVACY.md](PRIVACY.md).

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

- **v0.2:** magnetic main track, ripple edits, speed ramps, offline model bundles, audio ducking and expanded EQ
- **v0.3:** LUT import, templates, broader plugin API, opt-in auto-update, macOS/Linux builds
- **v1.0:** stability and performance hardening, accessibility audit, packaging and signing, community presets

The current preview already includes transitions, keyframes, a searchable effect library, effect-pack plugins, and local AI tools with first-use model downloads. See [ROADMAP.md](ROADMAP.md) for details.
