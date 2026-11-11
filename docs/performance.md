# Performance profile

This is the baseline workload and acceptance target for v1.0 performance work.
These targets are goals, not measured claims. Record the machine, OS, WebView,
FFmpeg build, source codec, and whether the source is on SSD for every run.

## Representative projects and targets

| Profile | Media and edit size | Playback target | Editing target | Save/export target |
| --- | --- | --- | --- | --- |
| Everyday | 10 assets, 5-minute 1080p project, 300 clips across 6 tracks | 1080p proxy preview sustains project frame rate; seek settles within 250 ms | Timeline drag stays under 50 ms per frame | Autosave completes within 500 ms; 5-minute H.264 export completes within 10 minutes on reference hardware |
| Long timeline | 30 assets, 60-minute 1080p project, 2,000 clips across 12 tracks | Preview remains responsive at proxy resolution; seek settles within 500 ms | Timeline drag stays under 50 ms per frame; selection responds within 100 ms | Autosave completes within 1 s |
| 4K sources | 10 assets up to 4K, 10-minute 4K project, 500 clips across 8 tracks | Proxy playback sustains 30 fps; seek settles within 500 ms | Timeline drag stays under 50 ms per frame | Autosave completes within 1 s; 10-minute 4K H.264 export completes within 30 minutes on reference hardware |

For all profiles, target editor working-set growth under 1.5 GB above idle,
excluding FFmpeg child processes and the operating system file cache. Record
peak FFmpeg working set separately. Export time is measured against a reference
machine and must be revisited when that machine changes.

## Profiling procedure

1. Create the profile project from local media and save a clean baseline copy.
2. In a development build, open DevTools Performance and Memory panels. Record
   a 60-second idle trace, a 60-second playback trace, 20 timeline drags/seeks,
   one autosave, and one export. Take heap snapshots before and after playback.
3. Record app and FFmpeg process memory separately during proxy generation and
   export. Include cold-cache and warm-cache runs for decode and seek.
4. Repeat each action three times and report median and worst result. Keep the
   project file and measurement notes with the machine/runtime details.

Development builds log slow media probe, media analysis, aggregate import, and
project-save timings with asset/clip counts and cache sizes. The browser's
Long Tasks API reports main-thread tasks of at least 50 ms when the WebView
supports it. Preview seek timing is also logged by the preview. These signals
help locate stalls; memory, playback frame rate, timeline drag latency, and
export throughput still need to be captured in the profiling procedure above.

## Current constraints to investigate

- Project serialization and `localStorage.setItem` run synchronously during
  autosave. Large projects can stall the editor; moving durable project storage
  to an asynchronous store needs compatibility and crash-recovery design.
- Import metadata, thumbnail, and waveform work runs through async native
  commands with bounded concurrency. Proxy encoding runs in FFmpeg child
  processes with a two-job queue. Verify responsiveness and memory under the
  4K profile before raising those limits.
- Timeline drag and preview decode are separate measurements. A responsive
  proxy does not establish that a long timeline stays responsive.
