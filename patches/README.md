# Component compatibility patches

## pptx-react-viewer 3.19.2: recovery and history integrity

The exact-version pnpm patch fixes the native recovery prompt in both ESM and
CommonJS bundles. Restoring a browser snapshot does not save the source file, so
it must remain recoverable after another reload. The original tab-wide consumed
timestamp also suppressed unrelated older document snapshots.

The patch removes that timestamp from recovery admission and stops advancing it
when restoring or discarding. Discard still deletes only the selected snapshot.
The recovery dialog remains busy with both actions disabled until the deletion
finishes; this prevents a quick reload after dismissal from reopening the old
snapshot. The same guard prevents overlapping restore/discard requests. Native
storage, the AutoSave switch, per-file keys, the 24-hour recovery window, and
the in-mount single-prompt guard are unchanged. It does not clear user storage
or introduce a second recovery store.

The recovery dialog displays the viewer's public `fileName` value instead of its
opaque storage key. Long filenames wrap within the existing dialog, and short
viewports scroll the dialog so its actions remain reachable. Both module formats
carry this presentation fix; snapshot identity and recovery behavior are
unchanged.

`pnpm-workspace.yaml` pins the patch and `pnpm-lock.yaml` records its hash. Use
`pnpm install --frozen-lockfile` to reproduce it. This is a local dependency
fix, not a capability claim for the unpatched upstream release. Revisit and
remove it when a released version passes the same regressions without it.

Validation: `pnpm check` and `pnpm test:browser`. The native recovery browser
tests cover repeated reloads, an added third slide, AutoSave off, explicit
discard, conversation isolation, and storage failure. Live DSH validation
remains a separate check.

### Serialization must not add history entries

Native serialization refreshes slide and element `rawXml` archive caches and
assigns `shapeId` archive numbers to new elements in place. After a public
`updateElements` batch, AutoSave followed by navigation made native history
compare these caches as new edits. Undo then consumed a cache-only snapshot,
leaving the requested changes intact and causing the plugin's result
verification to fail.

The patch excludes only those slide/element cache fields from native history
comparison, including group children and template elements. It retains element
IDs, nested XML in semantic properties, all other model fields, actual history
snapshots, ordinary editor mutations, and the public API. It neither skips undo
steps nor introduces plugin-owned history. The public-ref regression covers
export, navigation, one-step cross-slide undo and redo; the conversation
regression also covers AutoSave before navigation and undo. New-element
regressions cover insertion on both existing and new slides, serialization,
single-step batch undo, independent insertion history and redo.
