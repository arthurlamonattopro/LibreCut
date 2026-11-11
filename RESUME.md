# LibreCut — Project Resume / Summary

LibreCut is a free, open-source, **local-first video editor for Windows**, built with **Tauri 2 + React 19/TypeScript + Rust + FFmpeg**. No account, no watermark, no telemetry; all processing happens on the local machine.

## What was built

### Desktop shell (Tauri 2 / Rust)
- **`src-tauri/src/lib.rs`** — Tauri builder, custom `librecut://` media protocol registration, command/event wiring
- **`src-tauri/src/media.rs`** — `register_media`, `generate_thumbnails`, `generate_waveform`, `create_proxy`, and the custom HTTP-style media protocol with Range/CORS/MIME support
- **`src-tauri/src/export.rs`** — FFmpeg export graph builder, progress streaming, cancel, NVENC/QSV/AMF/libx264 encoder selection
- **`src-tauri/src/project.rs`** — atomic `.librecut` save/load with `.bak` backup, NVENC detection
- **`src-tauri/src/ffmpeg.rs`** — binary resolution (`LIBRECUT_FFMPEG`/`PATH`), probe helper, shared helpers

### Frontend (React 19 + TypeScript + Zustand + Tailwind v4)
- `src/app/App.tsx` — app shell, home ↔ editor navigation, project hydration
- `src/features/home/Home.tsx` — project library, new-project modal, settings/about
- `src/features/editor/Editor.tsx` — layout, autosave (debounced + `beforeunload`), keyboard shortcuts
- `src/features/editor/Preview.tsx` — media element pool → 2D canvas compositor → Web Audio gain graph
- `src/features/editor/Timeline.tsx` — multi-track timeline, move/trim/split/snapping/zoom
- `src/features/editor/MediaPanel.tsx` — import, media/text/audio tabs, asset cards
- `src/features/editor/Inspector.tsx` — clip timing, transform, opacity, volume, typography
- `src/features/editor/ExportDialog.tsx` — size presets, encoder choice, progress/cancel
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
- `scripts/fetch-ffmpeg.ps1` — downloads/unpacks a full GPL FFmpeg build for sidecar bundling

### Docs & legal
- `README.md`, `docs/architecture.md`, `docs/project-format.md`
- `PRIVACY.md`, `CONTRIBUTING.md`, `ROADMAP.md`, `THIRD_PARTY_LICENSES.md`
- `LICENSE` — GPL-3.0-only

## Verified (dev run)

| Check | Result |
| --- | --- |
| `pnpm check` | ✅ pass |
| `pnpm build` | ✅ pass |
| `pnpm test` | ✅ 10/10 pass |
| `cargo check` | ✅ pass |
| `pnpm tauri dev` | ✅ Vite alive, Tauri window opens (title "LibreCut") |
| FFmpeg export spike | ✅ overlay/drawtext/audio/filter-script render |

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

## What's deferred (post-v0.1)

Transitions, keyframes, speed ramps, LUTs/filters, chroma key, auto-captions (Whisper), audio ducking, templates, plugins, cloud sync, mobile, macOS/Linux builds, signed installers.

## License

GPL-3.0-only (LibreCut). FFmpeg is separate under its own license — see THIRD_PARTY_LICENSES.md before distributing bundled builds.
