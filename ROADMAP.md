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

- [ ] Bundle FFmpeg as a sidecar and verify installer output
- [ ] End-to-end tests on real media
- [ ] Icon, installer polish, and first-run guidance

## v0.2 — timeline depth

- [ ] Magnetic main track and ripple edits
- [ ] Speed ramps
- [ ] More text styling and safe-area guides
- [ ] Offline model bundles so local AI can work without a first-use download
- [ ] Audio ducking and expanded EQ controls
- [ ] More audio processing and timeline automation

## v0.3 — effects and ecosystem

- [x] Color adjustments and a searchable effect preset browser
- [x] JSON effect-pack plugins
- [ ] LUT import and application
- [ ] Templates
- [ ] Broader plugin API for additional editor extension points
- [ ] Auto-update (opt-in)
- [ ] macOS and Linux builds

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
