# Contributing to LibreCut

Thanks for helping build a free, local-first video editor.

## Ground rules

- Be respectful and constructive. Harassment is not tolerated.
- Keep the app local-first: no telemetry, accounts, or required network calls.
- Prefer small, focused pull requests. One behavior change per PR.
- Discuss large features in an issue before writing code.
- All contributions are accepted under GPL-3.0-only.

## Development setup

Requirements:

- Windows 10/11 with WebView2
- Node.js 22+ and pnpm 10+
- Rust stable with the MSVC toolchain and Windows SDK
- FFmpeg 9.x sidecars, fetched with `pnpm fetch:ffmpeg`, or `ffmpeg`/`ffprobe` on `PATH`

```powershell
pnpm install
pnpm fetch:ffmpeg
pnpm tauri dev
```

Run the full check suite before opening a PR:

```powershell
pnpm check
pnpm test
pnpm test:e2e
pnpm build
cd src-tauri; cargo fmt --check; cargo clippy -- -D warnings; cargo test
```

## Code style

- TypeScript: strict mode, no `any` unless unavoidable.
- React: function components, hooks, no class components.
- CSS: Tailwind v4 utilities plus the existing `globals.css` component classes.
- Rust: `cargo fmt`, clippy clean, `Result<T, String>` for command errors.
- Keep UI copy in English; short, direct, no marketing filler.
- Match the existing graphite/teal design language. Do not clone another
  editor's layout or assets.

## Architecture notes

- Frontend lives in `src`, Rust in `src-tauri/src`.
- Tauri commands are the only backend boundary. Add new commands to
  `src-tauri/src/lib.rs` and wrap them in `src/lib/media.ts`.
- Media is served through the custom `librecut://` protocol with Range support.
- Export graphs are generated in `src-tauri/src/export.rs` and written to a
  filter script because FFmpeg 9 removed `-filter_complex_script`.
- Project files are versioned with `schemaVersion`. Bump it for breaking
  changes and add a migration.

See [docs/architecture.md](docs/architecture.md) and
[docs/project-format.md](docs/project-format.md).

## Tests

- Unit tests live in `tests` and run with `pnpm test` (Vitest).
- Prefer testing pure logic: time math, snapping, project/export builders.
- `pnpm test:e2e` runs `src-tauri/tests/media_e2e.rs`, which generates real media
  with FFmpeg and exercises probe, waveform, overlay, and export end to end.
  Set `LIBRECUT_REQUIRE_FFMPEG=1` to make missing FFmpeg a hard failure.
- Manual checks: import, scrub, trim, split, text edit, proxy playback, export.
- Include the smallest source media that reproduces a bug.

## Reporting bugs

Include:

- LibreCut version and commit
- Windows and WebView2 version
- Source codec/container (from the media panel or `ffprobe`)
- Steps to reproduce and expected vs actual behavior
- Export errors: the FFmpeg message shown in the export dialog

## License

By contributing you agree your work is licensed under GPL-3.0-only and that you
have the right to submit it.
