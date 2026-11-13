# 5. Export the video

This lesson covers the export dialog: choosing a size and a quality, picking
an encoder, rendering the file, and reading the diagnostics when something
differs from the preview.

## Open the export dialog

Press `Ctrl+E`, or the **Export** button in the top right. The dialog opens
with the description *Choose a size and render a clean H.264 MP4. Audio is
mixed to AAC.*

You need at least one clip on the timeline. If the timeline is empty, the
dialog says *Add at least one clip to the timeline before exporting.*

## Choose the size

The **Size** group offers five buttons:

| Button | Size |
| --- | --- |
| **Match project** | The size of your canvas |
| **YouTube** | 1920×1080 |
| **TikTok / Reels** | 1080×1920 |
| **Square** | 1080×1080 |
| **4K UHD** | 3840×2160 |

The note underneath says it plainly: *Aspect ratio is applied by fitting your
canvas into the chosen size.* Choosing **Square** for a landscape project
letterboxes or crops it to fit. Choosing **Match project** keeps the framing
you built.

## Choose the frame rate and the quality

**Frame rate** offers your project's frame rate plus 24, 25, 30, 50, and 60.
The project's own rate is marked `· project`.

**Quality** has three settings:

| Setting | What it does |
| --- | --- |
| **Draft · smaller** | Quick to render, small file, visibly compressed |
| **Balanced** | The default. A good size for most edits |
| **High · larger** | Keeps more detail, and takes longer and more space |

**Estimated size** shows an approximate file size, like `~42 MB`. It is a
rough guess based on the frame size and the quality, not on your footage:
*Estimate uses frame size and quality. Motion, detail, and audio can change
the final size.*

## Save these settings for next time

Type a name into the **Name these settings** field and press **Save preset**.
The preset remembers the size, the frame rate, the quality, and the encoder.
It appears as a chip above the **Size** group; click a chip to load it.

Saved presets live on this PC only: *Saved on this PC: resolution, frame
rate, quality, and encoder.* The output path is not part of a preset.

To remove one, type its exact name into the field and press **Remove**.

## Pick the encoder

**Encoder** offers:

- **x264 · CPU (compatible)** — always available.
- **NVENC · GPU (fast)** — offered when the bundled FFmpeg reports the
  `h264_nvenc` encoder.

The note under the list says: *FFmpeg reports NVENC. It needs a compatible
NVIDIA GPU and driver; x264 remains the fallback.* If NVENC is offered and
the export fails, switch back to x264.

## Choose where the file goes

Press **Choose** and pick a destination. The file name defaults to the
project name with a `.mp4` extension, and the dialog only offers `MP4 video`.

If you do not choose a path, the file picker opens when you press **Export
video**.

## Render it

Press **Export video**. The button is replaced by *Rendering locally with
FFmpeg* and a **Cancel export** button.

While the render runs you see:

- the percentage, for example `42.3%`;
- a progress bar with the elapsed time over the total;
- the speed and the frame rate of the encode.

Pressing **Cancel export** stops FFmpeg and deletes the partial file, so the
destination is never left with a half-written video.

When the render finishes, the dialog shows **Video exported**, the output
path, the render time, and three tiles: **Canvas**, **Duration**, and
**Encoder**. Press **Show in folder** to open the folder, or **Done** to
close.

## Read the render diagnostics

The **Render diagnostics** section tells you where the render may differ from
the preview. Open it before a long export if you want to know what to expect.

It reports:

- **Sources with a different frame rate.** *"{n} sources report a frame rate
  different from the project; {m} are flagged as possibly variable frame
  rate. Export resamples them to {fps} fps; small seek or sync differences
  may remain."*
- **What is in the render.** *"Project features queued for this render:
  {k} clips with keyframes, {t} clips with transitions, and {e} color-effect
  clips."*
- **Preview against export.** *"Preview uses browser video decoding while
  export uses FFmpeg, so scaling, color processing, and font rasterization may
  differ slightly."*
- **Codecs that depend on the build.** *"{name}: {codec} may depend on the
  installed FFmpeg build."* for any source outside the common set.

## What the exported file is

- **Container:** MP4.
- **Video:** H.264, `yuv420p`, constant frame rate.
- **Audio:** AAC, 192 kbps, 48 kHz, stereo.
- The file is written to a hidden temporary name in the destination folder and
  renamed into place only after FFmpeg succeeds, so a cancelled or failed
  export never replaces a good file with a broken one.

## Try this

Export with **Match project** and **Draft · smaller**. Watch the progress
bar. Open **Render diagnostics** and read the frame-rate line. Then switch to
**High · larger**, save those settings as `Delivery`, and export again.

## Gotchas

- **The export always produces H.264 in MP4.** There is no choice of codec,
  container, audio format, bitrate, or colour depth.
- **The estimate is an estimate.** A lot of motion or a lot of detail makes
  the file larger than the number suggests.
- **A long export cannot be resumed.** If it fails near the end, the
  progress and the failure message are still in the dialog, so you can report
  them.
- **Two exports cannot run at once.** A second attempt is refused with *An
  export is already running.*
- **Export uses the original media, not the proxy.** A proxy makes the
  preview fast; it never changes the quality of the result.
- **If the export button is greyed out**, the FFmpeg runtime is missing. The
  dialog says so, and
  [formats and platform requirements](../formats-and-platforms.md) explains how
  to fix it.

## Where to go next

- [Supported formats and platform requirements](../formats-and-platforms.md)
- [Known limitations and recovery](../known-limitations.md)
- [Community preset packs](../community-presets.md)
