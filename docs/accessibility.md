# Accessibility

LibreCut is a desktop video editor, so most of the work happens on a canvas
that was drawn with a pointer. This document records what the editor does for
people who drive it with the keyboard, and for people who hear it rather than
see it.

The rules here are behavioural: they describe the app as it is built, so they
can be checked against the running editor.

## Keyboard model

### Anywhere in the editor

| Key | Action |
| --- | --- |
| `Space` | Play or pause |
| `S` | Split the clip under the playhead |
| `Delete` / `Backspace` | Remove the selected clip |
| `Ctrl+Z` / `Ctrl+Shift+Z` / `Ctrl+Y` | Undo and redo |
| `Ctrl+D` | Duplicate the selected clip |
| `Ctrl+S` | Save a `.librecut` copy of the project |
| `Ctrl+E` | Open the export dialog |
| `←` / `→` | Move the playhead one frame |
| `Shift+←` / `Shift+→` | Move the playhead one second |
| `Home` / `End` | Move the playhead to the start or the end |
| `+` / `−` | Zoom the timeline |
| `Escape` | Clear the selection, or close the open dialog |

Shortcuts are ignored while a text field has focus, and while a dialog is
open a dialog owns the keyboard so the editor behind it does not react.

### In the timeline

The timeline is one listbox per track. Only one clip is a tab stop, and the
arrow keys move the focus between the clips of that track.

| Key | Action |
| --- | --- |
| `Enter` / `Space` | Select the focused clip and move the playhead to its start |
| `Alt+←` / `Alt+→` | Focus the previous or next clip on the track |
| `Alt+↑` / `Alt+↓` | Focus the clip on the track above or below |
| `Ctrl+←` / `Ctrl+→` | Move the focused clip by one frame |
| `Ctrl+Shift+←` / `Ctrl+Shift+→` | Move the focused clip by one second |
| `Ctrl+Alt+←` | Trim the start of the focused clip earlier |
| `Ctrl+Alt+→` | Trim the end of the focused clip later |
| `Ctrl+Alt+Shift+←` | Trim the start of the focused clip later |
| `Ctrl+Alt+Shift+→` | Trim the end of the focused clip earlier |
| `Delete` / `Backspace` | Remove the focused clip |

The arrow keys on the timeline leave the playhead alone: the plain arrows
belong to the clip that has focus, and the playhead is moved from the
transport or from anywhere else in the editor.

The same list is shown in the inspector, under **Shortcuts**, when no clip is
selected.

## Structure

- The editor is a `banner` (top bar), a media `complementary` region, a
  preview `region`, an inspector `complementary` region, and a timeline
  `region`. Each one is named, so a screen reader can move between them.
- The media library and the inspector use a tab list with a panel for each
  tab. Only the open tab is a tab stop, and the arrow keys move between the
  tabs.
- Every timeline track is a `listbox` of its clips. A clip is an `option`
  with a name that gives the clip, its kind, where it starts, how long it
  lasts, and the track it sits on.
- Icon-only buttons carry an accessible name, and the ones that hold a state
  report it with `aria-pressed`.
- Form fields are labelled, either by a wrapping label or by `aria-label`.

## Announcements

State that the eye picks up from a colour or a spinner is spoken as well:

- Progress: imports, exports, and local model work are announced. The
  export reports its progress in quarters rather than on every frame.
- Errors: a failed import, a failed export, and an incompatible plugin are
  announced assertively, so they cut through whatever else is being read.
- Results: a split, a moved clip, a delete, an undo, and a redo each say
  what happened.
- The save state in the top bar is a live region, so "Saved locally" and
  "Unsaved changes" are spoken when they change.

Toasts are live regions of their own: an error is `alert`, everything else is
`status`.

## Dialogs

Every dialog is `role="dialog"` with `aria-modal`, is named by its title, and
is described by its subtitle. Focus moves into the dialog when it opens and
returns to the control that opened it when it closes. `Tab` and
`Shift+Tab` stay inside the dialog, and `Escape` closes it.

Only the topmost dialog reacts to `Escape`, so two stacked dialogs do not
both close.

## Contrast and motion

- The dimmed label colour was raised so the small labels of the editor sit
  above 4.5:1 against the panel and track surfaces they are printed on.
- Focus is a teal outline with a 2px offset, and it is never removed from a
  control that can be reached with the keyboard.
- Animation is dropped for anyone who asked the system for reduced motion.

## Known limits

- The preview canvas is a picture, not a description of the frame. Nothing
  reads the pixels of the composition out loud.
- The timeline ruler is hidden from screen readers because it repeats the
  timecode of the playhead readout, which is announced instead.
- Dragging media from the media panel onto a track still needs a pointer.
  The add button on each media card places the same clip at the playhead.
