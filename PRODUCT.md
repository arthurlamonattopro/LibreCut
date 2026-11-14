# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

People making everyday videos on Windows who want to import their own media, make straightforward edits, and export a finished video locally.

## Product Purpose

LibreCut is a free, open-source video editor for fast, everyday cuts. Success is importing video, audio, or images; trimming and arranging clips; adding text or music; and exporting a clean MP4.

## Positioning

Editing and rendering happen on the user's PC. LibreCut has no account, watermark, telemetry, or runtime network requests.

## Operating Context

The stable release runs as a Windows desktop app using Tauri 2. Users work with local media and projects, then render with FFmpeg. The core workflow is project library → import → timeline edit → preview → local export. macOS and Linux build workflows exist, but only Windows is verified end to end.

## Capabilities and Constraints

- The editor supports media import, video/audio/text/misc tracks, multi-select, clip move/trim/split/duplicate/delete, group drag, track deletion and reordering, snapping, zoom, bounded undo/redo, preview compositing, clip transforms, transitions, keyframes, color effects and LUTs, audio controls, subtitles, templates, plugins, and H.264 MP4 export with AAC or ALAC audio, progress, and cancellation.
- The preview offers a fast canvas renderer plus **Match export** paused frames and optional **Exact** whole-timeline playback rendered by the FFmpeg export graph.
- Projects autosave locally; users can save a `.librecut` project copy. Local AI tools cover captions, speech, and image background removal; optional cloud AI uses user-supplied endpoints and keys.
- Windows is verified end to end. The frontend uses React 19, TypeScript, Zustand, and Tailwind CSS; the desktop shell uses Tauri 2 and Rust.
- Motion tracking, nested sequences, multi-cam editing, cloud sync, mobile apps, and a codec/container picker beyond H.264 MP4 are outside the current release.
- The product is independent and is not affiliated with CapCut or ByteDance.

## Brand Commitments

The product name is LibreCut. It is free and open source under GPL-3.0-only. The user supplied CapCut UI screenshots as workflow and usability inspiration; they do not change LibreCut's name or independent identity.

## Evidence on Hand

`RESUME.md` and `README.md` document the current product, capabilities, and verified development state. `CHANGELOG.md` records the 1.0.0, 1.1.0 and 1.1.1 releases. No customer evidence or performance claims are established; the performance targets in `docs/performance.md` are goals, not measured claims.

## Product Principles

- Keep the path from local media to finished video direct and understandable.
- Make the edit visible in the preview and timeline while the user works.
- Keep project media and rendering on the user's machine.
- Preserve clear status and recovery for save, import, and export operations.
