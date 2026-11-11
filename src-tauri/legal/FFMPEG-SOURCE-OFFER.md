# FFmpeg source offer

LibreCut release builds bundle a separate FFmpeg executable. FFmpeg is not
linked into LibreCut and remains under its own license.

The bundled Windows build is fetched by `scripts/fetch-ffmpeg.ps1` from
<https://www.gyan.dev/ffmpeg/builds/>. The Linux build is fetched by
`scripts/fetch-ffmpeg-unix.sh` from John Van Sickle's static GPLv3 builds at
<https://johnvansickle.com/ffmpeg/>. The macOS x86_64 build is fetched from
<https://evermeet.cx/ffmpeg/>. Build information is recorded alongside each
platform's binaries. These builds include GPL components and are distributed
under GPLv3 terms.

- FFmpeg source: <https://ffmpeg.org/download.html>
- FFmpeg licensing: <https://ffmpeg.org/legal.html>
- GPLv3 text: [FFMPEG-GPLv3.txt](FFMPEG-GPLv3.txt)
- Windows build provider: <https://www.gyan.dev/ffmpeg/builds/>
- Linux build provider: <https://johnvansickle.com/ffmpeg/>
- macOS build provider: <https://evermeet.cx/ffmpeg/>

If you redistribute a LibreCut installer, keep this file, the FFmpeg license
text, and the build information with the installation, and provide the
corresponding FFmpeg source for at least three years as required by GPLv3
section 6.
