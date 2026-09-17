# Conversation capability boundaries

[English](capabilities.md) · [简体中文](capabilities.zh-CN.md)

This describes `pptx-react-viewer` 3.19.2 and the plugin's current adapters.
Having a button in the native editor does not imply a released integration API.
The plugin uses public `addElement`, `updateElement`, `updateElements` and
slide/history methods; it does not expose the component's internal AI bridge or
mutate read snapshots.

## Available through conversation

- Open/read/reopen, add/duplicate/delete/move/hide slides, navigate, undo/redo.
- Text insertion, content, font/paragraph/list formatting and element geometry.
- `edit_pptx_batch`: up to 100 existing elements across slides, validated and
  committed together with one undo step (added in plugin 0.2.0).
- Basic shapes, copying/deletion, selection alignment and distribution.
- Table insertion, cell values/styles, unmerged row/column structure and layout.
- Six chart families, supported data updates, titles and basic chart styles.
- Admitted image insertion, crop, shape, opacity, brightness and contrast.

See [usage](usage.md) for units, limits, examples and persistence behavior. Each
command is separate; a sequence is not one atomic undo transaction. Only an
`edit_pptx_batch` call groups its element changes into one step. No-op batches
report `unchanged` with zero undo steps.

## Missing released editing interfaces

| Capability                              | Missing contract                                              |
| --------------------------------------- | ------------------------------------------------------------- |
| Animations and transitions              | No public slide animation/transition setter with history      |
| Themes, masters, layouts and slide size | No public presentation/master mutation API                    |
| Speaker notes and comments              | Read models exist; no public editing method with history      |
| Group/ungroup and layer order           | No public grouping/reordering operation preserving references |
| Complete change events                  | No complete public edit subscription                          |

The component has internal helpers and an internal AI editing bridge for some of
these operations. Those are not released external integration contracts.
`getSlides()` returns snapshots, not a supported write channel. This task adds
no dependency patch to expose them. The existing AutoSave compatibility patch
remains unrelated to these capabilities.

## Serializer limits and adapters still missing

These gaps must not be described as missing public APIs:

- Imported chart category/type/grouping/direction changes, all scatter/bubble
  edits and creation, gridline/background settings and independent title
  visibility are rejected or excluded: the released serializer loses these
  changes. Combination and specialized charts are not supported.
- Table font-family changes, font-only edits to multi-run cells, and structural
  changes in tables containing rich runs are excluded because saving can lose
  the requested changes or untouched formatting.
- Image grayscale is visible in the editor but is lost on save/reopen. It is
  therefore excluded from the conversation edit schema.
- Merged table anchors support value/style edits. Merge/split and structural
  changes in merged tables are not implemented by this adapter.
- SmartArt, media/3D, equations, advanced image effects and character-range
  formatting do not have validated conversation adapters. Some have public model
  fields, but that alone does not establish reliable rendering, relationships,
  undo and serialization. They require separate compatibility work.

Native UI remains available for unsupported conversation operations. Its
presence is not a guarantee of lossless PowerPoint round trips. Browser fixture
checks and live DSH conversation checks are separate evidence, and neither
covers every possible source presentation.
