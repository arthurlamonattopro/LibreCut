# LibreCut plugin API

LibreCut plugins are declarative JSON files. The editor validates each file and
only maps the data onto built-in features. Plugins do not execute JavaScript or
WASM and have no filesystem, network, project, or process access. The current
API grants no permissions; `permissions` must be an empty array.

## Compatibility and stability

The stable plugin API is `1.0.0`. A v2 manifest declares `apiVersion` as an
exact version or a `^`/`~` semver range. LibreCut checks the range during install
and load. A major API change will use a new major version, and existing manifest
versions remain readable when supported. Manifest v1 effect packs are still
accepted and treated as requesting `^1.0.0` with no permissions. Invalid or
incompatible installed plugins are disabled with a visible error; remove and
install a compatible replacement to recover.

## Extension points

- `effects`: named presets composed of the built-in color effect controls.
- `textPresets`: named text styles with sample text and a safe subset of text
  formatting options. They appear in the Text tab and create ordinary editable
  text clips.

Only declared keys and bounded values are accepted. No custom UI, renderer,
timeline hooks, arbitrary filters, or executable callbacks are supported in API
1.0.0. New extension points will be added through versioned manifest fields.

## Manifest v2 example

```json
{
  "manifestVersion": 2,
  "apiVersion": "^1.0.0",
  "permissions": [],
  "id": "example.studio-pack",
  "name": "Studio Pack",
  "version": "1.0.0",
  "description": "A small effects and typography pack.",
  "effects": [
    { "name": "Soft teal", "category": "Color", "values": { "saturation": 1.1, "hue": 12, "contrast": 1.06 } }
  ],
  "textPresets": [
    { "name": "Studio title", "text": "YOUR STORY", "values": { "size": 96, "color": "#FFFFFF", "fontWeight": "bold", "align": "center", "outlineColor": "#172132", "outlineWidth": 2 } }
  ]
}
```

At least one effect or text preset is required. IDs are unique, lowercase
identifiers. Files must be 256 KB or smaller. Install validates the manifest and
enables it; enable/disable controls whether its contributions appear in the
editor; removal deletes it from LibreCut's local plugin registry. Export writes
the validated manifest back to JSON. Plugins are stored locally in browser
storage and are scoped to the current application profile.

## Lifecycle and failures

The lifecycle is install → validate → enable → contribute → disable/remove.
Because plugins are data only, they do not receive execution hooks or a separate
runtime. Parse, permission, and API compatibility failures are shown on the
plugin entry. Failed entries stay disabled and can be removed; install a
corrected compatible file to continue.

`src/lib/plugins.ts` contains the public TypeScript manifest types and runtime
validation used by the editor.
