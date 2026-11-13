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
│  models.rs   offline model bundles, model protocol           │
│  export/    request model, filter graph, progress, encoders  │
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

## Model protocol

Local AI runs on Transformers.js, which can load model files from disk instead
of downloading them. `models.rs` exposes those files over a second custom
scheme:

- `http://librecutmodel.localhost/<org>/<model>/<file>` (Windows) or
  `librecutmodel://localhost/...`
- the app data folder (`%APPDATA%\app.librecut.desktop\models`) is searched
  first, then a bundled `models` resource folder
- requests are path-checked, so `..` and backslashes are refused
- `offline_model_status` reports the folder and the model IDs it contains

The renderer points `env.localModelPath` at this scheme before a pipeline is
created, so a bundled model loads without a network request. Strict offline mode
sets `env.allowRemoteModels = false` and turns a missing model into an error
instead of a download. `scripts/fetch-models.ps1` populates the folder with
Hugging Face repositories.

## Preview pipeline

Media elements are not displayed directly. The preview:

1. Creates a hidden `<video>`/`<audio>`/`Image` per clip, but only for the
   clips around the playhead (`syncPool`). A long timeline holds thousands of
   clips, and decoding all of them at once would dominate memory and keep
   every decoder busy.
2. Routes non-image elements through `AudioContext`:
   `source → low shelf → mid peak → high shelf → stereo panner → compressor → gain`.
   Per-clip volume, track volume, ducking, track mute, and fades are applied on
   the gain node, so they are sample-accurate.
3. Drives playback with a `requestAnimationFrame` clock. Each tick:
   - advances the timeline time
   - seeks elements whose drift exceeds a tolerance
   - sets gains
   - composites the active video/image layers and text onto a 2D canvas
4. Applies `contain`/`cover` fitting and clip opacity in canvas space.

The clips that are on screen are found through a per-track index
(`src/lib/timelineIndex.ts`) built once per project. A binary search over the
sorted clips replaces the scan over every clip that each frame used to do.

Preview resolution is capped at 1920 px on the long edge. Proxies keep decoding
cheap for 4K sources and codecs WebView2 struggles with.

The editor components are split by role. `Preview.tsx` owns playback, media
pooling, and compositing; the pure canvas helpers live in
`src/lib/previewCanvas.ts`, and the stage and transport UI live in `preview/`.
`Timeline.tsx` owns scrolling, drag/trim gestures, and keyboard navigation;
constants and geometry live in `timeline/geometry.ts`, with the toolbar, track
header, clip, and context menu in `timeline/`.

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
[i:a]atrim=...,asetpts=PTS-STARTPTS,atempo=...,
     bass=...,equalizer=...,treble=...,pan=...,acompressor=...,
     volume=...,adelay=...,volume='duck(envelope)':eval=frame[ai];
[a0][a1]...amix=inputs=N:duration=longest:normalize=0,apad,atrim=0:DURATION[aout]
```

Why:

- Gaps and overlaps are natural — there is no requirement for contiguous clips.
- Audio-only clips and image clips are handled with the same model.
- Speed uses `setpts` for video and chained `atempo` for audio.
- Ducking is a volume envelope on the project timeline, applied after `adelay`
  so the expression can address absolute time. The renderer computes the same
  envelope, so preview and export agree.

The Rust side is split by responsibility: `export.rs` holds the Tauri state and
commands, `export/model.rs` the request types, `export/filters.rs` the filter
expressions, `export/transitions.rs` cut planning, `export/graph.rs` graph
assembly, `export/encoder.rs` encoder/quality mapping, and `export/render.rs`
the FFmpeg process, progress parsing, and final file swap.

Because FFmpeg 9 removed `-filter_complex_script`, the graph is passed with
`-/filter_complex <file>`. Writing it to a file avoids Windows command-line
length limits.

### Transitions

A transition belongs to the **cut** between two neighbouring clips, not to a
single clip. Either edge can describe it — the clip that hands over
(`transitionOut`) or the clip that takes over (`transitionIn`) — and the
incoming edge wins when both do. `src/lib/transitions.ts` holds the
catalogue: every transition FFmpeg's `xfade` filter supports, with the label
the inspector shows, the group it is listed under, and the preview pattern.

The window sits at the start of the incoming clip. The clip that goes away is
held on its last frame while the new one moves in, so the cut keeps the
timeline length it had:

```
[vA]tpad=stop_mode=clone:stop_duration=D,trim=start=END_A:duration=D,setpts=PTS-STARTPTS[hold];
[vB]trim=start=START_B:duration=D,setpts=PTS-STARTPTS[head];
[hold][head]xfade=transition=NAME:duration=D:offset=0[xf];
[xf]setpts=PTS+START_B/TB[xfp];
[base][xfp]overlay=...:enable='between(t,START_B,START_B+D)'[bgx];
```

The incoming clip's own overlay starts after the window, because the
transition stream takes its place. The audio follows the same cut: the
outgoing clip is padded for the length of the transition and faded out while
the incoming clip fades in, which crossfades the two in the mix.

An edge without a neighbour (the last clip on a track, or a clip with a gap
in front of it) has nothing to crossfade with, so it fades against the
background instead. The preview does the same, which keeps the two renderers
in step.

Encoders: `libx264` (default), `h264_nvenc`, `h264_qsv`, `h264_amf`. NVENC is
detected by inspecting `ffmpeg -encoders`. Export runs as a child process with
`-progress pipe:1`; output is parsed into percent/time/fps/speed and emitted to
the UI. Cancel sets an atomic flag, kills the child, and deletes the partial file.

## Project storage

Two layers:

1. **Autosave:** the editable document is written to the app data folder by
   the Rust backend, asynchronously, so a save never blocks the renderer. Each
   project lives in its own folder with `project.json` for the document and
   `cache.json` for the regenerable media caches (poster frames and waveform
   peaks). Writes are atomic: the new content lands in a temp file, the
   previous copy is kept as `.bak`, and the temp file is renamed into place.
   A corrupted document falls back to the `.bak` copy when it is read.
   Poster frames and waveforms are written only when they change, so an edit
   re-serializes the clips rather than the whole media cache.
2. **Portable file:** `Save copy` writes a versioned `.librecut` JSON through
   Rust (`save_project`). The write is atomic: backup existing file to
   `.librecut.bak`, write `.librecut.tmp`, then rename over the target.

`load_project` validates JSON before returning it; the renderer checks
`schemaVersion` and structure. Projects saved by an earlier build are migrated
into the file-backed library the first time the project library is opened.

## State and history

`useEditor` (Zustand + Immer) holds the current `Project`, playhead, selection,
zoom, snap, dirty flag, and undo/redo stacks. Mutations go through `mutate`,
which snapshots the previous project for undo unless `record` is false. Continuous
gestures (drag, slider) record once on gesture start to keep history readable.

## Interface localization

`src/lib/i18n.ts` owns the interface locales (`en`, `es`, `pt-BR`). Translated
copy lives in flat JSON catalogs under `src/locales/` (`es.json`,
`pt-BR.json`), keyed by the English source string. English has no catalog: a
missing translation falls back to readable English rather than an identifier,
so adding a key needs no edit outside the component that uses it. Keep catalogs
in sync; `tests/i18n.test.ts` fails when one locale has keys the other lacks.
Components re-render on language changes
through `useT()`; non-React code (toasts, error handlers, announcements) calls
`t()`. Named placeholders such as `{name}` are interpolated by both. The chosen
locale persists in local storage, is detected from the OS on first run, and is
applied to `<html lang>`. Dates and numbers go through the `Intl` helpers in the
same module. AI caption and speech languages are a separate list and are not
affected by the interface locale.

## Failure modes

- Missing source file → protocol returns 404; asset shows a broken thumbnail.
- Missing FFmpeg/ffprobe → `runtime_status` reports the unresolved tool; the
  first-run guide, Settings, and export dialog explain how to fix it.
- Proxy failure → status `failed`, the app falls back to the original file.
- Export failure → partial output is deleted and FFmpeg's tail is shown.
- Corrupt project → load returns an error; the `.bak` file can be renamed back.

## Deferred design work

Effects, transitions, keyframes, and captions are implemented in both renderers,
but each feature is still described twice: once for the canvas/Web Audio preview
and once for the FFmpeg graph. The intended direction is a compositor
abstraction that can drive both from one description, instead of maintaining two
independent renderers.

Transitions are halfway there: the catalogue of transitions and the rule that
decides which transition plays on a cut live in one place
(`src/lib/transitions.ts`), and both renderers read them. What is still
described twice is the look of a transition: the preview paints the geometry
with canvas operations, while the export hands the name to FFmpeg's `xfade`.
The preview therefore approximates the exotic transitions, while the export
renders the real thing. A test in `src-tauri/tests/transitions.rs` keeps the
two lists of transition names in step.
