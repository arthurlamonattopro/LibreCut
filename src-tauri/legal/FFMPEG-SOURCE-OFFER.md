# FFmpeg source offer

LibreCut release builds bundle a separate FFmpeg executable. FFmpeg is not
linked into LibreCut and remains under its own license.

The bundled Windows build is fetched by `scripts/fetch-ffmpeg.ps1` from
<https://www.gyan.dev/ffmpeg/builds/>. The fetch script records the archive
name, SHA-256 checksum, and build README next to the binaries. The bundled
build enables GPL components (including libx264), so it is distributed under
the GNU General Public License version 3.

- FFmpeg source: <https://ffmpeg.org/download.html>
- FFmpeg licensing: <https://ffmpeg.org/legal.html>
- GPLv3 text: [FFMPEG-GPLv3.txt](FFMPEG-GPLv3.txt)
- Build provider: <https://www.gyan.dev/ffmpeg/builds/>

If you redistribute a LibreCut installer, keep this file, the FFmpeg license
text, and the build information with the installation, and provide the
corresponding FFmpeg source for at least three years as required by GPLv3
section 6.
