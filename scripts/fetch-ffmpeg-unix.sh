#!/usr/bin/env bash
set -euo pipefail

# Fetches statically linked FFmpeg/ffprobe builds for the release runner.
# Linux uses John Van Sickle GPLv3 builds; macOS uses evermeet's static x86_64
# builds. Keep both binaries beside each other and let Tauri stage the sidecars.
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
dest="$root/src-tauri/binaries"
legal="$root/src-tauri/legal"
mkdir -p "$dest" "$legal"

case "$(uname -s)" in
  Linux)
    arch="$(uname -m)"
    case "$arch" in
      x86_64) archive="ffmpeg-release-amd64-static.tar.xz"; triple="x86_64-unknown-linux-gnu" ;;
      aarch64|arm64) archive="ffmpeg-release-arm64-static.tar.xz"; triple="aarch64-unknown-linux-gnu" ;;
      *) echo "Unsupported Linux architecture: $arch" >&2; exit 1 ;;
    esac
    url="https://johnvansickle.com/ffmpeg/releases/$archive"
    tmp="$(mktemp -d)"
    trap 'rm -rf "$tmp"' EXIT
    curl --fail --location --retry 3 "$url" -o "$tmp/ffmpeg.tar.xz"
    tar -xJf "$tmp/ffmpeg.tar.xz" -C "$tmp"
    bin="$(find "$tmp" -type f -name ffmpeg -print -quit | xargs -r dirname)"
    test -x "$bin/ffmpeg" && test -x "$bin/ffprobe"
    install -m 755 "$bin/ffmpeg" "$dest/ffmpeg-$triple"
    install -m 755 "$bin/ffprobe" "$dest/ffprobe-$triple"
    for license in GPLv3.txt readme.txt; do
      if [[ -f "$bin/$license" ]]; then cp "$bin/$license" "$legal/FFMPEG-$license"; fi
    done
    printf 'Source: %s\nDownloaded: %s\n' "$url" "$(date -u +%FT%TZ)" > "$legal/FFMPEG-BUILD-INFO-linux.txt"
    ;;
  Darwin)
    [[ "$(uname -m)" == "x86_64" ]] || { echo "macOS FFmpeg sidecars currently support x86_64 only" >&2; exit 1; }
    triple="x86_64-apple-darwin"
    tmp="$(mktemp -d)"
    trap 'rm -rf "$tmp"' EXIT
    for tool in ffmpeg ffprobe; do
      curl --fail --location --retry 3 "https://evermeet.cx/ffmpeg/getrelease/$tool/zip" -o "$tmp/$tool.zip"
      ditto -x -k "$tmp/$tool.zip" "$tmp/$tool"
      install -m 755 "$tmp/$tool/$tool" "$dest/$tool-$triple"
    done
    printf '%s\n' 'Source: https://evermeet.cx/ffmpeg/' "Downloaded: $(date -u +%FT%TZ)" > "$legal/FFMPEG-BUILD-INFO-macos.txt"
    ;;
  *) echo "Unsupported operating system: $(uname -s)" >&2; exit 1 ;;
esac

"$dest/ffmpeg-$triple" -version | head -n 1
"$dest/ffprobe-$triple" -version | head -n 1
