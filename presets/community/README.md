# Community preset pack

This folder holds the preset packs that LibreCut ships. A pack is a JSON file
that the editor installs as a plugin: it adds **color filters** and **text
styles** to the editor, and it never runs code, never touches the filesystem,
and never reaches the network.

- Pack: [`librecut-community-pack.json`](librecut-community-pack.json)
- Licence: [CC0-1.0](LICENSE) — public domain, use it anywhere
- Review rules and submission process: [docs/community-presets.md](../../docs/community-presets.md)

## Install the pack

1. Open LibreCut and go to a project.
2. In the left panel, open the **Plugins** tab.
3. Press **Install plugin** and choose `librecut-community-pack.json`.
4. The pack appears under **Installed**. Leave it enabled.

Its color filters show up in the **Effects** tab and its text styles in the
**Text** tab, next to the built-in ones. Both are labelled with the pack name,
so it is always clear which presets came from the community.

## What is in the pack

`librecut-community-pack.json` — API `1.0.0`, 20 color filters and 5 text
styles.

### Color filters

A color filter is a clip of its own on a **misc** track. It sits over the
video for as long as it lasts, so drop it on a track above your footage and
trim it to the section you want to grade.

| Name | Category | Settings | What it is for |
| --- | --- | --- | --- |
| Lift shadows | Basic | brightness `0.10`, contrast `1.03` | Opens up dark footage without touching the highlights. A safe first grade for indoor video. |
| Matte contrast | Basic | contrast `1.18`, saturation `0.92` | Firm but natural contrast. Good for talking-head footage that looks flat on a phone screen. |
| Halation | Basic | brightness `0.05`, blur `0.80`, saturation `1.04` | A soft glow around bright areas. Reads as a diffused lens. |
| Slow shutter | Basic | motion blur `0.55` | Smears movement. Use on a short accent, not over a whole scene. |
| Clean daylight | Color | saturation `1.08`, contrast `1.05`, brightness `0.02` | Neutral, slightly punchy correction for overcast outdoor footage. |
| Muted teal | Color | saturation `0.85`, hue `8`, contrast `1.08` | Desaturated with a cool push. A calm documentary look. |
| Warm highlights | Color | sepia `0.10`, saturation `1.12`, brightness `0.03` | Adds warmth without going full sepia. Good for indoor autumn light. |
| Cool shadows | Color | hue `-10`, saturation `0.95`, contrast `1.06` | Pushes the shadows blue. Pairs well with Warm highlights. |
| Citrus punch | Color | saturation `1.25`, hue `14`, contrast `1.05` | Strong, saturated colour. Loud by design. |
| Slate mono | Color | saturation `0.15`, contrast `1.12`, brightness `0.02` | Almost black and white, but keeps a trace of colour so skin tones do not go grey. |
| Faded print | Vintage | sepia `0.20`, saturation `0.70`, contrast `0.90`, brightness `0.04` | Lifted blacks and soft contrast, like an old print. |
| Warm archive | Vintage | sepia `0.35`, saturation `0.80`, vignette `0.30` | Heavier sepia with a dark frame. |
| Photo memory | Vintage | sepia `0.12`, saturation `0.85`, contrast `0.95`, vignette `0.18` | The lightest of the vintage grades. Hardly looks graded at all. |
| Night grade | Cinematic | brightness `-0.08`, contrast `1.15`, saturation `0.90`, vignette `0.30` | Darkens and cools the frame. Use with a slight lift if the shadows go too far. |
| Steel and shadow | Cinematic | hue `-6`, saturation `0.82`, contrast `1.20`, vignette `0.28` | Desaturated and hard. A cold industrial look. |
| Warm bloom | Cinematic | brightness `0.06`, blur `0.40`, sepia `0.12`, saturation `1.08` | Warm light with a soft bloom. Suits golden-hour footage. |
| High burn | Cinematic | contrast `1.35`, brightness `-0.04`, saturation `0.85` | Crushed contrast with a slightly bleached midtone. |
| Hazy bloom | Dream | brightness `0.06`, blur `1.40`, saturation `0.95`, contrast `0.94` | Strong soft focus. Deliberately dreamy. |
| Sugar wash | Dream | saturation `0.72`, brightness `0.12`, contrast `0.90`, blur `0.50` | Pale and pastel, with a soft edge. |
| Silk fade | Dream | saturation `0.88`, brightness `0.09`, contrast `0.95`, sepia `0.06` | The mildest dream grade. Barely noticeable on its own. |

### Text styles

A text style sets the typography of a new text clip. Click one in the **Text**
tab and it drops onto the timeline ready to edit; every setting stays editable
in the inspector afterwards.

| Name | Sample | Settings | What it is for |
| --- | --- | --- | --- |
| Lower third | `NAME` | size `44`, white, left, outline `2` | A name strap in the lower third of the frame. |
| Chapter card | `CHAPTER ONE` | size `72`, bold, centred, spacing `8` | A section break. The wide letter spacing keeps it readable over busy footage. |
| Subtitle bar | `Your subtitle here` | size `34`, translucent black box, line height `1.20` | Readable captions that survive a busy background. |
| Small caption | `Add a caption` | size `28`, faint black box | A quiet caption for a corner of the frame. |
| Serif quote | `A new perspective` | size `52`, Georgia, italic, centred | A pull quote over still imagery. |

## How the filters behave

The filters are applied to the composited frame, not to the source file. The
preview shows them in the canvas compositor and the export renders the same
values through FFmpeg, so a grade looks the same in both — but the preview
approximates the transition geometry and the export renders the real filter.
See [docs/known-limitations.md](../../docs/known-limitations.md).

Adjust anything after applying a filter: the clip opens in the inspector with
**Quick effects**, **Color filters**, and **3D LUT** sections, and every value
can be moved from the preset's starting point.

## Editing the pack

The pack is plain JSON. Change a value and bump `version` to publish an
update. To install an updated pack, remove the installed one first with the
**Remove** button in the **Plugins** tab — installing a pack whose ID is
already present is refused. Keep the manifest inside the limits the plugin
format sets: an ID of 3–64 lowercase characters, a name of up to 80
characters, a description of up to 240 characters, and at most 100 filters and
100 text styles.

Contributions are welcome. Read
[docs/community-presets.md](../../docs/community-presets.md) first: it lists the
review criteria a preset has to meet before it ships, and the licence your
contribution is dedicated under.
