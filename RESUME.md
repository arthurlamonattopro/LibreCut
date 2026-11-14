# LibreCut — Project Resume / Summary

LibreCut is a free, open-source, **local-first video editor** built with **Tauri 2 + React 19/TypeScript + Rust + FFmpeg**. Windows is the primary development platform; macOS and Linux packaging workflows are implemented, with hands-on verification still open. No account, no watermark, no telemetry; core editing and rendering happen locally. Optional cloud AI uses endpoints and API keys supplied by the user.

The project is at **v1.1.1**. It covers the v0.1 editing loop, the v0.2 timeline and audio work, v0.3 effects and ecosystem features, the v0.4 media and rendering workflow, and the v1.1 editing and preview accuracy work: multi-select and track editing, export-accurate preview frames and playback, and selectable audio encoding. See [ROADMAP.md](ROADMAP.md) for the detailed feature and platform status.

## What was built

### Desktop shell (Tauri 2 / Rust)
- **`src-tauri/src/lib.rs`** — Tauri builder, custom `librecut://` media protocol registration, command/event wiring
- **`src-tauri/src/media.rs`** — `register_media`, `generate_thumbnails`, `generate_waveform`, `create_proxy`, and the custom HTTP-style media protocol with Range/CORS/MIME support
- **`src-tauri/src/export.rs`** — export and preview command state; submodules for the request model (`export/model.rs`), filter expressions (`export/filters.rs`), transition planning (`export/transitions.rs`), graph assembly (`export/graph.rs`), encoder mapping (`export/encoder.rs`), the FFmpeg process (`export/render.rs`), preview frames (`export/preview.rs`), and preview playback (`export/preview_render.rs`)
- **`src-tauri/src/project.rs`** — atomic `.librecut` save/load with `.bak` backup, NVENC detection
- **`src-tauri/src/library.rs`** — file-backed project library: atomic document and media-cache writes with `.bak` recovery, project index, profiling report writer
- **`src-tauri/src/metrics.rs`** — working-set probe for the editor and its FFmpeg children
- **`src-tauri/src/ffmpeg.rs`** — sidecar/override/PATH resolution, `runtime_status` reporting, probe helper, shared helpers

### Frontend (React 19 + TypeScript + Zustand + Tailwind v4)
- `src/app/App.tsx` — app shell, home ↔ editor navigation, project hydration
- `src/features/home/Home.tsx` — project library, new-project modal, settings/about, runtime status
- `src/features/home/FirstRun.tsx` — first-run guide with FFmpeg readiness check
- `src/lib/firstRun.ts` — onboarding state with safe localStorage fallbacks
- `src/features/editor/Editor.tsx` — layout, autosave (debounced + `beforeunload`), keyboard shortcuts
- `src/features/editor/Preview.tsx` — media element pool → 2D canvas compositor → Web Audio gain graph, plus export-accurate paused frames and whole-timeline playback; stage and transport UI split into `preview/`
- `src/features/editor/Timeline.tsx` — multi-track timeline with multi-select, group drag, move/trim/split/snapping/zoom, track editing, and windowed clip rendering; geometry, toolbar, headers, clips, and menus split into `timeline/`
- `src/features/editor/MediaPanel.tsx` — import, media/text/audio tabs, asset cards
- `src/features/editor/Inspector.tsx` — clip timing, transform, opacity, volume, typography
- `src/features/editor/ExportDialog.tsx` — size presets, encoder choice, audio codec/bitrate/sample rate, saved presets, progress/cancel
- `src/features/editor/PerformancePanel.tsx` — live timing and memory readout, profiling report export
- Effects, LUTs, templates, plugins, AI tools, and update controls are implemented across the editor and home/settings features.
- `src/components/Modal.tsx`, `Toast.tsx`, `Slider.tsx`, `Waveform.tsx`, `Logo.tsx`, `TopBar.tsx`
- `src/lib/hydrate.ts` — re-registers media paths on project open, rebuilds proxies

### Data & persistence
- `src/lib/projectStore.ts` — async file-backed project library with a local-storage fallback, project/media-cache split, legacy migration
- `src/stores/editor.ts` — Zustand + Immer project store, bounded undo/redo, multi-clip selection, zoom, snap, and ripple state
- `src/lib/timeline.ts` — timeline operations: moves, trims, splits, duplication, overlap-free placement, and ripple
- `src/lib/exportRequest.ts` — builds the export request shared by the export dialog, preview frames, and Exact playback
- `src/lib/previewCanvas.ts` — canvas compositing helpers used by the preview stage
- `src/lib/i18n.ts` + `src/locales/es.json`, `src/locales/pt-BR.json` — interface localization with English fallback
- `src/lib/timelineIndex.ts` — per-track clip index used to find the on-screen clips without scanning the project
- `src/lib/snap.ts` — sorted snap boundaries with a binary-search lookup
- `src/lib/metrics.ts` — timing and memory metrics with rolling percentiles
- `src/lib/types.ts` — shared TS types for project, clip, track, export
- `src/lib/time.ts` — clock formatting, snapping, duration math

### Build & CI
- `package.json`, `vite.config.ts`, `tsconfig.json`, `tailwind` via globals.css
- `pnpm-workspace.yaml` (`onlyBuiltDependencies: [esbuild]`) for pnpm 12
- `.github/workflows/ci.yml` — frontend + Rust checks/tests/build on Windows
- `.github/workflows/release.yml` — installer build and verification on tags/manual runs
- `scripts/fetch-ffmpeg.ps1` — downloads, checksum-verifies, and stages FFmpeg sidecars
- `scripts/verify-installer.ps1` — inspects NSIS/MSI output and optionally silent-installs
- `scripts/build-release.ps1` — fetch + build + verify release pipeline
- `scripts/generate-installer-art.ps1` — NSIS header/sidebar bitmaps from the brand palette
- `src-tauri/tests/media_e2e.rs` — real-media probe, waveform, overlay, and export tests

### Docs & legal
- `README.md`, `RESUME.md`, `CHANGELOG.md`, `ROADMAP.md`, `PRODUCT.md`, `DESIGN.md`
- `docs/architecture.md`, `docs/project-format.md`, `docs/formats-and-platforms.md`, `docs/known-limitations.md`, `docs/accessibility.md`, `docs/performance.md`, `docs/plugins.md`, `docs/community-presets.md`, `docs/release.md`
- `docs/tutorials/` — five beginner lessons for import, editing, audio, titles, and export
- `PRIVACY.md`, `CONTRIBUTING.md`, `THIRD_PARTY_LICENSES.md`
- `LICENSE` — GPL-3.0-only

## Verified (dev run)

| Check | Result |
| --- | --- |
| `pnpm check` | ✅ pass |
| `pnpm build` | ✅ pass |
| `pnpm test` | ✅ 194 unit tests pass across 22 files |
| `cargo fmt --check` | ✅ pass |
| `cargo clippy --all-targets -- -D warnings` | ✅ pass |
| `cargo test` with `LIBRECUT_REQUIRE_FFMPEG=1` | ✅ 64 Rust tests pass, including real-media probe/waveform/overlay/export, preview-frame PSNR, preview-playback cache, transitions, and library tests |
| `pnpm tauri dev` | ✅ Vite alive, Tauri window opens (title "LibreCut") |
| project library round trip | ✅ documents and media caches stored under the app data folder, with `.bak` recovery |

These results record the verified development run. The Windows installer checks do not verify macOS or Linux packages; installing, launching, editing, and exporting on supported systems remains open in the roadmap.

## How to run

```powershell
pnpm install
pnpm fetch:ffmpeg
pnpm tauri dev
```

Useful commands:
- `pnpm check` — TypeScript
- `pnpm test` — Vitest unit tests
- `pnpm test:e2e` — real-media Rust export tests
- `pnpm build` — production frontend build
- `cd src-tauri; cargo check` — Rust

## Current open work

- Verify macOS Intel DMG and Ubuntu 22.04 x64 DEB/AppImage installation, launch, project editing, and export on supported systems.
- Next release: pick up the remaining roadmap items once platform verification and performance numbers are captured.
- Capture performance numbers on the reference machine and compare them with the targets in `docs/performance.md`; the targets are goals, not measured claims.
- Remaining release quality: signed and notarized macOS builds, reproducible builds, and broader platform verification.

Deferred or explicitly out of scope include motion tracking, nested sequences, multi-cam editing, cloud sync, and mobile builds; see [ROADMAP.md](ROADMAP.md) for the current roadmap and non-goals.

## License

GPL-3.0-only (LibreCut). FFmpeg is separate under its own license — see THIRD_PARTY_LICENSES.md before distributing bundled builds.
