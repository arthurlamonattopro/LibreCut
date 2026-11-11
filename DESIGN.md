---
name: LibreCut
description: A clear, local-first desktop workspace for everyday video edits.
colors:
  surface: "#101114"
  surface-2: "#15171b"
  panel: "#1b1d22"
  panel-2: "#22252b"
  raised: "#292d34"
  line: "#343840"
  line-soft: "#292c32"
  ink: "#f5f6f7"
  muted: "#a5a9b1"
  dim: "#797f89"
  accent: "#36c8d0"
  accent-hover: "#57d9df"
  accent-soft: "#36c8d020"
  mint: "#69d9a2"
  blue: "#7daeff"
  amber: "#f0be62"
  error: "#ff8b8b"
typography:
  body:
    fontFamily: '"Segoe UI Variable Display", "Segoe UI", system-ui, sans-serif'
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.5
  title:
    fontFamily: '"Segoe UI Variable Display", "Segoe UI", system-ui, sans-serif'
    fontSize: "22px"
    fontWeight: 600
    lineHeight: 1.25
  label:
    fontFamily: '"Segoe UI Variable Display", "Segoe UI", system-ui, sans-serif'
    fontSize: "11px"
    fontWeight: 600
    letterSpacing: "0.04em"
  measurement:
    fontFamily: '"Cascadia Code", "Cascadia Mono", Consolas, monospace'
    fontSize: "11px"
    fontWeight: 400
rounded:
  xs: "6px"
  sm: "8px"
  md: "10px"
  lg: "14px"
  xl: "20px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "#071719"
    rounded: "{rounded.sm}"
    padding: "0 13px"
    height: "34px"
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
    textColor: "#071719"
    rounded: "{rounded.sm}"
    padding: "0 13px"
    height: "34px"
  field:
    backgroundColor: "#101013"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "0 10px"
    height: "34px"
---

# Design System: LibreCut

## Overview

**Creative North Star: The Cut List**

LibreCut is a working tool, not a campaign surface. The home screen is a short route into an edit: create a project, open one, or choose it from a plain list. In the editor, the footage and timeline take priority over decoration.

The interface uses graphite surfaces, compact Segoe UI controls, and teal only for the main action, focus, and current selection. Panels use fine dividers; the home library uses thumbnail rows instead of promotional cards. The LC monogram is drawn from the product name.

**Key Characteristics:**
- Media, preview, inspector, and timeline remain visible together in the editor.
- Teal marks primary actions, focus, and selection.
- Local project status and export actions stay in the top bar.
- The home screen puts New project and Open project in the same consistent header.
- A Getting started entry reopens the first-run guide; the guide also checks the FFmpeg runtime.
- Project rows show a real thumbnail, name, edit date, format, and duration.
- The LC monogram and wordmark use the same restrained palette.

## Colors

The palette is dark and neutral, with one bright teal accent and restrained semantic colors for media tracks and status.

### Primary
- **Edit Teal** (`#36c8d0`): Primary actions, active navigation, timeline selection, and focus.
- **Edit Teal Hover** (`#57d9df`): Hover state for primary actions.

### Secondary
- **Track Mint** (`#69d9a2`): Audio track and positive status cues.
- **Track Blue** (`#7daeff`): Text track cues.
- **Track Amber** (`#f0be62`): Secondary track or warning cue.

### Neutral
- **Work Surface** (`#101114`): Main app background.
- **Inset Surface** (`#15171b`): Secondary background and fields.
- **Panel** (`#1b1d22`): Media, inspector, and dialog surface.
- **Panel Raised** (`#22252b`): Selected or hovered panel surface.
- **Control Raised** (`#292d34`): Secondary button background.
- **Primary Text** (`#f5f6f7`): Main labels and titles.
- **Secondary Text** (`#a5a9b1`): Supporting copy and metadata.
- **Quiet Text** (`#797f89`): Hints and inactive labels.
- **Divider** (`#292c32`): Panel separators; `#343840` is used for stronger control edges.
- **Error** (`#ff8b8b`): Destructive actions and errors.

### Named Rules
**The Teal Means Action Rule.** Use teal for the primary action, keyboard focus, and current selection. Track colors identify track kinds; they do not decorate unrelated surfaces.

## Typography

**Display Font:** Segoe UI Variable Display (with Segoe UI and system sans-serif fallbacks)
**Body Font:** Segoe UI Variable Display (with Segoe UI and system sans-serif fallbacks)
**Label/Mono Font:** Cascadia Code (with Cascadia Mono and Consolas fallbacks)

**Character:** Compact, familiar desktop UI type. The mono face is reserved for timecode, dimensions, and other measured values.

### Hierarchy
- **Page title** (600, 22–30px): Home and empty-state titles.
- **Panel title** (600, 12–15px): Panel headings and project names.
- **Body** (400, 12–13px, 1.45–1.5): Explanatory copy and content labels.
- **Label** (600, 10–11px, lightly tracked, uppercase where sectional): Field names and compact group headings.
- **Measurement** (400, 9–12px, Cascadia Code): Timecode, frame rate, dimensions, and timeline ruler values.

## Layout

The home screen uses a 190px left navigation rail and a flexible, scrollable project area. New project and Open project stay in the header; projects appear as flat rows with 16:9 thumbnails and concise metadata. The empty state is plain text under the same header. The app window opens at 1440×900 and enforces a 1080×680 minimum.

The editor is a desktop workbench: a 256px media panel, flexible preview stage, 280px inspector, and a 310px-high timeline below. The 50px top bar holds project identity, local save status, canvas dimensions, save-copy, and export. Preserve the media → preview → inspector relationship and keep timeline actions adjacent to their tracks. This shipped layout is desktop-sized; don't imply a compact/mobile arrangement that is not implemented.

## Elevation & Depth

Depth comes from tonal surface changes and thin borders. Shadows separate modals and selected clips. The preview and project rows stay flat; don't add ambient lighting, gradient fields, or shadows for decoration.

## Shapes

Controls and thumbnails use compact 6–10px corners. Larger home and dialog surfaces may use 14–20px corners. Panel boundaries rely on a one-pixel divider rather than nested outlined cards.

## Components

### Buttons
- **Shape:** Compact, consistent 8px radius; standard height is 34px and small controls are 28px.
- **Primary:** Teal fill with dark text; hover shifts to brighter teal.
- **Secondary:** Raised graphite fill and a subtle border.
- **Ghost:** Transparent at rest; gains a faint neutral background on hover.
- **Focus:** A visible teal outline with a 2px offset.

### Chips
- **Style:** Small, low-contrast neutral surface with a fine border; used for project format and status.
- **State:** Teal text and tint identify a selected or active state.

### Project List
- **Structure:** Flat rows with one thumbnail, project name, edit date, format, and duration.
- **Hover:** The project name shifts to teal; the row does not lift or gain a card background.
- **Destructive Action:** Delete is available on the row and has a project-specific accessible name.

### Inputs / Fields
- **Style:** 34px height, near-black field on panel, 8px corners, neutral border.
- **Focus:** Teal border and a restrained outer ring.
- **Error / Disabled:** Red for errors and destructive actions; disabled controls use muted text and reduced contrast.

### Navigation
- **Style:** Persistent left rail on home; compact project/back control in the editor top bar.
- **Active:** A low-contrast neutral row with a teal icon; inactive destinations remain neutral.

### Brand Mark
- Use the LC monogram: teal L and open white C on a graphite square.
- Keep the wordmark one color. Avoid gradients, glows, and playback or crop symbols.

### Timeline
- Keep time ruler, track labels, and track content aligned in one scroll surface.
- Use media thumbnails and audio waveforms as clip content; use teal outline for the selected clip and a teal playhead.
- Keep undo, redo, split, delete, snap, track creation, and zoom together above the track list.

## Do's and Don'ts

- Do keep the preview and timeline as the visual center of the editing task.
- Do make import, create-project, save-copy, and export actions easy to find.
- Do use teal for active and primary states only.
- Do preserve local save, import, and export feedback.
- Do keep the home screen organized around the project list and its two entry actions.
- Do use the LC monogram and a single-color wordmark.
- Don't use promotional hero panels, empty thumbnail illustrations, or decorative gradients in the project library.
- Don't add cloud, account, template, or effect-store claims that the product does not support.
- Don't use CapCut or ByteDance logos or imply affiliation.
