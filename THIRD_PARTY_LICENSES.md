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

- The development build on this machine uses an FFmpeg build with GPL components
  enabled (`libx264`, `libx265`, `libfreetype`, etc.).
- FFmpeg is licensed under the LGPL-2.1+ by default, and GPL-2.0+ when
  GPL-only components are compiled in.
- If you distribute LibreCut with a bundled GPL FFmpeg build, the combined
  distribution must comply with the GPL. Provide the exact FFmpeg source used
  and the build configuration, and include FFmpeg's license text.
- If you distribute an LGPL FFmpeg build, include the LGPL text, provide the
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
