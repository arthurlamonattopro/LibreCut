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
2. Open the editor and press the **Performance** button in the top bar. The
   panel shows live measurements and refreshes every two seconds.
3. Record a 60-second idle trace, a 60-second playback trace, 20 timeline
   drags/seeks, one autosave, and one export. Take heap snapshots before and
   after playback.
4. Press **Save profile** to write a JSON report into the app data folder.
   Attach it to the notes so the numbers can be compared over time.

The panel reports the measurements the targets above are written against:

| Measurement | What it covers |
| --- | --- |
| `timeline drag` | Time spent handling a pointer move during a clip drag |
| `preview seek` | Time to position the media elements after a seek |
| `project save` | Time to write the project to disk |
| `memory.working-set` | Editor working set, with the JavaScript heap and the native process memory reported separately |
| `memory.ffmpeg-working-set` | Working set of the FFmpeg children LibreCut spawned |

Long-task warnings, media probe timings, media analysis timings, and aggregate
import timings are also logged to the developer console in development builds.

## Where the time goes

The editor keeps its per-frame and per-interaction work proportional to what
is on screen rather than to the size of the project:

- **Timeline.** Only the clips inside the visible scroll window are rendered.
  Snap boundaries are sorted once per project and searched with a binary
  search, so a drag does not rebuild a candidate list per pointer move.
- **Preview.** Media elements are pooled for the clips around the playhead
  rather than for every clip in the project. The active clips are found with a
  binary search over a per-track index instead of scanning all clips per frame.
- **Project storage.** The editable document is stored on disk and written
  asynchronously. Poster frames and waveforms are regenerable caches and live
  in a separate file, so an edit only re-serializes the clips that changed.
- **Background media work.** Thumbnail, waveform, and proxy jobs run as
  FFmpeg child processes with a bounded thread count, so they cannot starve
  the editor of CPU while a 4K source is prepared.

