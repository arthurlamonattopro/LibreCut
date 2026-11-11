# Architecture

LibreCut is a Tauri 2 desktop app: a React/TypeScript renderer talks to a Rust
backend over Tauri IPC. All media work happens locally with FFmpeg.

```
┌─────────────────────────────────────────────────────────────┐
│ React renderer (WebView2)                                    │
│  Home ─ project library                                      │
│  Editor ─ MediaPanel · Preview · Inspector · Timeline        │
│  Zustand stores ─ project state, undo/redo, selection         │
└───────────────────────┬─────────────────────────────────────┘
                        │ invoke() / listen()
┌───────────────────────▼─────────────────────────────────────┐
│ Rust backend                                                 │
│  media.rs    probe, thumbnails, waveform, proxy, protocol    │
│  export.rs   filter graph, progress, cancel, encoders        │
│  project.rs  save/load, atomic write, NVENC detection        │
│  ffmpeg.rs   binary resolution, shared helpers               │
└───────────────────────┬─────────────────────────────────────┘
                        │ child processes
                  ffmpeg / ffprobe
```

## Process boundaries

- **Renderer** owns UI state and the edit model. It never touches the
  filesystem directly.
- **Rust** owns validation, file I/O, process orchestration, and streaming
  progress back as Tauri events (`media-progress`, `export-progress`).
- **FFmpeg** is an external process. LibreCut never links FFmpeg into the app.
- **Sidecars:** release installers place `ffmpeg.exe` and `ffprobe.exe` next to
  `LibreCut.exe`. `ffmpeg.rs` resolves an environment override first, then the
  sidecar (with or without the target-triple suffix), then `PATH`. The
  `runtime_status` command reports the resolved paths and versions so the UI can
  explain a missing runtime.

## Media protocol

Imported files get an opaque ID stored in `MediaRegistry`. The renderer requests
`http://librecut.localhost/media/<id>` (Windows) or `librecut://localhost/...`.
The protocol handler in `media.rs`:

- maps the ID to a path (no path traversal)
- serves `Content-Type` by extension
- implements HTTP Range (`206 Partial Content`) so `<video>` seeking works
- answers `OPTIONS` and `HEAD` with CORS headers
- refuses full responses over 256 MiB (browsers use ranges anyway)

The registry is in-memory. On project load the renderer re-registers each asset
path so IDs stay valid for the session.

## Preview pipeline

Media elements are not displayed directly. The preview:

1. Creates a hidden `<video>`/`<audio>`/`Image` per clip (`syncPool`).
2. Routes non-image elements through `AudioContext` → `GainNode` so per-clip
   volume and track mute are sample-accurate.
3. Drives playback with a `requestAnimationFrame` clock. Each tick:
   - advances the timeline time
   - seeks elements whose drift exceeds a tolerance
   - sets gains
   - composites the active video/image layers and text onto a 2D canvas
4. Applies `contain`/`cover` fitting and clip opacity in canvas space.

Preview resolution is capped at 1920 px on the long edge. Proxies keep decoding
cheap for 4K sources and codecs WebView2 struggles with.

## Export pipeline

Export uses an **overlay-by-timestamp** graph rather than flattening the timeline
into a concat sequence. Each video/image clip becomes a trimmed, scaled,
alpha-mixed overlay whose `enable` window is `between(t, start, end)`:

```
color=c=0x101012:s=WxH:r=FPS:d=DURATION[base0];
[i:v]trim=start=IN:duration=SRC,setpts=(PTS-STARTPTS)/SPEED+START/TB,
     scale/pad,setsar=1,fps=FPS,format=rgba,colorchannelmixer=aa=OPACITY[vi];
[baseN][vi]overlay=0:0:eof_action=pass:enable='between(t,START,END)'[bgN];
...
[baseN]drawtext=...:enable='between(t,START,END)'[txtN];
[i:a]atrim=...,asetpts=PTS-STARTPTS,atempo...,volume=...,adelay=...[ai];
[a0][a1]...amix=inputs=N:duration=longest:normalize=0,apad,atrim=0:DURATION[aout]
```

Why:

- Gaps and overlaps are natural — there is no requirement for contiguous clips.
- Audio-only clips and image clips are handled with the same model.
- Speed uses `setpts` for video and chained `atempo` for audio.

Because FFmpeg 9 removed `-filter_complex_script`, the graph is passed with
`-/filter_complex <file>`. Writing it to a file avoids Windows command-line
length limits.

Encoders: `libx264` (default), `h264_nvenc`, `h264_qsv`, `h264_amf`. NVENC is
detected by inspecting `ffmpeg -encoders`. Export runs as a child process with
`-progress pipe:1`; output is parsed into percent/time/fps/speed and emitted to
the UI. Cancel sets an atomic flag, kills the child, and deletes the partial file.

## Project storage

Two layers:

1. **Autosave:** JSON in WebView local storage, debounced 700 ms in the editor
   and flushed on back/close. Index at `librecut:projects:v1`, one key per
   project.
2. **Portable file:** `Save copy` writes a versioned `.librecut` JSON through
   Rust (`save_project`). The write is atomic: backup existing file to
   `.librecut.bak`, write `.librecut.tmp`, then rename over the target.

`load_project` validates JSON before returning it; the renderer checks
`schemaVersion` and structure.

## State and history

`useEditor` (Zustand + Immer) holds the current `Project`, playhead, selection,
zoom, snap, dirty flag, and undo/redo stacks. Mutations go through `mutate`,
which snapshots the previous project for undo unless `record` is false. Continuous
gestures (drag, slider) record once on gesture start to keep history readable.

## Failure modes

- Missing source file → protocol returns 404; asset shows a broken thumbnail.
- Missing FFmpeg/ffprobe → `runtime_status` reports the unresolved tool; the
  first-run guide, Settings, and export dialog explain how to fix it.
- Proxy failure → status `failed`, the app falls back to the original file.
- Export failure → partial output is deleted and FFmpeg's tail is shown.
- Corrupt project → load returns an error; the `.bak` file can be renamed back.

## Deferred design work

Transitions, keyframes, effects, captions, and a plugin API need a richer render
model. The intended direction is a compositor abstraction that can drive both the
canvas preview and the FFmpeg graph from one description, instead of maintaining
two independent renderers.
