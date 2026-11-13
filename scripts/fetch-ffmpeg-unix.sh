#!/usr/bin/env bash
set -euo pipefail

# Fetches statically linked FFmpeg/ffprobe builds for the release runner.
# Linux uses John Van Sickle GPLv3 builds; macOS uses evermeet's static x86_64
# builds. Keep both binaries beside each other and let Tauri stage the sidecars.
#
# The macOS build is pinned to a version and a checksum. FFmpeg 9.0.2 reverted
# "fftools/ffmpeg_sched: allow throttling decoder outputs", which brought back
# a scheduler deadlock: the export filter graph of a timeline that contains a
# transition never finishes, and FFmpeg spins at full CPU without writing
# output. FFmpeg 9.0.1 renders the same graph in about a second, so that is
# what macOS bundles, and the same version the Windows build uses.
#
# The Linux build comes from a URL that follows the current release. The
# version is checked after the download, so a release that carries the
# deadlock stops the build instead of shipping a broken runtime.
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
dest="$root/src-tauri/binaries"
legal="$root/src-tauri/legal"
mkdir -p "$dest" "$legal"

macos_ffmpeg_version="9.0.1"
macos_ffmpeg_sha256="8a8c9e549983409fe6604b9aa665648b7a5def9407fe814c39c8b2ea7f64a48f"
macos_ffprobe_sha256="d13f35db03456b7f65b7edb6437c86e23810fbfe91795e571f5b77211343b4f1"

# The newest FFmpeg that renders LibreCut's export graph. Anything above it
# deadlocks on a timeline that contains a transition.
newest_supported="9.0.1"

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d' ' -f1
  else
    shasum -a 256 "$1" | cut -d' ' -f1
  fi
}

# Refuses a runtime that cannot render an export with a transition.
assert_supported_version() {
  local binary="$1"
  local version release
  version="$("$binary" -version 2>/dev/null | head -n 1 | sed -n 's/^ffmpeg version \([^ ]*\).*/\1/p')"
  if [[ -z "$version" ]]; then
    echo "Could not read the FFmpeg version of $binary" >&2
    exit 1
  fi
  # A build may carry a suffix, such as "9.0.1-tessus" or "7.0.2-static".
  # Only the release number decides, because that is what the deadlock window
  # was fixed in.
  release="$(printf '%s' "$version" | sed -E 's/^([0-9]+(\.[0-9]+)*).*/\1/')"
  if [[ ! "$release" =~ ^[0-9]+\.[0-9]+ ]]; then
    echo "FFmpeg $version is not a release build. LibreCut needs a release of $newest_supported or older." >&2
    exit 1
  fi
  if [[ "$(printf '%s\n%s\n' "$newest_supported" "$release" | sort -V | tail -n 1)" != "$newest_supported" ]]; then
    echo "FFmpeg $version is newer than $newest_supported and deadlocks on the export graph of a timeline with a transition." >&2
    echo "Pin an older FFmpeg build before packaging a release." >&2
    exit 1
  fi
  echo "FFmpeg $version is supported."
}

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
    printf 'Source: %s\nSHA-256: %s\nDownloaded: %s\n' "$url" "$(sha256_of "$tmp/ffmpeg.tar.xz")" "$(date -u +%FT%TZ)" > "$legal/FFMPEG-BUILD-INFO-linux.txt"
    ;;
  Darwin)
    [[ "$(uname -m)" == "x86_64" ]] || { echo "macOS FFmpeg sidecars currently support x86_64 only" >&2; exit 1; }
    triple="x86_64-apple-darwin"
    tmp="$(mktemp -d)"
    trap 'rm -rf "$tmp"' EXIT
    for tool in ffmpeg ffprobe; do
      url="https://evermeet.cx/$tool/$tool-$macos_ffmpeg_version.zip"
      expected="$macos_ffmpeg_sha256"
      [[ "$tool" == "ffprobe" ]] && expected="$macos_ffprobe_sha256"
      curl --fail --location --retry 3 "$url" -o "$tmp/$tool.zip"
      actual="$(sha256_of "$tmp/$tool.zip")"
      if [[ "$actual" != "$expected" ]]; then
        echo "SHA-256 verification failed for $tool. Expected '$expected', got '$actual'." >&2
        exit 1
      fi
      ditto -x -k "$tmp/$tool.zip" "$tmp/$tool"
      install -m 755 "$tmp/$tool/$tool" "$dest/$tool-$triple"
    done
    printf '%s\n' "Source: https://evermeet.cx/ffmpeg/" "Version: $macos_ffmpeg_version" "Downloaded: $(date -u +%FT%TZ)" > "$legal/FFMPEG-BUILD-INFO-macos.txt"
    ;;
  *) echo "Unsupported operating system: $(uname -s)" >&2; exit 1 ;;
esac

assert_supported_version "$dest/ffmpeg-$triple"

"$dest/ffmpeg-$triple" -version | head -n 1
"$dest/ffprobe-$triple" -version | head -n 1
