# Supported formats and platform requirements

What LibreCut can read, what it writes, what it needs to run, and where it
keeps your files.

For problems that need fixing rather than explaining, see
[known limitations and recovery](known-limitations.md).

## Video and audio you can import

The importer accepts these extensions:

| Kind | Extensions |
| --- | --- |
| Video | `mp4`, `m4v`, `mov`, `webm`, `mkv`, `avi` |
| Audio | `mp3`, `wav`, `m4a`, `aac`, `flac`, `ogg` |
| Images | `png`, `jpg`, `jpeg`, `webp`, `bmp`, `gif`, `avif` |

The file picker offers four filters — **Video and audio**, **Video**,
**Audio**, and **Images** — which list almost the same set. `avif` is
accepted by the importer but is not in the picker filter, so import it by
dragging it onto the window.

**Codecs are FFmpeg's business, not LibreCut's.** There is no codec
whitelist. Whatever the bundled FFmpeg build can demux and decode, LibreCut
can import. The formats above are the container extensions the editor
recognises by name.

Two things to know about the source media:

- **Only the first video stream and the first audio stream of a file are
  used.** A file with several angles or several languages in it keeps only the
  first of each.
- **Rotation metadata is recorded but not applied to the picture.** A phone
  clip recorded in portrait is imported with its rotation noted, so the
  dimensions are right, but the frames are not turned for you.

### Proxies

A proxy is a lighter copy made for preview. LibreCut makes one when the
source is taller than 1080 lines, or when its video codec is not H.264, VP8,
VP9, or AV1. The copy is 1080 pixels high, or 720 for sources taller than
2160.

**A proxy only affects the preview.** The export always uses the original.

## Subtitles

`.srt` and `.vtt` files are imported from the **Text** tab of the media
panel, not through the media importer. The parser understands `hh:mm:ss.mmm`
and `mm:ss.mmm` timings with either a comma or a dot for the fraction, and
strips HTML tags from the cue text.

Exported subtitles are written as `.srt`.

## Colour lookup tables

A 3D LUT can be applied to a color filter clip:

- The file must be a **`.cube`** file.
- It must be **16 MB or smaller**.
- `LUT_3D_SIZE` must be between **2 and 64**.
- The file must contain exactly `size³` RGB samples.
- `DOMAIN_MIN` and `DOMAIN_MAX` are optional but must each hold three finite
  numbers, and `DOMAIN_MIN` must be below `DOMAIN_MAX`.
- **1D LUTs are rejected.** The message says so.

## Project, template, and plugin files

| File | What it is |
| --- | --- |
| `.librecut` | A project. UTF-8 JSON, schema version 1. See [project-format.md](project-format.md). |
| `.librectemplate` (or `.json`) | A template. See below. |
| `.json` | A plugin manifest. See [plugins.md](plugins.md). |

**Templates** are versioned: `formatVersion` must be `1`. A template carries a
name, a description, a canvas size, a frame rate, and tracks. It must not
carry media: a template with a media reference is refused with *Templates
cannot include media references.* A template may have at most 64 tracks.

**Plugin manifests** are limited to 256 KB, may hold at most 100 color
filters and 100 text styles, and must request no permissions.

## What the export writes

The export has one container and one video codec. The audio encoding is
chosen in the export dialog.

| | |
| --- | --- |
| Container | MP4 |
| Video | H.264 (`libx264` by default), `yuv420p`, constant frame rate |
| Audio | AAC (96, 128, 192, 256, or 320 kbps) or ALAC lossless; 44.1, 48, or 96 kHz; stereo |
| Audio default | AAC, 192 kbps, 48 kHz, stereo |
| Quality | CRF 27 (draft), 20 (balanced), 16 (high) |

Hardware encoders `h264_nvenc`, `h264_qsv`, and `h264_amf` exist in the
backend. The interface offers **NVENC** when the bundled FFmpeg reports it,
and **x264 · CPU (compatible)** always.

## Platform support

| Platform | Status |
| --- | --- |
| Windows 10 and 11 | Development platform. Installers are built and verified. |
| macOS (Intel) | DMG build workflow is implemented. Install, launch, editing, and export are not verified yet. |
| Linux (Ubuntu 22.04 x64) | DEB and AppImage build workflows are implemented. Install, launch, editing, and export are not verified yet. |

Windows is the only platform that has been exercised end to end. The macOS
and Linux packages exist, but treat them as previews until they have been
verified on the target system.

### What you need to run it

- **Windows 10 or 11** with the **WebView2 Evergreen** runtime. It is
  installed by default on current Windows; without it the window does not
  open.
- **macOS** or **Linux** for the preview builds, with the equivalent webview
  runtime.
- Roughly **4 GB of free disk space** for the application, the FFmpeg
  sidecars, the proxy cache, and the models.

### FFmpeg

LibreCut needs **FFmpeg** and **ffprobe**, version 9.x for the export filter
script. The installers bundle them as sidecars next to the application, so
there is nothing to install separately.

The bundled build is **FFmpeg 9.0.1**, the essentials build, and it is
pinned: the version and the SHA-256 of the archive are written down in
`scripts/fetch-ffmpeg.ps1`, and the download is refused unless the checksum
matches. Pinning is not only about provenance. FFmpeg 9.0.2 reverted a
scheduler change that made the export filter graph of a timeline with a
transition deadlock, so a newer FFmpeg would hang the export instead of
rendering it. See
[known limitations and recovery](known-limitations.md#the-export-hangs-on-a-timeline-with-a-transition).

The essentials build carries every filter, codec, and encoder LibreCut uses.
The full build adds VVC and JPEG XL, Blu-ray and SFTP sources, and FFmpeg's
own whisper filter, none of which LibreCut exposes; `pnpm fetch:ffmpeg
-Variant full` installs it at roughly 230 MB more.

The runtime is resolved in this order:

1. The `LIBRECUT_FFMPEG` and `LIBRECUT_FFPROBE` environment variables, if
   they point at a file.
2. The sidecar bundled next to the application.
3. `ffmpeg` and `ffprobe` on `PATH`.

**Settings → FFmpeg runtime** shows which of the three was used and the
version it found. Press **Recheck runtime** after you change anything.

If the runtime is missing, the first-run window, the Settings dialog, and the
export dialog all say so.

### For developers

- **Node.js 22+** and **pnpm 10+**
- **Rust 1.77+** with the MSVC toolchain and the Windows SDK
- **FFmpeg 9.x** with `ffprobe`

```powershell
pnpm install
pnpm fetch:ffmpeg
pnpm tauri dev
```

## Local AI models

The local AI tools — captions, speech, and background removal — run on your
own computer with Transformers.js. Nothing is uploaded.

- **Nothing is bundled.** A model downloads the first time you use the tool
  that needs it, from Hugging Face, and is then cached.
- **Strict offline** in the AI tools window blocks those downloads. With it
  on, a tool fails rather than reaching the network, so you need the model
  already on disk.
- Models are read from the models folder:

  ```text
  %APPDATA%\app.librecut.desktop\models\<organization>\<model>\
  ```

- Run `pnpm fetch:models` to fill it with the recommended set, or
  `pnpm fetch:models -Models organization/model` for another repository.
- Press **Refresh** in the AI tools window to rescan the folder.
- **Captions and speech support four languages**: English, Spanish,
  Portuguese, and French. This list is separate from the interface language
  in Settings.
- **Background removal works on images only.** For video, use the chroma key
  controls under **Masks**.
- AI input is capped at **25 MB**, for an image directly and for audio after
  it is extracted to mono 16 kHz.

## Where LibreCut keeps your files

| What | Windows location |
| --- | --- |
| Projects | `%APPDATA%\app.librecut.desktop\projects\` |
| AI models | `%APPDATA%\app.librecut.desktop\models\` |
| Proxies, thumbnails, export scratch files | `%LOCALAPPDATA%\app.librecut.desktop\` |
| Performance profiles | `%APPDATA%\app.librecut.desktop\reports\` |

**Your media is never copied or modified.** The project only stores the path
to each file, and the editor reads the original where it is.

A `.librecut` copy of a project holds the same paths, so moving your media
breaks the link until you re-point it. The project library in the app is the
primary copy; export a `.librecut` file to keep a portable backup.

## Privacy

- No accounts, no analytics, no telemetry, no cloud dependency.
- Media never leaves the machine.
- The only network access LibreCut makes on its own is the update check, and
  only when you turn **Check automatically** on in Settings. It contacts this
  project's GitHub Releases.
- Local AI models contact Hugging Face only when a model is missing and
  strict offline mode is off.
- The cloud AI tab sends data to the endpoint you enter, with the key you
  enter, and stores the key in memory only.

See [PRIVACY.md](../PRIVACY.md) for the full statement.
