# Roadmap

LibreCut is an early-stage, local-first editor. This roadmap is directional, not
a promise. Priorities can change based on community feedback.

## v0.1 — development preview (current)

- [x] Tauri 2 + React 19 + Rust shell
- [x] Project library and local autosave
- [x] Media import with probe, thumbnails, waveforms
- [x] Automatic preview proxies for 4K / non-web codecs
- [x] Multi-track timeline (video, audio, text)
- [x] Move, trim, split, duplicate, delete, snapping, zoom
- [x] Undo/redo
- [x] Canvas preview with layered compositing
- [x] Text clips with typography controls
- [x] Video and audio controls, masks, chroma key, transitions, and keyframes
- [x] Resizable media, preview, inspector, and timeline panels
- [x] Effect library with searchable presets, color controls, blur, vignette, fades, and motion blur
- [x] Local AI captions and speech generation with first-use model downloads and caching
- [x] English, Spanish, Portuguese, and French language choices for AI captions and speech
- [x] Optional cloud AI through user-provided endpoints and API keys
- [x] Local image background removal
- [x] Effect-pack plugins with install, enable/disable, export, and remove controls
- [x] H.264/AAC export with NVENC or CPU, progress, cancel
- [x] `.librecut` project save/load with backup

Remaining before tagging v0.1:

- [x] Bundle FFmpeg as a sidecar and verify installer output
- [x] End-to-end tests on real media
- [x] Icon, installer polish, and first-run guidance

## v0.2 — timeline depth

- [x] Magnetic main track and ripple edits
- [x] Speed ramps
- [x] More text styling and safe-area guides
- [x] Offline model bundles so local AI can work without a first-use download
- [x] Audio ducking and expanded EQ controls
- [x] More audio processing and timeline automation

What landed in v0.2:

- One designated magnetic track keeps its clips packed, and a ripple toggle makes
  deletes and trims close the gap on every track.
- Speed ramps use editable speed points, with an exact preview and a
  piecewise-constant approximation in the exported file.
- Text clips gained font family, italics, line height, shadow colour, and a
  background box; the preview can draw action/title safe areas and thirds.
- `scripts/fetch-models.ps1` fills a models folder that LibreCut serves over
  the `librecutmodel` protocol, with a strict offline mode that blocks
  downloads.
- Tracks can duck under other audio, and the equalizer grew a mid band with
  adjustable frequencies.
- Stereo panning, a per-clip compressor, track volume, and volume automation
  with timeline curves round out the audio work.

## v0.3 — effects and ecosystem

- [x] Color adjustments and a searchable effect preset browser
- [x] JSON effect-pack plugins
- [x] LUT import and application
  - [x] Support importing `.cube` LUT files and validate malformed or unsupported files
  - [x] Add a LUT effect that can be applied to clips and adjusted in the inspector
  - [x] Include LUT settings in project save/load and rendered exports
- [x] Templates
  - [x] Define and validate a versioned, media-free project template format
  - [x] Add built-in landscape, vertical, and square starter templates to project creation
  - [x] Create an editable project from the selected template
  - [x] Add template previews and support creating, importing, and exporting custom templates
- [x] Broader plugin API for additional editor extension points
  - [x] Define and document stable plugin interfaces and version compatibility
  - [x] Add extension points for editor areas beyond effect packs
  - [x] Add plugin permissions, lifecycle handling, and clear failure reporting
  - [x] Provide an example plugin and validate install, enable, disable, and removal
- [x] Auto-update (opt-in)
  - [x] Add an opt-in setting and show the current and available versions
  - [x] Check for updates and present release notes before installation
  - [x] Download, verify, and install updates with recovery from interrupted updates
  - [x] Document update channels and how to disable update checks
- [ ] macOS and Linux builds
  - [x] Set up macOS and Linux build and packaging workflows (Intel macOS DMG; Ubuntu 22.04 x64 DEB/AppImage)
  - [x] Implement platform-specific media, filesystem, and installer integration (native Tauri dialogs/protocols and case-aware media path matching)
  - [x] Package FFmpeg and required runtime dependencies for each platform (static FFmpeg/ffprobe sidecars)
  - [ ] Verify install, launch, project editing, and export on supported systems

## v1.0 — release quality

- Performance hardening for long timelines and 4K sources
- Accessibility audit and keyboard-complete workflows
- Signed installers and reproducible builds
- Localization framework for the editor UI (AI language options are available today)
- Documentation, tutorials, and a community preset pack

## Explicit non-goals

- Accounts, cloud sync, or mandatory network services
- Watermarks or paid export tiers
- Telemetry
- Mobile builds in the near term
