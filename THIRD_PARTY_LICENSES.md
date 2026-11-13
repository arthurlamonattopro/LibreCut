# Third-party licenses

LibreCut is licensed under GPL-3.0-only. It depends on the components below.
This file is a summary, not legal advice. Before distributing binaries, review
each component's license text and include the required notices.

## Runtime dependencies

| Component | Version | License | Notes |
| --- | --- | --- | --- |
| Tauri | 2.x | Apache-2.0 / MIT | Desktop runtime and IPC |
| WRY / Tao | 0.5x / 0.3x | Apache-2.0 / MIT | WebView host |
| React | 19.x | MIT | UI |
| React DOM | 19.x | MIT | UI |
| Zustand | 5.x | MIT | State management |
| Immer | 10.x | MIT | Immutable updates |
| clsx | 2.x | MIT | Class name utility |
| lucide-react | 0.468.x | ISC | Icons |
| tokio | 1.x | MIT | Async runtime |
| serde / serde_json | 1.x | Apache-2.0 / MIT | Serialization |
| uuid | 1.x | Apache-2.0 / MIT | Identifiers |
| base64 | 0.22 | Apache-2.0 / MIT | Thumbnail encoding |
| thiserror | 2.x | Apache-2.0 / MIT | Error types |
| percent-encoding | 2.x | Apache-2.0 / MIT | URL decoding |

## FFmpeg

LibreCut invokes a separate FFmpeg executable. FFmpeg is **not** linked into the
app and is **not** covered by LibreCut's GPL-3.0 license.

- Release builds bundle `ffmpeg.exe` and `ffprobe.exe` as Tauri sidecars next to
  the app. Development builds can use the same sidecars or a system FFmpeg.
- `scripts/fetch-ffmpeg.ps1` downloads the pinned Windows build from
  <https://github.com/GyanD/codexffmpeg/releases> (mirrored from
  <https://www.gyan.dev/ffmpeg/builds/>), verifies its SHA-256 checksum, and
  records the build information in `src-tauri/legal/FFMPEG-BUILD-INFO.txt`.
- The bundled build is **FFmpeg 9.0.1**, the essentials GPL build. The version
  and its checksum are pinned in the fetch script. FFmpeg 9.0.2 and later
  deadlock on the export filter graph of a timeline that contains a
  transition, so the version is part of the correctness of the release, not
  only a detail of provenance.
- The essentials build carries every filter, codec, and encoder LibreCut uses.
  The full build is also available with `-Variant full` and adds the encoders
  and filters LibreCut does not use; it is about 230 MB larger.
- The macOS sidecars come from <https://evermeet.cx/> and are pinned to the
  same version. The Linux sidecars come from
  <https://johnvansickle.com/ffmpeg/> and are checked against the same
  version ceiling after the download. Neither provider publishes a reduced
  variant, so only the Windows build is size-optimised.
- The fetched build enables GPL components (`libx264`, `libx265`,
  `libfreetype`, `libass`, etc.), so it is distributed under GPLv3. The GPLv3
  text is included at `src-tauri/legal/FFMPEG-GPLv3.txt`.
- A redistributed installer must keep `THIRD_PARTY_LICENSES.md`, `PRIVACY.md`,
  `LICENSE`, the FFmpeg license text, and the source offer, and must provide
  the corresponding FFmpeg source for at least three years.
- If you substitute an LGPL FFmpeg build, include the LGPL text, provide the
  corresponding source, and keep FFmpeg dynamically separate from LibreCut.

FFmpeg source and licensing: <https://ffmpeg.org/legal.html>

## Fonts

The export pipeline uses a system font (`C:\Windows\Fonts\arial.ttf` by default).
System fonts are not redistributed with LibreCut. If a future release bundles
fonts, those font licenses must be added here.

## Development-only dependencies

Node.js, pnpm, Rust, the Tauri CLI, Vite, TypeScript, Tailwind CSS, and Vitest
are used to build LibreCut and are not part of the shipped application.

## Source offer

When distributing a GPL FFmpeg build with LibreCut, include a written offer or
link to the corresponding FFmpeg source for at least three years, as required by
GPL-3.0 section 6.
