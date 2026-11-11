# Project format (`.librecut`)

A LibreCut project is a UTF-8 JSON document. The current schema is version 1.
The same structure is used for autosave in local storage and for portable
`.librecut` files.

```jsonc
{
  "schemaVersion": 1,
  "id": "0f0b6f2e-...",
  "name": "My project",
  "width": 1920,
  "height": 1080,
  "fps": 30,
  "createdAt": 1760000000000,
  "updatedAt": 1760000000000,
  "assets": [],
  "tracks": []
}
```

## Top-level fields

| Field | Type | Notes |
| --- | --- | --- |
| `schemaVersion` | `1` | Must be exactly `1` for this release |
| `id` | string | UUID, stable identity for autosave |
| `name` | string | Display name |
| `width`, `height` | integer | Canvas size in pixels |
| `fps` | number | Timeline/export frame rate |
| `createdAt`, `updatedAt` | number | Unix ms |
| `assets` | `Asset[]` | Imported media |
| `tracks` | `Track[]` | Ordered top to bottom |

## Asset

```jsonc
{
  "id": "uuid",
  "name": "clip.mp4",
  "path": "C:\\Media\\clip.mp4",
  "mediaId": "runtime-id",
  "previewMediaId": "runtime-id",
  "proxyId": "runtime-id",
  "proxyStatus": "none | generating | ready | failed",
  "info": {
    "name": "clip.mp4",
    "path": "C:\\Media\\clip.mp4",
    "duration": 12.5,
    "width": 3840,
    "height": 2160,
    "fps": 29.97,
    "rotation": 0,
    "videoCodec": "hevc",
    "audioCodec": "aac",
    "audioChannels": 2,
    "sampleRate": 48000,
    "hasVideo": true,
    "hasAudio": true,
    "sizeBytes": 123456789,
    "isImage": false
  },
  "thumbnails": ["data:image/jpeg;base64,..."],
  "waveform": [-0.5, 0.5, ...],
  "importedAt": 1760000000000
}
```

Notes:

- `path` is the original file. LibreCut never rewrites source media.
- `mediaId`, `previewMediaId`, and `proxyId` are runtime registry handles. They
  are re-created on load and are not meaningful across sessions.
- `waveform` is interleaved min/max pairs, normalized to `[-1, 1]`.
- `thumbnails` are base64 JPEG data URLs. Large projects may omit them; the UI
  falls back to a placeholder.

## Track

```jsonc
{
  "id": "uuid",
  "kind": "video | audio | text",
  "name": "Video 1",
  "muted": false,
  "hidden": false,
  "locked": false,
  "clips": []
}
```

Tracks are rendered in array order. `hidden` hides video/text; `muted` silences
audio; `locked` blocks edits to clips on that track.

## Clip

```jsonc
{
  "id": "uuid",
  "kind": "video | audio | text",
  "name": "clip.mp4",
  "assetId": "uuid or omitted for text",
  "start": 4.0,
  "duration": 6.0,
  "trimIn": 2.0,
  "speed": 1.0,
  "volume": 1.0,
  "opacity": 1.0,
  "fit": "contain | cover",
  "text": {
    "text": "Your text",
    "x": 0.5,
    "y": 0.5,
    "size": 72,
    "color": "#FFFFFF",
    "fontWeight": "normal | bold",
    "align": "left | center | right"
  }
}
```

| Field | Meaning |
| --- | --- |
| `start` | Timeline position in seconds |
| `duration` | Timeline length in seconds (after speed) |
| `trimIn` | Source offset in seconds |
| `speed` | Playback rate, 0.25–4.0 |
| `volume` | Linear gain, 0 is silent |
| `opacity` | 0–1, video/image only |
| `fit` | `contain` letterboxes, `cover` crops |
| `text` | Present for text clips only; `x`/`y` are 0–1 canvas fractions |

Source length consumed for a clip is `duration * speed` (except images, which
ignore speed and hold for `duration`).

## Compatibility rules

- Unknown fields are preserved by readers but may be dropped on save.
- `schemaVersion` must be handled explicitly. A future version 2 must include a
  migration; older builds should refuse to open it rather than guess.
- The Rust `save_project` command rejects invalid JSON before writing.

## Atomic save

`Save copy` writes:

1. `name.librecut.bak` ← existing `name.librecut` (if present)
2. `name.librecut.tmp` ← new JSON
3. remove `name.librecut`
4. rename `name.librecut.tmp` → `name.librecut`

If the app crashes mid-save, the previous file is still available as `.bak`.
