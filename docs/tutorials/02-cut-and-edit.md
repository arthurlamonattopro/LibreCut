# 2. Cut and edit

This lesson covers the timeline: getting clips onto it, cutting them, moving
them, and adding transitions, effects, and speed changes.

## Know the timeline

The timeline runs along the bottom of the editor.

- The **ruler** across the top shows the timecode.
- The **Tracks** column on the left holds one row per track, with buttons to
  mute, hide, lock, and duck it.
- The **playhead** is the vertical line. The timecode readout in the toolbar
  shows its position as `00:00:04:12`, in hours, minutes, seconds, and frames.
- The toolbar above it holds **Undo**, **Redo**, **Split**, a delete button,
  the **Snap** and **Ripple** toggles, four buttons to add tracks, **Filter**,
  and the zoom controls.

There are four kinds of track, and each has a badge: `V1` for video, `A1` for
audio, `T1` for text, and `M1` for **misc**. A misc track is where color
filters live.

## Put a clip on the timeline

- **Drag** a card from the media panel onto a track. The clip lands where you
  dropped it.
- **Double-click** a card, or press its `+` button, to place it at the
  **playhead**.
- The clip goes to a track of the right kind. Drop a video on an audio track
  and it goes to a video track instead.

To add a track, use the four `+` buttons in the toolbar — **Add video track**,
**Add audio track**, **Add text track**, **Add misc track**. The **Add track**
button at the bottom left always adds a video track.

## The main track

The first video track is the **magnetic main track**, marked with a `MAIN`
badge. You can move the magnet to another video track from the track header.

The main track behaves like a slide reel:

- Its clips stay packed. Any gap you leave is closed and the clips are
  repacked from the start.
- Deleting or trimming a clip on it always shifts the later clips, even when
  **Ripple** is off.

This is what you want for a main narrative, and what you do not want for
overlapping inserts. Put alternate takes on a second video track.

## Cut a clip

1. Click the clip to select it.
2. Move the playhead where you want the cut.
3. Press **Split** in the toolbar, or press `S`.

The cut has to land more than a moment inside the clip; right at the edge
nothing happens.

> **Split splits the selected clip.** If you have a clip selected and the
> playhead is somewhere else, `S` does nothing. Clear the selection with
> `Escape` and `S` splits the first clip under the playhead instead.

## Trim a clip

Drag the left or the right edge of a clip. The edge follows the pointer and
snaps to neighbouring clips.

- A clip cannot get shorter than a tenth of a second.
- The end cannot run past the end of the source file.
- The start cannot run before the beginning of the source file.

You can also type exact numbers in the inspector: **Start** and **Duration**
are both editable fields.

## Move a clip

Drag the middle of a clip. The clip follows the pointer and snaps to
neighbouring clip edges and to the playhead.

- A clip can only be moved to a track of the **same kind**. Drop a video on
  an audio track and it stays where it was.
- The move to another track happens when you **release** the pointer, not
  while you drag.
- On the main track, a clip may jump to a different position after you drop
  it, because the track repacks.

## Delete a clip

Select it and press `Delete`, or press the trash button in the toolbar. The
same clip can also be removed from the inspector with **Remove clip**.

If **Ripple** is on, later clips on every unlocked track move up to close the
gap. **Ripple** is off by default.

## Snap

**Snap** is on by default. It pulls a dragged edge to the nearest clip start
or end, to zero, or to the playhead, when it is within about nine pixels on
screen. Turn it off with the **Snap** button when you want to place a clip at
an exact time.

The keyboard nudges never snap: they always move by an exact amount.

## Zoom

The zoom controls are on the right of the toolbar: **Zoom out**, a slider,
**Zoom in**, and **Fit**. **Fit** shows the whole timeline. `+` and `-` zoom
in steps from anywhere in the editor.

## Undo and redo

`Ctrl+Z` undoes, `Ctrl+Y` or `Ctrl+Shift+Z` redoes. Undo works on every
edit: moves, trims, splits, deletions, track changes, and inspector edits.

Undo takes the whole project back one step, and it drops the current
selection. Clicking a clip also records a step, so the first `Ctrl+Z` after a
click can look like it did nothing. Press it again if you expected a change.

## Add a transition

A transition belongs to the **cut** between two clips, not to one clip.

1. Select the clip on the **right** of the cut you want.
2. Open the **Transitions** tab in the inspector.
3. Choose **Into this clip** or **Out of this clip**.
4. Pick a transition from the gallery, then set **Duration** with the slider
   or the `0.15s`, `0.3s`, `0.5s`, and `1s` buttons.
5. Press **Apply to all cuts on this track** to put the same transition on
   every cut on that track.

The gallery is grouped into **Cross fades**, **Wipes**, **Slides**, **Irises**,
**Slices**, and **Effects**. If an edge has no neighbour, the transition fades
against the background instead of crossing over.

## Add a color filter

Open the **Effects** tab in the media panel and click a preset. It lands on a
misc track at the playhead, five seconds long, and grades everything under
it.

Trim the filter clip to control how much of the timeline it covers, and open
it in the inspector to adjust **Brightness**, **Contrast**, **Saturation**,
**Hue**, **Sepia**, **Blur**, **Vignette**, **Motion blur**, and the fades.

The **Filter** button in the timeline toolbar adds an empty color filter clip
if you would rather start from nothing.

The community pack in
[`presets/community/`](../../presets/community/README.md) adds more filters
and text styles to this list.

## Change the speed

Select a clip and open the **Speed ramp** section of the inspector.

- **Speed** sets a constant rate between `0.25×` and `4×`.
- **Ramp up**, **Ramp down**, **Bullet time**, and **Whip** add a ramp with
  editable points.
- Drag a point on the graph to change it, click empty space to add a point,
  and double-click a point to remove it.
- **Add point at playhead** puts a point where the playhead is.
- **1×** clears the ramp and returns the clip to normal speed.

## Animate a property

The **Keyframes & animation** section of the inspector animates position,
scale, rotation, opacity, and volume.

1. Choose the property from the dropdown.
2. Press **Add key** — the key lands at the playhead.
3. Move the playhead and change the value. LibreCut adds the next key for
   you.

**Fade in**, **Zoom in**, **Slide in**, and **Fade out** add a ready-made
animation instead. **Zoom in** is offered for video clips, **Slide in** for
video and text clips, and **Fade in** and **Fade out** for every clip.

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| `Space` | Play or pause |
| `S` | Split at the playhead |
| `Delete` | Delete the selected clips |
| `Ctrl+A` | Select every clip |
| `Ctrl+Z` / `Ctrl+Y` | Undo and redo |
| `Ctrl+D` | Duplicate the selected clip |
| `Ctrl+S` | Save a `.librecut` copy of the project |
| `Ctrl+E` | Open the export dialog |
| `←` / `→` | Move the playhead one frame |
| `Shift+←` / `Shift+→` | Move the playhead one second |
| `Home` / `End` | Jump to the start or the end |
| `+` / `-` | Zoom the timeline |
| `Escape` | Clear the selection |
| `Alt+←` / `Alt+→` | Focus the previous or next clip on the track |
| `Alt+↑` / `Alt+↓` | Focus the track above or below |
| `Ctrl+←` / `Ctrl+→` | Move the focused clip one frame |
| `Ctrl+Shift+←` / `Ctrl+Shift+→` | Move the focused clip one second |
| `Ctrl+Alt+←` / `Ctrl+Alt+→` | Trim the focused clip |

## Try this

Put three clips on the main track, trim the first one, split the second in
the middle, and put a crossfade on the cut between the second and the third.
Then add a color filter over the last clip only, and watch the preview.

## Gotchas

- **Multi-select works with the usual modifiers.** `Ctrl`-click adds or removes
  a clip, `Shift`-click selects a range, and dragging on empty timeline space
  draws a rubber band. Bulk delete, duplicate, split, and move apply to the
  whole selection.
- **The main track is explicit.** Make a video track magnetic from its header
  if you want clips packed in order when they are inserted, split, or
  duplicated. Ordinary moves, trims, and deletes leave it alone unless
  **Ripple** is on.
- **Ripple stays on the edited track**, so a cut on a video track does not pull
  the audio or titles with it.
- **Clips cannot overlap.** If a move or trim would cross a neighbour, the clip
  settles into the nearest free gap.
- **Tracks can be deleted and reordered** from the track actions menu. Locked
  tracks cannot be deleted.
- **The timeline follows the playhead**, so it scrolls back to the edit point
  after a long jump or during playback.
- **`Space` does not start playback when a button has focus** — the button is
  pressed instead. Click on empty timeline space first.

Next: [3. Mix the audio](03-audio.md).
