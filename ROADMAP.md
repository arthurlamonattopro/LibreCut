# Roadmap

LibreCut is a local-first editor. This roadmap is directional, not a
promise. Priorities can change based on community feedback.

## v0.1 — development preview (landed)

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
- [x] Every transition FFmpeg's `xfade` filter supports, previewed on the canvas and rendered on export
- [x] Resizable media, preview, inspector, and timeline panels
- [x] Effect library with searchable presets, color controls, blur, vignette, fades, and motion blur
- [x] Local AI captions and speech generation with first-use model downloads and caching
- [x] English, Spanish, Portuguese, and French language choices for AI captions and speech
- [x] Optional cloud AI through user-provided endpoints and API keys
- [x] Local image background removal
- [x] Effect-pack plugins with install, enable/disable, export, and remove controls
- [x] H.264 export with AAC or ALAC audio, NVENC or CPU, progress, cancel
- [x] `.librecut` project save/load with backup

Delivered before the v0.1 tag:

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
- Speed ramps use editable speed points, with an exact preview, continuous
  retiming for the exported picture, and finely sampled time-stretching for
  the exported audio.
- Text clips gained font family, italics, line height, shadow colour, and a
  background box; the preview can draw action/title safe areas and thirds.
- `scripts/fetch-models.ps1` fills a models folder that LibreCut serves over
  the `librecutmodel` protocol, with a strict offline mode that blocks
  downloads.
- Tracks can duck under other audio, and the equalizer grew a mid band with
  adjustable frequencies.
- Stereo panning, a per-clip compressor, track volume, and volume automation
  with timeline curves round out the audio work.

## v0.3 — effects and ecosystem (implemented)

The v0.3 scope below is delivered. Cross-platform packages still need hands-on
verification before macOS and Linux can be called supported release targets.

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
- [x] macOS and Linux builds
  - [x] Set up macOS and Linux build and packaging workflows (Intel macOS DMG; Ubuntu 22.04 x64 DEB/AppImage)
  - [x] Implement platform-specific media, filesystem, and installer integration (native Tauri dialogs/protocols and case-aware media path matching)
  - [x] Package FFmpeg and required runtime dependencies for each platform (static FFmpeg/ffprobe sidecars)

## v0.4 — media and rendering workflow (implemented)

Focus: reduce friction between a finished edit and a dependable deliverable.

- [x] Make export settings easier to understand and repeat
  - [x] Save named export presets for resolution, frame rate, quality, and encoder
  - [x] Show estimated output size and explain hardware-encoder availability
  - [x] Preserve export progress and a useful failure summary after cancellation or error
- [x] Strengthen preview and render consistency
  - [x] Track effect, transition, and keyframe usage and surface known preview/render differences
  - [x] Add a render diagnostics view for unsupported or approximated features
  - [x] Improve proxy status, retry, and cleanup controls
- [x] Expand practical media handling
  - [x] Add subtitle import and export workflows with editable timeline cues
  - [x] Flag likely variable-frame-rate sources and explain mixed-rate export normalization
  - [x] Add clearer warnings for unsupported formats and corrupted media
- [x] Improve long-session resilience
  - [x] Add development timing diagnostics for slow import, seek, and save paths and bound import work
  - [x] Bound undo history and background work for large media libraries
  - [x] Recover interrupted proxy generation and keep incomplete exports away from the destination file

Output-size estimates are approximate, and variable-frame-rate detection is based on
the frame-rate values reported by FFprobe. Per-feature preview/render differences
can still vary by source codec, browser, and FFmpeg build.

## v1.0 — dependable release (released)

The v1.0 goal is a reliable editor for common creator workflows, with clear
platform support and no loss of the local-first promise. Scope will be narrowed
based on preview feedback; this is a target, not a release-date commitment.

- [x] Performance hardening for long timelines and 4K sources
  - [x] Set representative project sizes and playback/export performance targets ([profile](docs/performance.md))
  - [x] Profile memory, decode, timeline interaction, and project-save behavior ([diagnostics](docs/performance.md#profiling-procedure))
  - [x] Avoid blocking the editor during imports, proxy work, and other long tasks
- [x] Accessibility and interaction quality
  - [x] Audit keyboard navigation, focus order, labels, contrast, and screen-reader output ([audit](docs/accessibility.md))
  - [x] Make core import, timeline edit, inspector, and export flows usable without a mouse
  - [x] Add accessible names and announcements for progress, errors, and dialogs
- [x] Localization framework for the editor UI
  - [x] Extract interface strings and support locale-aware dates, numbers, and shortcuts
  - [x] Ship reviewed interface translations for English, Spanish, and Brazilian Portuguese
  - [x] Keep AI language availability distinct from interface translation coverage
- [x] Documentation and community ecosystem
  - [x] Publish beginner tutorials for import, editing, audio, titles, and export ([tutorials](docs/tutorials/README.md))
  - [x] Document supported formats, platform requirements, known limitations, and recovery ([formats and platforms](docs/formats-and-platforms.md), [limitations and recovery](docs/known-limitations.md))
  - [x] Curate and review a community preset pack with clear licensing ([community presets](docs/community-presets.md), [pack](presets/community/README.md))
- [x] Release readiness
  - [x] Define supported operating systems and minimum hardware/runtime requirements ([formats and platforms](docs/formats-and-platforms.md))
  - [x] Complete regression checks for project compatibility, editing, and export ([regression suites](tests/regression), [export checks](src-tauri/tests/export_regression.rs))
  - [x] Publish release notes, upgrade guidance, privacy information, and support channels ([changelog](CHANGELOG.md), [privacy](PRIVACY.md), [contributing](CONTRIBUTING.md))

## v1.1 — editing depth and preview accuracy (released)

These changes shipped in 1.1.0; see the [changelog](CHANGELOG.md).

- [x] Multi-select with `Ctrl`-click, `Shift`-click ranges, and rubber-band selection, plus bulk move, delete, duplicate, and split
- [x] Track deletion and reordering, track-scoped ripple, and overlap-free clip placement
- [x] **Match export** paused frames rendered with the FFmpeg export graph, and **Exact** whole-timeline playback from a cached export render
- [x] Selectable audio encoding: AAC at 96–320 kbps or ALAC lossless, at 44.1, 48, or 96 kHz
- [x] Exact video speed ramps and finely segmented audio retiming

## Release principles

- Keep projects and media local by default; network features remain optional and explicit.
- Preserve existing `.librecut` projects when the format evolves, with documented migrations.
- Prefer clear failure messages and recoverable work over silent data loss.
- Treat platform support as verified only after install, launch, editing, save/load, and export have been exercised on that platform.
- Revisit priorities with user feedback; later milestones may change before implementation.

## Explicit non-goals

- Accounts, cloud sync, or mandatory network services
- Watermarks or paid export tiers
- Telemetry
- Mobile builds in the near term
