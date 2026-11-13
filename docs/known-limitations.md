# Known limitations and recovery

What LibreCut does not do, and what to do about it when it does not.

For what a file is, or what a machine needs, see
[supported formats and platform requirements](formats-and-platforms.md).

## The short version

| Symptom | What to do |
| --- | --- |
| A clip shows a broken image | The source file moved. Point the project at the new location, or restore the file where it was. |
| A project will not open | The `.bak` copy next to it is used automatically. If it will not open either, open a `.librecut` copy you exported. |
| FFmpeg is missing | Reinstall LibreCut, or set `LIBRECUT_FFMPEG` and `LIBRECUT_FFPROBE`. See [Runtime recovery](#the-ffmpeg-runtime-is-missing). |
| A proxy failed | Press **Proxy failed · Retry** on the media card. Editing continues on the original file. |
| The export failed | The dialog keeps the last progress and the FFmpeg error. Read it before retrying. |
| The export hangs | The runtime is too new. See [The export hangs](#the-export-hangs-on-a-timeline-with-a-transition). |
| The export was cancelled | Nothing was written to the destination. Start again. |

## Import and media

**Only the first video and audio stream of a file are used.** A file with
several camera angles or several audio languages keeps the first of each.
Split such a file before importing it.

**Rotation metadata is recorded but not turned.** A phone clip recorded in
portrait imports with the right dimensions, but the frames are not rotated for
you. Rotate it in the editor with the **Rotation** control on the **Video**
tab of the inspector.

**The waveform covers the first 30 minutes of a file.** A recording longer than
that shows a waveform for its first half hour only. The audio itself plays in
full.

**Thumbnails and waveforms can fail silently.** A file with an unreadable
poster frame shows a placeholder rather than an error. The media is usually
fine; the preview frame is what failed.

**A re-imported file is skipped without a message.** LibreCut compares paths,
so importing the same file twice does nothing and says nothing.

**There is no "remove from library" control.** An imported file stays in the
media panel for the life of the project. Deleting the clip on the timeline
removes the clip, not the entry.

**`.avif` cannot be picked from the file dialog.** It is not in the picker
filter. Drag it onto the window instead.

**Subtitle files are refused by the media importer** with the message
`Subtitle files can be imported from the Text tab.` Use the **Text** tab.

## The timeline

**Selection and bulk edits.** Click a clip to select it, `Ctrl`-click to add or
remove one, and `Shift`-click to select a range on the same track. Drag on empty
timeline space for a rubber-band selection. Move, delete, duplicate, and split
then apply to every selected clip.

**Tracks can be deleted and reordered.** Open the track actions menu (the
button at the right of a track header, or right-click the track) and choose
**Move track up**, **Move track down**, or **Delete track**. A locked track
cannot be deleted. The footer and toolbar both offer a `+` button for each
track kind; the footer no longer adds only video tracks.

**The magnetic main track is explicit.** A project no longer assigns the first
video track automatically. Make a track magnetic from its header or the track
menu. Inserted, split, and duplicated clips are packed in order, but ordinary
moves, trims, and deletes leave the other clips where they are. The
**Ripple** toggle is the only switch that closes a gap automatically.

**Ripple stays on the track you edited.** A ripple delete or trim on a video
track moves later clips on that video track only. Audio, text, and other tracks
keep their timing.

**Clips do not overlap on a track.** When a move or trim would cross a
neighbour, the clip settles into the nearest free gap. A clip can still be
moved between tracks of the same kind; a video clip cannot be dropped on an
audio track.

**The timeline follows the playhead.** Scroll it manually to browse, and the
view returns to the playhead when playback or an edit moves it out of sight.

**Undo restores the editing state, not only the project.** A step also restores
the selection, playhead, zoom, and the **Snap** and **Ripple** toggles.
Selecting a clip does not create a step, so `Ctrl+Z` after a click still undoes
the last real edit.

**Undo history is bounded.** The limit drops from 100 steps to 32, 16, and 8
as the project grows past 300, 800, and 2000 clips.

## The preview is not the export

The preview draws the frame in a browser canvas and plays the audio through
the Web Audio graph. The export asks FFmpeg to render the same edit. Both read
the same settings, but they are two renderers.

What this means in practice:

- **Scaling, colour processing, and font rendering can differ slightly.**
  The export dialog says this under **Render diagnostics**.
- **Exotic transitions are approximated in the preview.** The canvas paints the
  geometry; the export hands the name to FFmpeg's `xfade` filter and renders
  the real thing.
- **The preview is capped at 1920 pixels on the long edge.** On a 4K project
  the preview is scaled down, so fine detail looks different than it will in
  the export.

Check the **Render diagnostics** section of the export dialog before a long
render. It reports the frame-rate mismatches, the features in the render, and
any codec that depends on the installed FFmpeg build.

## Variable frame rate

A source whose frame rate is not steady is flagged with
`Possible variable frame rate · export normalizes`. The export converts
everything to the frame rate you chose in the export dialog and forces
constant frame rate. **Small differences in seek accuracy and audio sync can
remain.** If the sync is important, transcode the source to a constant frame
rate before importing it.

## Audio

**The export is AAC at 192 kbps, 48 kHz, stereo.** There is no choice of
audio codec, bitrate, or sample rate.

**A speed ramp is approximated.** The export renders a ramp as up to 120
constant-speed segments, so a fast ramp can sound slightly stepped.

**Ducking follows the other tracks.** It reacts to whatever else is playing
above the threshold, not to a specific clip.

**A muted track is silent in the preview and in the export.**

## Text

**The available font families are the ones a Windows machine has.** The list
is Segoe UI, Arial, Georgia, Times New Roman, Courier New, Impact, Trebuchet
MS, and Verdana. On another platform a family that is not installed falls back
to a similar font, so the exported text can differ slightly from the preview.

**Letter spacing and the text arc can land a little differently** in the
export than in the preview, for the same reason.

**Text is rendered by FFmpeg's `drawtext` filter**, which needs a font file.
Set `LIBRECUT_FONT` to point at a specific font file if the automatic choice
is not what you want.

**Imported subtitles become ordinary text clips.** They can be moved and
restyled, but they are no longer linked to the original `.srt` file.

## The export

**There is one output format.** MP4, H.264, `yuv420p`, constant frame rate,
AAC audio. No choice of container, codec, bitrate, colour depth, or alpha
channel.

**Two exports cannot run at once.** The second is refused with
`An export is already running.`

**An export cannot be resumed.** If it fails, the progress and the FFmpeg
error stay in the dialog so you can report them, and you start again.

**The size estimate is an estimate.** It is based on the frame size and the
quality, not on your footage. Motion, detail, and audio change the result.

**The export uses the original media, never the proxy.**

## The AI tools

**Nothing is bundled.** A model downloads from Hugging Face the first time you
use the tool that needs it. Turn on **Strict offline** only after the models
are on disk, or every local tool fails.

**The offline model counter only sees the models folder.** It does not know
about the download cache, so it can report `No models installed yet` after a
model has already been downloaded.

**Captions and speech cover four languages**: English, Spanish, Portuguese,
and French. This is a separate list from the interface language in Settings.

**Supertonic is English-only.** Choosing another language switches the speech
model back to MMS.

**Background removal works on images only.** For video, use the chroma key
controls under **Masks** in the inspector.

**AI input is capped at 25 MB** — directly for an image, and after extraction
to mono 16 kHz for audio.

**The cloud API key is held in memory only.** It is never written to the
project and never saved, so you retype it after every restart. Cloud
endpoints must use HTTPS, unless they are `localhost` or `127.0.0.1`.

## Recovery

### A project will not open

Project documents are written atomically. The new content is written to a
temporary file, the previous copy is kept as `.bak`, and the temporary file is
renamed into place. When a document cannot be read, the `.bak` copy is used
automatically.

If a project is still missing or unreadable:

1. Close LibreCut.
2. Open `%APPDATA%\app.librecut.desktop\projects\`.
3. Find the project folder and look for `project.json` and `project.bak`.
4. Copy `project.bak` over `project.json` and start LibreCut again.

**A `.librecut` file you exported is a better copy** if you have one. Open it
from the project list with **Open project**.

### A source file moved

A project stores the path to each file, not the file. If the media moved, the
clip shows a broken thumbnail and the preview stays empty.

1. Put the media back where the project expects it, or move the project
   folder to a machine where the paths still resolve.
2. If the file has a new home, the simplest fix is to import it again and
   replace the clip on the timeline.

Opening a project whose media is missing tells you how many files could not
be found: `3 media files could not be found.`

### The FFmpeg runtime is missing

Import, proxies, and export all need FFmpeg.

1. Open **Settings** from the sidebar of the project list and read the
   **FFmpeg runtime** section. It shows which of the three sources was used.
2. Press **Recheck runtime**.
3. If it says `Not found`, either reinstall LibreCut, or point LibreCut at
   your own build:

   ```powershell
   $env:LIBRECUT_FFMPEG = "C:\ffmpeg\bin\ffmpeg.exe"
   $env:LIBRECUT_FFPROBE = "C:\ffmpeg\bin\ffprobe.exe"
   ```

   The variables have to be set before LibreCut starts.

The first-run window and the export dialog say the same thing when the
runtime is missing.

### A proxy failed

The media card shows `Proxy failed · Retry`. Press it.

The failure does not stop you editing: the preview falls back to the original
file, which is slower on large media but works. Use **Preview original** to
switch the preview back deliberately, or **Remove cached proxy** to delete the
cached copy and start over.

### The export hangs on a timeline with a transition

**Symptom.** An export that contains a transition never finishes. The progress
stays where it was, the machine runs one core at full speed, and no file
appears at the destination. It is not a slow render; the render never ends.

**Cause.** FFmpeg 9.0.2 reverted a scheduler change
(`fftools/ffmpeg_sched: allow throttling decoder outputs`) that brought back a
deadlock in the overlay filter. The export graph of LibreCut places a clip
over another with a time-limited window, which is exactly the pattern that
deadlocks. FFmpeg 9.0.1 and older render the same graph in about a second.
The bug is in FFmpeg, not in the project.

**Fix.** Use FFmpeg 9.0.1, which is what the installers bundle.

- **In the app:** the bundled sidecars are already 9.0.1. If the export hangs,
  check **Settings → FFmpeg runtime** for the version. If it is 9.0.2 or
  newer, you are running a build that bundles the wrong runtime.
- **On your own:** point LibreCut at a 9.0.1 build with `LIBRECUT_FFMPEG` and
  `LIBRECUT_FFPROBE`, and restart the app.
- **To rebuild:** run `pnpm fetch:ffmpeg`. The script pins the version and the
  checksum, and it replaces an older or newer build that is already installed.

An export without a transition is not affected, so the hang only shows up once
a cut has a transition on it.

### An export failed

The export dialog keeps the last progress and shows the tail of FFmpeg's error
message. Read it before retrying:

- **An encoder error** usually means the hardware encoder is not usable.
  Switch **Encoder** to **x264 · CPU (compatible)** and export again.
- **A missing file error** means a source moved since the project was opened.
  Reopen the project so the paths are resolved again.
- **A filter error** usually names a filter the bundled FFmpeg does not
  support. The export dialog's **Render diagnostics** section lists the
  codecs in the project that depend on the build.

A failed export deletes its partial file, so the destination is untouched.

### An export was cancelled

Nothing was written to the destination. The render wrote to a hidden temporary
file in the destination folder and only renamed it into place after FFmpeg
succeeded, so cancelling never leaves a half-written video at your chosen
path.

### An update did not finish

The updater verifies the download before it installs, and an update that fails
leaves the current installation in place: `Update failed: {error}. Your
current installation is unchanged.` Run the check again from **Settings →
Application updates**, or download the release from the project's releases
page and install it over the existing copy.

### A project library is out of sync

**Settings → Local project storage** shows how many projects are stored. The
library index and the documents are written atomically, so a crash cannot
leave a half-written entry. If a project is missing from the list but its
folder is still on disk, open it with **Open project**.

**Settings → Clear all local projects** removes every stored project. It
cannot be undone, and it does not touch exported videos. Export a `.librecut`
copy of anything you care about before you clear anything.

### Recovering a project you did not export a copy of

The project library is the only copy of an unsaved project. The editor
autosaves it to disk about 700 milliseconds after each change, so an unsaved
project is normally already on disk. If the library itself is damaged, the
`.bak` files inside each project folder are the last good copy of that
project.

## Reporting a problem

Include:

- the LibreCut version, from **Settings** or **About**;
- the operating system and its version;
- the source codec and container, from the media panel or `ffprobe`;
- the steps to reproduce it;
- the FFmpeg message from the export dialog, if the problem is an export.

If it is a performance problem, press the **Performance** button in the top
bar and then **Save profile**. The report is written as JSON and is attached
to the issue. The procedure is in [performance.md](performance.md).
