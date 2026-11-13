# 1. Import your media

In this lesson you create a project, bring in your footage, and learn what
LibreCut does with it while you work.

## Create the project

1. Start LibreCut. The **Getting started** window opens the first time, with
   three steps and a check of the FFmpeg runtime. Press **Create a project**,
   or **Skip for now** if you would rather start from the project list.
2. On the **Projects** screen, press **New project**.
3. Fill in the dialog:
   - **Project name** — the default is `Untitled project`.
   - **Start from template** — pick one of the built-in templates, or leave
     them alone. A template sets the canvas size and frame rate.
   - **Aspect ratio** — **Landscape** (YouTube, desktop), **Vertical**
     (TikTok, Reels, Shorts), or **Square** (feed posts).
   - **Resolution** — `1080p`, `1440p`, or `4K`. The short side is the number
     in the label, so Landscape 1080p is 1920×1080 and Vertical 1080p is
     1080×1920.
   - **Frame rate** — `24 fps · cinematic`, `30 fps · standard`, or
     `60 fps · smooth`. **30 fps** is the default and the safest choice if
     you are not sure.
4. Press **Create project**.

The canvas size can be changed later without rebuilding the edit, so do not
worry about getting it exactly right now.

## Bring in your files

There are three ways in, and they all end at the same place.

- **Import media** — the button at the top of the **Media** tab opens a file
  picker. Select as many files as you like.
- **Drag and drop** — drag files onto the LibreCut window. A dashed
  **Drop to import media** panel appears over the media library while you
  drag.
- **Import more** — the button under the media grid, once you have files
  already.

The picker filters are **Video and audio**, **Video**, **Audio**, and
**Images**. You can also pick any file the operating system offers.

### What LibreCut does with a file

Each file goes through the same steps, and the editor stays usable while it
happens.

1. **Probe.** FFprobe reads the duration, the resolution, the frame rate, the
   codecs, the channel count, and the rotation. The file appears in the media
   library right away, before the rest is ready.
2. **Poster frames.** Twelve frames are pulled from a video and scaled to 180
   pixels wide. They become the strip you see across the clip. An image gets a
   single frame.
3. **Waveform.** The audio is analysed and drawn as a waveform. Audio-only
   files get a waveform instead of poster frames.
4. **Proxy.** For some sources, a lighter copy is made so scrubbing stays
   fast. See below.

A toast confirms each import: `Imported clip.mp4`.

## Read the media card

Every imported file becomes a card in the **Media** tab.

- A **thumbnail strip** for video, a **waveform** for audio, or the **image
  itself** for a still.
- Badges in the corner: an image badge for a still, a spinner while a proxy is
  being built, and `proxy` when the preview is using the lighter copy.
- The **duration** at the bottom left, as `m:ss`, or the word `image` for a
  still.
- The file name underneath.
- A `+` button in the bottom right corner. It appears when you point at the
  card. **Double-clicking the card does the same thing**: both place the clip
  on the timeline at the playhead.

Below the name you may see:

- `Possible variable frame rate · export normalizes` — the source does not
  hold a steady frame rate. The export converts it to the frame rate you pick
  in the export dialog. Small differences in timing can remain.
- `Proxy failed · Retry` — the lighter copy could not be made. The preview
  falls back to the original file, so editing still works.
- `Preview original` — switch the preview back to the full-resolution file.
- `Remove cached proxy` — delete the lighter copy and go back to the original.

## Understand proxies

A proxy is a smaller copy of your video that the editor plays back instead of
the original, so a 4K file stays responsive.

LibreCut makes a proxy when the source is **taller than 1080 lines**, or when
its video codec is **not** H.264, VP8, VP9, or AV1. Still images and
audio-only files never get one.

The copy is 1080 pixels high, or 720 for a source taller than 2160. It is
built in the background, so you can keep editing. The card shows a spinner
until it is ready.

Two things to keep in mind:

- **A proxy only changes the preview.** The export always uses the original
  file, at full resolution.
- **You can turn it off** for one file with **Preview original**, or delete the
  cached copy with **Remove cached proxy**.

## Find a file again

The **Search media** field at the top of the **Media** tab filters the library
by file name as you type. Matching is on the name only, not on the contents.

## Import subtitles separately

`.srt` and `.vtt` files are not media, so the media importer refuses them and
says so: `Subtitle files can be imported from the Text tab.`

Open the **Text** tab and press **Import .srt / .vtt**. The cues arrive as
editable text clips on the timeline. Lesson 4 covers what to do with them.

## Add a file that the picker did not show

A few formats work by drag-and-drop even when the file picker does not offer
them, because the file picker filters are a convenience rather than the rule.
`.avif` images are the one case in the current build: drop them onto the
window and they import.

If a file is refused entirely, the toast lists the first three names it did
not accept and the formats that are supported.

## Try this

Import one video, one music file, and one image. Drag the video onto a track,
and press the `+` button on the music card. Then open the **Audio** tab and
confirm the music file is listed there with its waveform.

## Gotchas

- **Re-importing the same file does nothing, and says nothing.** A file that
  is already in the project is skipped silently. If a second import seems to
  have failed, check whether the file is already there.
- **There is no "remove from library" button.** An imported file stays in the
  media panel for the life of the project. You can delete the clip on the
  timeline, but the file itself remains in the list.
- **The drop overlay only shows over the media panel**, but dropping anywhere
  in the window imports the file.
- **The media search box also filters the Audio tab**, and the Audio tab has
  no search box of its own. If the audio list looks empty, clear the search
  field on the **Media** tab first.
- **Thumbnails and waveforms can fail silently.** A file with a broken poster
  frame shows a placeholder instead of an error. The media itself is usually
  fine.

Next: [2. Cut and edit](02-cut-and-edit.md).
