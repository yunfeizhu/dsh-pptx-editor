---
version: alpha
name: dsh-pptx-editor
description: A complete presentation editor beside an Agent conversation.
colors:
  background: '#fff'
  toolbar: '#fff'
  text: '#0f1115'
  primary: '#4176e6'
typography:
  sans:
    fontFamily: system-ui, sans-serif
rounded:
  control: 10px
  overlay: 10px
spacing:
  panel-gap: 8px
  feedback-gap: 12px
  feedback-padding: 4px 12px
  feedback-height: 32px
components:
  connection-feedback:
    backgroundColor: '{colors.toolbar}'
    textColor: '{colors.text}'
    minHeight: 32px
  confirmation:
    backgroundColor: '{colors.toolbar}'
    textColor: '{colors.text}'
    rounded: '{rounded.overlay}'
---

# Presentation editor design

## Overview

Preserve the desktop presentation ribbon, thumbnails, canvas and property
inspector. Users work on local presentations and apply Agent edits directly from
chat. This is a product tool with dense controls, not a marketing page. The
complete component UI and its visual isolation are explicit product
requirements. See [scope and UI ownership](docs/design.md).

## Colors

DSH is the canonical source for plugin controls. The values above mirror the
live DSH light shell. `shell-theme.ts` copies a small allowlist of inherited
`--dsw-alias-*` colors from the host frame into isolated `--pptx-shell-*` tokens
and observes ancestor theme attributes. Missing tokens use the documented light
fallbacks. Plugin buttons, status and dialogs consume only shell tokens.

The component defaults to its public `light` preset and preserves an explicitly
saved theme choice. Its own theme remains independently selectable. `App.tsx`
applies public `defaultCssVars()` plus `themeToCssVars()` and cleans up all
previously written variables, including generated aliases, on theme changes. No
selector or stylesheet changes the DSH shell or the component's public UI.

## Typography

Use system UI fonts for plugin controls and restrained monospace text for
technical values. Chinese and English copy must fit the same controls.
Presentation typography belongs to the document and component renderer.

## Layout

The editor fills the available panel; DSH owns fullscreen and pane layout. The
PPTX tab is opened from chat attachments or conversation requests; it has no
separate card on DSH's Start page. The plugin-owned `.pptx-app` reserves an 8px
top inset via `--pptx-shell-panel-gap` in `styles.css`, separating the host tabs
from the viewer ribbon. Border-box sizing keeps this inset inside the panel
height. The component owns the file ribbon, Save/download, AutoSave, Undo and
Redo. There is no duplicate plugin command strip or save-status label. Before
opening any file, the empty state offers Open PPTX. Once loaded, File > Open >
Browse this device invokes the plugin's existing document-selection boundary.

Healthy connections and initial setup take no extra header space. A connection
failure alone shows a compact strip with a status and Retry action. Below 600px
the status label is visually hidden while remaining accessible. Retry keeps its
label and geometry, displays a spinner and prevents duplicate attempts.
Successful recovery hides the strip without remounting the editor. Desktop
Chrome and Edge are the supported editing surfaces.

## Elevation & Depth

Use subtle neutral borders and background changes for hierarchy. Recovery uses a
persistent overlay; destructive confirmation uses an app-owned modal dialog in
the top layer, with Cancel focused first and Escape cancelling.

Closing a dirty editor shows the compact host-owned notice in
`panel-recovery.ts`. It uses the same shell token adapter, scoped to its own
root and sourced from the DSH body, plus the current host language. Its file
name wraps even without spaces. Continue editing opens the retained editor; Hide
notice only dismisses the feedback. Neither action saves or discards the
document. The recovery overlay shares the neutral theme and has a Back to
conversation action. Discard changes uses the existing confirmation dialog.

## Shapes

Use a ten-pixel radius for compact shell controls and dialogs, following the
rounded DSH control family. Do not replace presentation shapes or component
icons with a separate visual system.

## Components

`App.tsx` owns document selection, connection feedback and direct Agent editing.
Native viewer file controls are the sole loaded-document entry points; the
plugin does not intercept Ctrl+S / Cmd+S or add an overwrite-save action.
Attachment replacement blocks viewer shortcuts at the window capture phase as
well as pointer edits. Tab navigation and the canonical confirmation dialog
remain usable; shortcuts resume after completion or failure. `confirm-action.ts`
owns destructive confirmations and native dialog focus management. Destructive
dialogs explicitly center in the viewport, with a separate title, consequence
text and right-aligned actions. Their CSS is scoped against both the viewer and
DSH resets. DSH owns the display language. The iframe reads the host document's
public `html.lang` value before mounting and observes changes; its shared
i18next instance updates the plugin and viewer without remounting. There is no
plugin language selector or independent locale preference. Viewer locale events
are reconciled to the host language. Chinese and English are supported; other
host languages use English. Theme preferences remain independent. Dismissible
errors appear at the bottom right, clear of the Undo/Redo toolbar. Stale
document preconditions are returned to the Agent for a fresh read without a
duplicate editor toast; they never mutate the document or dismiss an existing
failure. Actual application failures retain their editor feedback. The component
owns its recovery and export feedback; the plugin never interprets a native
download as a completed file overwrite. Controls have text labels, keyboard
focus and disabled states. Normal, hover and active states retain the same
border and dimensions; hover changes only the background. No decorative
animation is introduced by the plugin.

## Do's and Don'ts

- Preserve editor state, history and file identity across panel transitions.
  Closing a loaded panel parks its editor in the current page; `open_pptx`
  restores it through conversation without replacing unsaved work. A fresh page
  restores the latest loaded chat attachment unless the user closed its tab.
  `panel-dismissal.ts` owns the per-conversation close preference in browser
  `sessionStorage`; ordinary unmounts and page departure do not close a tab.
  Explicit opens and newly sent attachments clear the preference. Blocked
  storage suppresses automatic history navigation while explicit opens remain
  usable. Native AutoSave writes browser recovery snapshots every two seconds
  under a conversation/source/content-scoped key. Its existing switch, status
  and recovery prompt own that flow; no second switch is added. The plugin UI
  adds no second save action or status. Recovery dialogs display the document
  filename, keep long unbroken names within the panel, and scroll within short
  viewports. Storage keys remain internal. Undo history and file permissions
  remain memory-only. Open viewer modal dialogs block Agent commands until the
  decision ends. Native downloads have no public completion event;
  close/replacement guards therefore remain conservative after downloading.
- Keep user documentation bilingual and code comments in English.
- Keep CSS inside the editor document and plugin-owned elements.
- Do not replace the component ribbon, restyle DSH, or infer saved state from a
  successful model response.

## Reconcile drift

| Previous behavior                            | Resolution                                                                        | Evidence                                               |
| -------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Independent plugin colors and spacing        | Use DSH shell colors and compact controls; default the viewer to light            | Computed styles and browser workflow                   |
| A Chinese plugin bar above an English editor | Register the complete pinned upstream Chinese dictionary; share the active locale | Key/placeholder parity and locale switching            |
| Dialog at the top left after CSS reset       | Explicit fixed centering, scoped controls and native modal focus                  | Desktop/narrow dialog geometry and Escape/focus checks |
