# 4. Add titles and captions

This lesson covers text: adding it, styling it, animating it, and importing
subtitles you already have.

## Add a title

Open the **Text** tab in the media panel.

- **Add text at playhead** puts a clip on a text track with the words
  `Your text`.
- The **Presets** section offers **Title**, **Subtitle**, and **Caption**.
  Click one to add it with that styling. Clicking says `Click to add`.
- A community pack adds more styles to this list. The one that ships is in
  [`presets/community/`](../../presets/community/README.md).

Text clips live on their own track, and that track can be moved, trimmed, and
hidden like any other.

## Style the text

Select the text clip and open the **Text** tab of the inspector.

| Control | What it does | Range |
| --- | --- | --- |
| **Text content** | The words themselves | — |
| **Size** | The height of the text | 8 – 300 px |
| **Color** | The fill colour | any colour |
| **Text rotation** | Turns the text on its side | −1800 – 1800° |
| **Font family** | One of the installed families | see below |
| **Weight** | **Bold** or **Regular** | — |
| **Align** | **Align left**, **Align center**, **Align right** | — |
| **Italic** | Slanted text | — |
| **Line height** | The space between lines | 0.8 – 3× |
| **Underline** | Draws a line under the text | — |
| **Character spacing** | The space between letters | −5 – 40 px |
| **Outline width** / **Outline color** | A border around the letters | 0 – 20 px |
| **Box color** / **Text box opacity** | A background panel behind the text | 0 – 100% |
| **Shadow** / **Shadow color** | A drop shadow | 0 – 100% |
| **Brightness** | Brightness of the text colour | 0 – 200% |
| **Text arc** | Curves the text along an arc | −360 – 360° |
| **Horizontal** / **Vertical** | Where the text sits on the canvas | 0 – 100% |
| **Text opacity** | How solid the text is | 0 – 100% |

**Horizontal** and **Vertical** are the position on the canvas: 0% is the left
or top edge, 50% is the middle, and 100% is the right or bottom edge.

### Fonts

The **Font family** list offers **Segoe UI**, **Arial**, **Georgia**,
**Times New Roman**, **Courier New**, **Impact**, **Trebuchet MS**, and
**Verdana**. These are the families the export can find on a Windows machine.
On another platform a family that is not installed falls back to a similar
font, so the exported result can differ slightly from the preview.

## Position the text safely

The preview has a button that draws the **title and action safe areas** — the
lines inside which text stays clear of the edges of the frame. Turn it on
while you place a title, then turn it off.

A rule of thumb: keep a lower-third title inside the bottom safe area, and
keep a headline inside the title safe area. Captions sit just above the
action safe line.

## Animate the text

The **Keyframes & animation** section of the inspector animates a text clip's
position, rotation, and opacity.

1. Choose **X**, **Y**, **Rotation**, or **Opacity** from the dropdown.
2. Press **Add key** at the start of the clip.
3. Move the playhead to the end of the clip and change the value. The second
   key is added for you.

**Fade in** and **Fade out** work on any clip. **Zoom in** works on video
clips, and **Slide in** works on video and text clips.

A text clip has no separate fade control in the inspector. Use the **Fade in**
keyframe preset above, or the opacity control, to fade a title.

## Import subtitles

If you already have a subtitle file, use the **Text** tab of the media panel:

1. Press **Import .srt / .vtt**.
2. Choose the file.

Each cue becomes an editable text clip on the timeline, positioned at the time
in the file. You can edit the wording, move the clip, and restyle it like any
other text.

A toast confirms the import: `Imported 42 editable subtitle cues.`

If nothing is imported, the file may use a format the parser does not
recognise. It reads the common `hh:mm:ss.mmm` and `mm:ss.mmm` timings, with
either a comma or a dot for the fraction.

## Export subtitles

Press **Export .srt** in the **Text** tab to write the subtitle cues to a
`subtitles.srt` file next to your project. The exported file is a separate
`.srt`; it is not burned into the video.

To burn subtitles into the picture, convert the cues into ordinary text clips
and style them, then place them over the video.

## Try this

Add a **Title** from the presets. Change the words to something of your own,
set it to **Bold**, give it an outline of 3 pixels in black, and use
**Slide in** to bring it on. Then check it against the safe-area guides, and
watch the preview play it back.

## Gotchas

- **Text clips have no audio controls.** The **Audio** tab is not shown for
  text.
- **A text clip is not a subtitle file.** Imported `.srt` cues are text clips
  that you can move and restyle, but they are no longer linked to the
  original file.
- **The canvas preview and the export can differ slightly in font rendering.**
  The canvas uses the browser's text renderer and the export uses FFmpeg's
  `drawtext` filter. Letter spacing and arc in particular can land a little
  differently. Turn on **Match export** in the preview header to see the
  paused frame exactly as FFmpeg renders it.
- **The canvas preview is capped at 1920 pixels on the long edge.** On a 4K
  project, the playing canvas shows a scaled-down frame. **Match export**
  renders the paused frame at the project resolution instead, so fine type can
  be checked without exporting.
- **Dropping media on a text track does nothing.** Media belongs on a video
  or audio track.
- **Pressing `Enter` in the project name field on the start screen creates the
  project without the template you selected.** Use the **Create project**
  button when you chose a template.

Next: [5. Export the video](05-export.md).
