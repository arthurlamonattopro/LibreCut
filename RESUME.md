# LibreCut — Project Resume / Summary

LibreCut is a free, open-source, **local-first video editor** built with **Tauri 2 + React 19/TypeScript + Rust + FFmpeg**. Windows is the primary development platform; macOS and Linux packaging workflows are implemented, with hands-on verification still open. No account, no watermark, no telemetry; core editing and rendering happen locally. Optional cloud AI uses endpoints and API keys supplied by the user.

The current project milestone is the **v0.3 development preview**. It includes the v0.2 timeline and audio work plus v0.3 effects, LUTs, templates, plugins, opt-in updates, and cross-platform packaging workflows. See [ROADMAP.md](ROADMAP.md) for the detailed feature and platform status.

## What was built

### Desktop shell (Tauri 2 / Rust)
- **`src-tauri/src/lib.rs`** — Tauri builder, custom `librecut://` media protocol registration, command/event wiring
- **`src-tauri/src/media.rs`** — `register_media`, `generate_thumbnails`, `generate_waveform`, `create_proxy`, and the custom HTTP-style media protocol with Range/CORS/MIME support
- **`src-tauri/src/export.rs`** — FFmpeg export graph builder, progress streaming, cancel, NVENC/QSV/AMF/libx264 encoder selection
- **`src-tauri/src/project.rs`** — atomic `.librecut` save/load with `.bak` backup, NVENC detection
- **`src-tauri/src/ffmpeg.rs`** — sidecar/override/PATH resolution, `runtime_status` reporting, probe helper, shared helpers

### Frontend (React 19 + TypeScript + Zustand + Tailwind v4)
- `src/app/App.tsx` — app shell, home ↔ editor navigation, project hydration
- `src/features/home/Home.tsx` — project library, new-project modal, settings/about, runtime status
- `src/features/home/FirstRun.tsx` — first-run guide with FFmpeg readiness check
- `src/lib/firstRun.ts` — onboarding state with safe localStorage fallbacks
- `src/features/editor/Editor.tsx` — layout, autosave (debounced + `beforeunload`), keyboard shortcuts
- `src/features/editor/Preview.tsx` — media element pool → 2D canvas compositor → Web Audio gain graph
- `src/features/editor/Timeline.tsx` — multi-track timeline, move/trim/split/snapping/zoom
- `src/features/editor/MediaPanel.tsx` — import, media/text/audio tabs, asset cards
- `src/features/editor/Inspector.tsx` — clip timing, transform, opacity, volume, typography
- `src/features/editor/ExportDialog.tsx` — size presets, encoder choice, progress/cancel
- Effects, LUTs, templates, plugins, AI tools, and update controls are implemented across the editor and home/settings features.
- `src/components/Modal.tsx`, `Toast.tsx`, `Slider.tsx`, `Waveform.tsx`, `Logo.tsx`, `TopBar.tsx`
- `src/lib/hydrate.ts` — re-registers media paths on project open, rebuilds proxies

### Data & persistence
- `src/stores/projects.ts` — localStorage autosave index + project data, crash-safe slim fallbacks
- `src/stores/editor.ts` — Zustand + Immer project store, undo/redo (100 deep), selection, zoom
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
- `README.md`, `docs/architecture.md`, `docs/project-format.md`
- `PRIVACY.md`, `CONTRIBUTING.md`, `ROADMAP.md`, `THIRD_PARTY_LICENSES.md`
- `LICENSE` — GPL-3.0-only

## Verified (dev run)

| Check | Result |
| --- | --- |
| `pnpm check` | ✅ pass |
| `pnpm build` | ✅ pass |
| `pnpm test` | ✅ 14 unit tests pass |
| `cargo fmt --check` | ✅ pass |
| `cargo clippy --all-targets -- -D warnings` | ✅ pass |
| `cargo test` with `LIBRECUT_REQUIRE_FFMPEG=1` | ✅ 7 real-media probe/waveform/overlay/mask/export tests pass |
| `pnpm tauri dev` | ✅ Vite alive, Tauri window opens (title "LibreCut") |
| `pnpm tauri build` | ✅ NSIS 59.1 MiB and MSI 79.4 MiB with FFmpeg 9.0.2 sidecars |
| `scripts/verify-installer.ps1 -InstallTest` | ✅ silent NSIS install and MSI administrative install contain the app, sidecars, and legal files |

These results record the verified development run. The Windows installer checks do not verify macOS or Linux packages; installing, launching, editing, and exporting on supported systems remains open in the roadmap.

## How to run

```powershell
pnpm install
pnpm tauri dev
```

Useful commands:
- `pnpm check` — TypeScript
- `pnpm test` — Vitest unit tests
- `pnpm build` — production frontend build
- `cd src-tauri; cargo check` — Rust

## Current open work

- Verify macOS Intel DMG and Ubuntu 22.04 x64 DEB/AppImage installation, launch, project editing, and export on supported systems.
- v1.0 release quality: long-timeline and 4K performance, accessibility, signed installers, reproducible builds, UI localization, and documentation/tutorials.

Deferred or explicitly out of scope include motion tracking, nested sequences, multi-cam editing, cloud sync, and mobile builds; see [ROADMAP.md](ROADMAP.md) for the current roadmap and non-goals.

## License

GPL-3.0-only (LibreCut). FFmpeg is separate under its own license — see THIRD_PARTY_LICENSES.md before distributing bundled builds.
