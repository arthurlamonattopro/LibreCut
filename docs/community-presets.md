# Community presets

LibreCut ships with 32 built-in color filters and 3 built-in text styles. The
community pack adds to that list. This page explains what a preset pack is,
what a preset has to pass before it ships, how a submission is reviewed, and
the licence the presets are published under.

The pack that ships today lives in
[`presets/community/`](../presets/community/README.md).

## What a preset pack is

A preset pack is a **JSON plugin manifest**. Installing one adds named color
filters and named text styles to the editor. That is the entire format: a
pack is a list of settings, and the editor maps them onto its own controls.

The plugin API is described in [plugins.md](plugins.md). The parts that matter
for a community pack:

- A pack declares `manifestVersion: 2`, `apiVersion: "^1.0.0"`, and
  `permissions: []`. **The current API grants no permissions at all**, and a
  manifest that asks for one is refused.
- A pack contains **no code**. It cannot execute JavaScript, and it has no
  filesystem, network, project, or process access.
- A pack is limited to 256 KB, 100 color filters, and 100 text styles.
- The filter settings it may use are fixed: brightness, contrast, saturation,
  hue, sepia, blur, vignette, motion blur, fade in, and fade out. The text
  settings it may use are fixed as well: size, colour, weight, italic, family,
  alignment, underline, character spacing, line height, outline, background,
  brightness, shadow, and arc.

A pack therefore cannot do anything the built-in inspector cannot already do.
That is the point: the community contributes **starting points**, not new
capabilities.

Installing a pack does not replace an existing one. LibreCut refuses a pack
whose ID is already installed — `A plugin with this ID is already installed.`
Remove the old pack from the **Plugins** tab first, then install the new
file.

## Where presets are used

- A **color filter** is a clip on a **misc** track. It grades the composited
  frame beneath it for as long as it lasts.
- A **text style** sets the typography of a new text clip.

Both stay fully editable after they are applied. A preset is a starting point,
not a locked look.

## Curation criteria

Every preset that ships is checked against the same list. A preset that fails
any of these is either changed or declined.

### The rule

1. **It is data only.** No code, no script, no URL, no embedded file, no
   reference to anything outside the manifest.
2. **It asks for no permissions.** `permissions` stays an empty array.
3. **It declares a supported API.** `apiVersion` is a range the current build
   understands, normally `^1.0.0`.
4. **It fits the format.** A valid ID, a name and description inside the
   length limits, and at least one filter or text style.
5. **Every setting is inside the allowed range.** Out-of-range numbers are
   refused at install time, which is a bad first impression for a user.
6. **It adds something the built-ins do not.** There are already 32 built-in
   filters. A preset that is a re-skin of *Teal & orange* or *Golden hour* is
   noise in the list.
7. **It is named for what it does, not for what it evokes.** "Cool shadows" is
   fine. "Casablanca", "Avengers grade", and "Kodak Portra" are not: they
   either promise a look LibreCut cannot deliver or borrow another company's
   name.
8. **It does not need a document to explain.** A user should be able to read the
   name, drop the preset on the timeline, and understand what changed.
9. **It carries no third-party material.** No LUT files, fonts, textures,
   presets from another editor, or brand assets. The format has no field for
   them.
10. **It has a written rationale.** Every shipped preset has a line in
    [`presets/community/README.md`](../presets/community/README.md) saying what
    it is for and when to reach for it.

### What "reviewed" means in practice

A reviewer opens the submitted manifest and:

- installs it in a clean LibreCut profile and confirms it is accepted without
  an error badge;
- applies every filter and every text style to a clip and checks the result in
  the preview canvas;
- renders a short export with the presets applied and confirms the exported
  frame matches the preview;
- compares the names and values against the built-in list and against the
  other community presets, and declines near-duplicates;
- checks that the settings stay inside the ranges the inspector allows, so the
  preset does not need correcting after the fact;
- reads the rationale and rejects anything unclear or promotional.

The review is recorded in the pull request. A preset that needs a better name
or a narrower range comes back with the reason, and the contributor revises
it. A preset that duplicates a built-in is declined with the name of the
built-in it overlaps.

## Licensing

**The preset values are public domain, under CC0 1.0 Universal
([SPDX](https://spdx.dev/licenses/CC0-1.0.html)).** The full notice is in
[`presets/community/LICENSE`](../presets/community/LICENSE).

That is deliberate. A preset is a handful of numbers and colour values. Making
them copyleft would force anyone who used them in a project to treat the
result as a derivative work of a GPL project, which is exactly the friction
this project exists to remove. With CC0 you can take a preset, change it, put
it in your own pack, and ship it in a commercial project, without attribution
and without asking.

The licence boundary is explicit:

| Artefact | Licence |
| --- | --- |
| Preset values in `presets/community/` | CC0-1.0 (public domain) |
| LibreCut source code | GPL-3.0-only |
| Documentation in `docs/` | GPL-3.0-only |

The two are separable. Installing a community pack does not make your project
a derivative work of LibreCut, and it puts no obligation on the video you
export.

Contributors dedicate their submissions to the public domain under CC0 1.0
when they open the pull request, the same way the rest of the project is
contributed under GPL-3.0-only. There is no CLA to sign and no copyright
assignment: the dedication happens with the contribution.

## Contributing a preset

1. **Check for duplicates.** Search the built-in list in the **Effects** tab
   and the existing community pack. A variation that is genuinely different is
   welcome; a rename is not.
2. **Write the manifest.** Copy `presets/community/librecut-community-pack.json`
   as a starting point, or write a new file from the example in
   [plugins.md](plugins.md).
3. **Keep it small.** One idea per preset, and a short list of settings.
   A preset that sets twelve values at once is harder to review and harder to
   use.
4. **Name it for the effect.** "Lift shadows", not "The Best Grade Ever".
5. **Write the rationale.** One or two sentences: what it does, and when to
   reach for it. This goes into the pack README.
6. **Test it.** Install the pack in LibreCut, apply every preset, and export a
   short clip that uses them.
7. **Open a pull request** with the manifest, the rationale, and a note that
   you dedicate the contribution under CC0 1.0.

### What a submission looks like when it ships

Every shipped preset has:

- a name that describes the effect;
- a category from the built-in set — `Basic`, `Color`, `Vintage`,
  `Cinematic`, `Dream`;
- values inside the allowed ranges;
- a rationale in the pack README;
- a mention in the pack's `version` bump.

`tests/community-presets.test.ts` keeps the shipped packs honest: it parses
every manifest in `presets/community/` with the editor's own plugin parser, so
a pack that the editor would reject cannot be committed.

## Reporting a problem with a preset

Open an issue with the preset name and what it does instead of what you
expected. If a preset renders differently from its description, that is a bug
in the preset and it gets corrected or pulled.
