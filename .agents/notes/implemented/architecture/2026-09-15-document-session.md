# Agent Note: Live editor ownership and explicit persistence

Status: implemented

## Problem

The full PPTX component owns mutable slides, undo history and serialization.
Independent disk edits would overwrite that state. The public component API has
no complete edit feed or supported public transaction for this plugin's planned
cross-slide operations. DSH can unmount inactive tab bodies and aborts a tab's
signal only after closing its record, so an iframe's beforeunload handler cannot
protect that close path.

## Decision

- Use released React editor `3.19.2` in an isolated iframe. Build a DSH module
  factory separately from the editor assets. DSH CLI `0.1.5-rc.1` loads public
  plugin packages `0.1.5-rc.2`; the source patch and actual registrations were
  exercised in a live local DSH conversation.
- The editor owns slides/history. `DocumentSession` owns an occurrence UUID,
  monotonic edit version, latest edit receipt and original-file baseline.
  Read/edit commands route through an ephemeral per-conversation browser lease;
  the host has no document mirror or file-write capability.
- The user changed the interaction contract to direct Agent editing. One public
  `updateElement` call immediately applies a validated edit on the active slide,
  without staging or a confirmation card. Revalidate current state, verify the
  result and return the new version; never let model-authored summaries
  substitute for a concrete target or silently claim a no-op succeeded. Undo
  remains in the component, and Agent edits do not write to disk.
- Use conservative interaction invalidation and dirty marking. Selection may
  produce a false positive, but metadata edits must not silently bypass the
  unsaved guard. Refuse commands while text input or a file-selection transition
  is active. Automatic overwrite stays deferred. Cross-page element batches now
  use the public API described below.
- File persistence follows the native viewer download flow. The plugin no longer
  exposes its original-file writer in the UI; that tested internal capability is
  retained but is not the current user-facing workflow. See the native
  file-controls decision below.
- Register the `pptx-editor` tab type without a DSH Start-page `guide` entry.
  Chat attachment admission and explicit conversation reopen requests own entry
  into the editor. Keep the tab body and recovery lifetime registered; removing
  the guide must not remove programmatic opening or retained state.
- Retain iframe state using native `Element.moveBefore`, not detach/append.
  Inactive tab bodies park the connected frame. Closed dirty frames stop Agent
  commands and remain accessible through a local recovery view or a newly opened
  PPTX tab in the same conversation. Loaded clean frames are also retained,
  including their file handles and undo history; empty frames are removed after
  connection cleanup. Discard requires a user action. Recovery is intentionally
  memory-only; native recovery snapshots are separate, as described below.
  Host-owned recovery feedback uses the shared DSH shell token adapter scoped to
  its own root and the host language. Hiding its notice never discards the
  frame; Continue editing opens the same frame without implying a file save.
  Discard remains guarded by confirmation and the current panel owner. A legacy
  owner keeps its original recovery controls until it closes; a new owner
  upgrades the UI after the old abort callback is spent. History admission also
  lives on the page so client-module reloads cannot replace a later manually
  opened document with an older attachment.
- Explicit tab closure persists a per-conversation dismissal flag in the current
  browser tab's `sessionStorage`. Historical attachment admission still updates
  available metadata but cannot reopen a dismissed panel. New admitted messages
  and live `open_pptx` requests clear the flag; repeated requests do not. A
  manual tab attachment also clears it. The existing public tab lifetime signal
  records closure, not React unmount or conversation switches; page departure
  freezes the preference so teardown is not interpreted as closing. Only
  navigation metadata is stored, never PPTX content, paths, credentials, or
  undo. If storage is blocked, history auto-opening fails closed while explicit
  opens remain available in memory.
- Closing synchronously stops commands, then returns a connection-cleanup
  promise to the parent. Keep the browsing context alive until that promise
  settles. A replacement frame waits on the page-owned per-session barrier
  before claiming its lease. Claim attempts use a bounded independent signal
  inside the cleanup scope, so closing during an in-flight claim still releases
  its owner. A frame-owned closed marker also covers closure before the editor
  script starts; recovery stays paused until a formal tab resumes it. The host
  continues to reject separate competing editors; release remains best effort
  during network failures, with host lease expiry as fallback.
- Keep the iframe registry on the current page under a versioned symbol. A DSH
  client-module replacement can preserve the tab record and its signal; a
  module-local registry would strand the old owner and create a conflicting
  blank editor. Reuse the same frame and ownership checks across replacement.
  Destructive confirmations use a shared page-owned dialog, with Cancel focused
  first and Escape cancelling.
- DSH supplies the plugin controls' visual style. Copy only an allowlist of
  inherited host color tokens into isolated shell variables, with explicit light
  fallbacks; observe ancestor theme attributes and disconnect on disposal. Keep
  borders stable across hover states. The viewer defaults to its public light
  theme while respecting saved choices. Its `defaultCssVars` and
  `themeToCssVars` variables are cleaned up between themes, including generated
  color/radius aliases; viewer theme choices never overwrite shell tokens. Keep
  connection feedback hidden while healthy; failure exposes a compact Retry
  action with a disabled busy state. DSH owns the language: read its documented
  `html.lang` before editor initialization and observe it for changes.
  Synchronize the canonical i18next instance, not the render snapshot returned
  by the React hook; component locale events converge back to the host. No
  plugin language selector or independent locale preference remains. Locale and
  theme changes never change the document occurrence or remount the viewer. The
  pinned Chinese dictionary is upstream data: see
  [third-party notices](../../../../THIRD_PARTY_NOTICES.md). Key and
  interpolation parity are checked against the installed component. Its
  internally hardcoded English labels remain upstream scope. In 3.18.0, File >
  Options has an uncontrolled locale selection marker; following DSH updates
  translations but cannot synchronize that marker through a public setter.
- Authenticated DSH `connection.requestRejection` protects every plugin route.
  Mutations additionally require loopback/same-origin checks and an ephemeral
  token. Protocol schemas are strict and bodies bounded. Explicit reconnect
  preserves the editor and never replays uncertain requests.

- Chat intake restores the latest PPTX in the initially loaded history and then
  observes appended user file blocks through the public session event source.
  Older-history prepends and historical tool calls never trigger navigation.
  Publish attachment identity per conversation, then navigate from the public
  composer dock after React passive effects bind the native sidebar. Deduplicate
  only successful navigation; failed navigation has an explicit retry. Remember
  successful attachment and explicit-open request IDs separately from the
  editable document; composer remounts do not reopen explicitly closed panels.
  Draft-upload completion and native file-card click hooks are outside the
  current plugin contract.
- The host reads immutable attachment bytes only after matching their reference
  to the exact conversation's admitted user messages. Prefer the live Agent
  events; otherwise use public `sessionQuery.readSession` without activating an
  Agent, and return a bounded error if that read fails. Bound stream size and
  verify the declared byte count. Never accept a model-supplied file path.
  Loading a replacement locks manual edits and saves, respects the unsaved
  guard, and checks synchronous close cancellation before replacing the owner.
- Attachment loading intercepts window-level keyboard shortcuts as well as
  pointer edits. The viewer registers global listeners outside the inert editor
  DOM. App owns this temporary fence, preserves Tab defaults and delegates modal
  keys to `confirm-action.ts`. Native export and keyboard behavior remain owned
  by the viewer; no plugin disk-save UI is exposed.
- Page departure queues a keepalive ownership release and immediately stops
  browser commands. If the release is lost, only the known ownership conflict is
  retried, for at most the lease duration plus five seconds. Active owners are
  never replaced; other failures stay explicit. Lease duration is shared between
  the browser retry deadline and the host broker.
- The no-argument `open_pptx` tool uses live admitted `tool/call` events to ask
  the current composer to reveal its native PPTX tab. This is a navigation
  request, not attachment replacement or edit replay. The tool waits for a read
  from a visible editor; a closed, unready or hidden editor cannot produce a
  success response. The operation cannot select arbitrary filesystem paths. A
  fresh browser page reloads the original uploaded attachment. Native recovery
  can then offer its last completed snapshot, but never file picker handles or
  undo history.
- First-turn attachment reads wait for the matching attachment occurrence and
  editor readiness. Edit requests are never retried automatically. A successful
  read reports preview readiness separately from its limited text/geometry
  projection. Tool descriptions direct simple preview requests to finish after
  opening; omitted structured data is not evidence of a damaged visual preview.

## Alternatives considered

- Rewriting the file with a server-side tool would create competing ownership
  and bypass editor history and version validation.
- Recreating the iframe on tab switches would lose pending edits and undo state.
  Exporting a snapshot cannot preserve the component's history. The native move
  API keeps its browsing context; unsupported browsers fail explicitly.
- Treating sticky `isDirty` or serialized slide fields as a complete change feed
  misses presentation-level changes. Conservative manual saves cost extra
  prompts and false-positive dirty indicators until an upstream notification API
  exists.
- Remounting the viewer to synchronize its internal locale marker would lose
  undo history. Patching its DOM or private state is not a supported public API.
  DSH owns the displayed language. Independent viewer locale changes cannot
  replace that preference. The marker limitation is accepted for 3.18.0.
- DSH has no supported pre-close veto. A documentation warning cannot prevent
  loss, so the plugin retains an unsaved frame after the native record closes.

## Consequences

Tests cover host authorization, session isolation, stale requests, direct
editing, replay rejection, no-op failures, inline-input refusal, serialization
races, external file changes, write failures, recovery/discard, explicit
reconnect, rapid empty-tab reopens, delayed release and closing during a claim.
Real Chrome exercises rendering, undo/redo, tab remount retention, and OOXML
round trips for synthetic text, shapes, table, image, notes, chart and embedded
workbook. An authorized local presentation was tested without adding its
contents to fixtures or logs.

A live Chrome conversation with a synthetic chat attachment verified automatic
sidebar opening, a simple preview using one read call, direct Agent editing,
first-save destination selection, undo and subsequent overwrite. The emitted
PPTX title was checked after both writes. Regression coverage also verifies
consecutive page refreshes, clean and dirty panel retention, CSS-hidden and
translated panels remaining unready, stale ownership waiting, and cold
conversation attachment reads. This is source-run evidence; a clean
installed-package distribution, automatic save, cross-slide atomic edits and
broad PowerPoint fidelity remain separate acceptance work. Browser refresh/crash
destroys memory-only recovery; native snapshots can separately restore content.
Keep user-facing scope in [usage.md](../../../../docs/usage.md) and its Chinese
peer.

## References

- [DSH locale and document language](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/locale/README.md)
- [DSH sidebar contract](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/ui-sidebar-right/README.md)
- [DSH tool contract](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cookbook/adding-a-tool.md)
- [State-preserving move API](https://developer.mozilla.org/en-US/docs/Web/API/Element/moveBefore)
- [Development validation](../../../../docs/development.md)

## Conversation-driven insertion (2026-09-16)

Conversation-driven insertion extends the existing document owner with two
single-operation tools: `add_pptx_slide` and `add_pptx_text`. They share
document/version validation, edit-mode checks, attachment binding, inline-edit
refusal, save exclusion and failed-edit invalidation with existing editing. A
successful call consumes the base version; uncertain results are read back
before any retry. No insertion writes to disk.

The pinned `pptx-react-viewer@3.18.0` exports `addSlide(afterIndex?)` and
`addElement(element)` on its public handle. The released type comment says an
omitted slide index appends, while its implementation inserts after the active
slide. The plugin always supplies an explicit index and verifies the resulting
count, identity, position, active slide and prior slide order. Text insertion
uses a self-contained text model, checks the newly assigned ID and actual
geometry/content, and exposes only text, geometry, font size, RGB color and
bold. It accepts no foreign XML, relationships, assets or file paths.

A separate core presentation model or private history transaction would create
competing document ownership. Calling the viewer's public APIs preserves the
existing history; each inserted page or text box is one separate Undo/Redo step.
A multi-call request can partially succeed, so an error must not claim the whole
request was rolled back. The already applied work remains editable and undoable.

Unit tests cover invalid/stale/repeated requests, inactive slides, save and
lifetime fences, and rejected/no-op insertions. A real Chrome regression covers
append and middle insertion, new title/body text, subsequent editing, separate
undo/redo, Unicode and XML-escaped text, ordered export and reopen. It uses a
synthetic deck and adapted DSH registration/file picker boundaries; live model
validation is separate. No component upgrade or host source patch is required.

## Conversational formatting and operations (2026-09-16)

Conversational formatting expands the existing document session, without a
second model, private component imports or host patches. `edit_pptx` merges
requested text/paragraph/shape styles into live runs and paragraph metadata;
explicit fonts/colors remove conflicting theme references. Geometry and font
sizes are CSS pixels. Paragraph centering retains the text box geometry. Parsed
decimal/bullet display markers are cleared when converting lists, so removing
numbering does not make generated numbers literal text. Custom numbering is
rejected before mutation until separately verified.

`operate_pptx` uses public slide
navigation/duplication/deletion/movement/hiding, shape insertion, element
copying/deletion/arrangement and undo/redo. It shares base-version, inline-edit,
attachment, lifetime and save fences. The pinned 3.18.0 `deleteElements(ids)`
implementation immediately reads captured selection following its selection
update; the adapter flushes `selectElements(ids)` first. `duplicateElement`
similarly depends on captured selection and returns a stale ID. Copying instead
clones the same-document model and calls `addElement`, then verifies the new
identity and placement. Tests exercise a deletion whose target differs from the
current selection.

Element arrangement uses selection bounds, skips unchanged targets, rejects
rotated/skewed targets and negative distribution gaps, and commits each public
update separately. It has one history step per changed element, verified in
Chrome; this is not an atomic transaction or rollback. Undo/redo uses the
viewer's shared history, including manual operations. Slide-copy round trips
cover a chart with its embedded workbook. Read results expose selection,
formatting, history availability and supported/unsupported operations so the
model need not inspect source code to infer capabilities.

Private transaction or toolbar internals could broaden scope but would bypass
the released contract. Table/chart editing, external images, masters,
animations, grouping, layer order and substring formatting remain outside this
tool scope. The synthetic browser regressions adapt only DSH registration and
file-picker boundaries; live model use and broad PowerPoint fidelity remain
distinct evidence.

The operation union is nested under an `action` object at the model-tool
boundary. A real DSH model request rejected a root-level union because its JSON
Schema had no root `type: object`; registration/browser dispatch tests alone did
not expose that provider constraint. All registered tools now have a root-object
regression assertion. Internal editor commands retain their strict discriminated
union and session validation.

Tool descriptions distinguish the `operate_pptx` wrapper from the flat edit and
insertion arguments. Invalid argument shapes remain rejected before broker
dispatch; accepting malformed envelopes would obscure the public contract.
Shared response guidance asks for the visible result and persistence state,
reserving internal diagnostics for explicit troubleshooting. Partial failures
and uncertain outcomes must still be disclosed. A stale rejection precedes
mutation, but its version mismatch alone cannot identify the change source:
conservative invalidation also covers selection and other interactions. Re-read
and re-evaluate the target before retrying; keep the version fence intact. Host
tests verify wrong envelopes never dispatch. This guidance does not guarantee
model compliance; live response quality requires separate validation.

Each editing turn must obtain a fresh read, including after clarification or an
editor reload. A previous turn can retain an obsolete document identity even
when the current file looks identical. A typed pre-mutation stale rejection
still fails the tool call, but does not duplicate that diagnostic as an editor
toast or clear an existing failure. Actual mutation failures remain visible,
even if their text resembles a stale error. Tests cover old identities, consumed
versions, a fresh duplicate applied once, and undo. Never automatically replace
the request base or replay a non-idempotent operation.

A live DSH conversation with a newly sent synthetic attachment subsequently
verified the repaired schema: the configured model changed paragraph alignment,
RGB color, italic and a 32-point font without changing box geometry, duplicated
and moved a slide, then undid and redid that move. The visible canvas confirmed
center alignment, RGB(37,99,235), italic and 42.6667 CSS pixels. No disk save
was requested. This live check supplements 161 local tests and 11 browser
regressions; the schema adapter received an additional affected browser rerun.

## Native browser recovery (2026-09-16)

Reuse the released viewer's `autosave` and `autosaveIntervalMs` props and its
existing toolbar switch. Native AutoSave serializes recovery snapshots into
unencrypted browser IndexedDB; it does not write the selected local file. The
plugin polls every two seconds and respects the viewer's saved switch
preference. Native Save/download remains separate; the plugin adds no duplicate
file controls or saved-state label.

The native `filePath` recovery identity hashes the DSH session, attachment
occurrence or local source, filename, and original bytes. This separates chats,
attachments, and changed source files without exposing private paths in storage
keys. Reopening the same chat attachment can recover its draft. Local files need
reselection; identical local copies with the same name and bytes in one chat
share a recovery slot and use the native restore/discard decision.

Enable recovery only after the original document session has established its
saved baseline. Restored content must remain dirty relative to that original.
Agent commands wait for modal viewer decisions, including recovery, and the
viewer's public `aria-busy` loading state to finish. No private storage helpers,
extra snapshot mirror, or custom AutoSave control are introduced. Recovery does
not restore undo history or local file permissions; clearing browser storage
removes snapshots, and changes in the last polling interval may not have been
captured.

Real viewer browser regressions cover Agent edits, a subsequent manual edit
while already dirty, switch-off behavior, conversation isolation, restore and
further editing, refusal to read or save through a pending recovery dialog, and
native storage failure without a disk write or discarded draft. Unit tests cover
stable and isolated recovery identities and modal command/save fences. Live DSH
validation remains separate from these adapted host-boundary tests.

The 3.18.0 serializer mutates source-package bookkeeping in shared slide/element
objects. Exclude only slide-level `id`/`slideNumber`/`rawXml`/`rId` and
element-level `rawXml`/`shapeId` from the comparison fingerprint, including
group children; preserve every other model field and nested semantic XML.
Otherwise snapshots cause spurious stale rejections between read and edit. The
live model and export remain unchanged. Conservative interaction invalidation
still fences manual changes, including unsupported properties represented only
in source XML.

`reconcilePresentationSlidesForSave` numbers slides by their current array
order, and `attachNewSlide` replaces temporary IDs with archive paths on shared
slide objects. This affects new and duplicated slides even when another slide is
active. Requests address the ordered slide index and element ID, not this
archive path. Keep array order, page count, element IDs and every semantic field
in the fingerprint; do not strip nested IDs or replace a rejected request base.
A real-component regression failed with a version increment after AutoSave, then
passed across both duplicated and added inactive pages, a subsequent text
insertion and undo. Unit tests also preserve reorder, insertion, deletion,
hidden-state and element-identity fences. Disabling AutoSave or automatically
retrying would hide this bookkeeping mismatch instead of fixing it.

Unpatched 3.18.0 uses a tab-wide consumed timestamp across source keys;
restoring or discarding a newer snapshot suppresses same/older prompts. The live
repeated refresh test exposed that this defeats recovery with no file save. A
versioned pnpm compatibility patch now removes the consumed timestamp from
native recovery admission in both shipped module formats. Restore preserves the
snapshot; Discard deletes only its own record. The native discard handler closed
the prompt before its asynchronous storage operation completed, so a fast reload
could abandon deletion. The compatibility patch keeps the prompt busy and blocks
both actions until that operation completes. A delayed IndexedDB completion
regression verifies the busy guard and immediate reload without a new prompt.
Native storage, switch, source keys, single-prompt mount guard and 24-hour
window remain intact. No runtime code clears or overrides the component's
private sessionStorage keys. The dependency patch is explicit in the lockfile
and documented in `patches/README.md`; this is not an assertion about unpatched
3.18.0. Browser regressions cover repeated restoration of an added third slide
and explicit discard. Retire the patch when a released upstream version passes
the same scenarios.

## Rejected operation versions (2026-09-16)

Operation validation can reject a request before any public editor write, such
as referencing an element missing from the requested slide. Such a rejection
preserves both the base version and the previous edit receipt, allowing a
corrective navigation using that unchanged base. Track the first attempt through
the shared commit callback. Once a public write is attempted, an exception still
invalidates the version and records failure because partial state or history
changes are possible. Successful operations continue to consume their base
version.

Do not infer this boundary from an unchanged content fingerprint: a failed
public write can affect selection or history without changing slide content.
Unit regressions cover rejected preconditions, receipt preservation, corrective
navigation, and partial mutation failure with replay rejection. The real-viewer
browser regression also rejects an invalid target without consuming its base.
Valid element operations now automatically select the requested slide after
preflight validation; explicit navigation remains available for viewing.

## Native file controls (2026-09-16)

The user chose one set of viewer-owned file controls. Remove the plugin's
Open/Save/status header and its Ctrl+S interception. The native File > Open >
Browse this device action invokes the existing public `onOpenFile` adapter; Open
PPTX remains in the empty state. The native Save button serializes and downloads
the presentation. The pinned viewer has no Save keyboard binding; the plugin no
longer overrides the browser's Ctrl+S / Cmd+S behavior. AutoSave remains browser
recovery only. No loaded-document duplicate buttons, overwrite picker, or plugin
saved label are exposed. Connection failures and retained-editor recovery still
have their existing exceptional feedback.

Keeping two save surfaces would imply conflicting persistence semantics. Native
controls were chosen over the plugin's explicit overwrite workflow; original
files and attachments stay unchanged. The low-level writer and save integrity
tests remain internal capabilities, not a UI persistence guarantee. The viewer
has no public download-completion event. Close/replacement protection therefore
remains conservative after a download rather than falsely acknowledging a disk
write or discarding retained work.

Browser regressions use real native downloads and reopen their bytes through an
adapted OS picker. They verify inserted slides, formatted text, undo, preserved
chart/workbook data, and that no original-file write occurs. Recovery remains
covered separately. No DSH source change is required.

## Authored paragraph read projection (2026-09-16)

The published parser can expose an inherited zero left margin on element/run
styles while retaining the authored margin in `paragraphProperties` and
`paragraphIndents`. A native export/reopen regression preserved 20 px in OOXML
and rendering but previously reported zero to the Agent. Project authored
paragraph metadata over inherited styles, with per-paragraph indentation taking
precedence. The element summary uses the first paragraph and run summaries
retain their respective paragraphs. Do not modify the viewer model or rewrite
correct serialized bytes to repair a read projection. Tests cover explicit zero,
mixed paragraphs, and real native download/reopen with rendered indentation.

## Public structured-element editing (2026-09-16)

Use released `addElement` and `updateElement` for conversational table creation,
cell edits and structural changes. Clone and validate before one live update;
never write through `getSlides()` snapshots or invoke internal AI bridges. One
table update owns one native undo step. Table font sizes are points rather than
the text-box API's CSS pixels. Explicit cell colors clear competing theme
references; text changes clear stale rich runs. Structural operations reject
merged tables until merge-aware editing is independently supported. Font-family
edits, font-only edits to multi-run cells, and structural changes in tables
containing multi-run cells are excluded: the released public serialization path
does not preserve those changes or untouched rich formatting.

Read projections share a 128,000-character budget for table/chart details and
expose bounded cell data and formatting with a truncation flag, never raw XML,
binary bodies or filesystem authority. Optional values must be normalized to
valid JSON before the editor transport validates its response. Synthetic unit
and real-viewer export/reopen tests cover these boundaries; live DSH
natural-language validation is a separate acceptance step.

An internal component AI bridge is not a public editor integration contract. The
user chose released APIs over adding a new dependency capability patch. Missing
slide/theme/animation setters should be documented rather than bypassed with
mutable snapshots, untracked byte replacement or private React state.

Charts use the same public element mutation path. Imported category, type,
grouping and direction edits are rejected; scatter/bubble creation and editing,
gridline/background controls and independent title visibility are excluded after
native save/reopen failures. New charts support six verified families; model
fields alone do not establish save fidelity. Browser tests verify chart caches
and embedded workbook values. Table/chart payload truncation preserves document
identity, version and target IDs so oversized details do not prevent later
edits.

Element mutations select the requested slide only after version, target and
patch preflight checks, then use the normal public editor update and history. A
failed navigation or update still invalidates the request base. This removes
avoidable model navigate/read retries without weakening stale-document checks.
Tool validation errors use bounded single-line field paths and explicit envelope
instructions instead of unreadable multiline Zod output; they never echo inputs.

Image insertion resolves only admitted user image references from the exact DSH
conversation through the public attachment store. A 1 MiB normalized-byte limit
keeps the base64 command inside the existing transport bound. The model supplies
an attachment ID, never a path or binary body. Crop, opacity, brightness and
contrast pass native export/reopen checks; grayscale is excluded after an actual
round-trip failure. No internal bridge or dependency API patch is introduced.
The public capability matrix separates missing interfaces from serializer limits
and adapters not yet implemented.

## Native table AutoSave normalization (2026-09-16)

The released table serializer materializes `locks.noGrouping = true` on new
model elements during recovery saves. Compare table locks with that same default
when fingerprinting, while preserving explicit `false` and every other lock.
Otherwise an unchanged new table expires the Agent's version during the native
AutoSave debounce. This normalizes the comparison only; it does not mutate the
live model or disable manual interaction fencing. A failing-before-fix unit
regression and a real AutoSave/pending-edit browser case cover the boundary.

## Published editor 3.19.2 compatibility (2026-09-17)

Upgrade the actual React dependency to 3.19.2; the umbrella CLI package is not
an editor runtime dependency. Import Chinese translations through the released
`pptx-react-viewer/i18n/zh-CN` export and remove the copied dictionary. Locale
key and interpolation checks remain tied to the installed component.

Rebase the existing recovery patch onto the published ESM and CommonJS chunks.
The upstream release still needs per-document recovery admission, awaited
snapshot discard and bounded dialog filename rendering. Do not add private API
bridges. The public `updateElements` API is now available for cross-slide
batches; its separately verified adapter is documented below.

Verification: 216 unit tests, type/lint/build/package checks and 26 real-editor
browser regressions passed. Browser tests use controlled DSH registrations; the
already running DSH service was not restarted for this upgrade. README images
were captured in separate live DSH conversations on the preceding component
version and are not evidence of the upgraded runtime.

## Serialization caches and native history (2026-09-17)

Published 3.19.2 serialization updates slide and element `rawXml` caches and
assigns `shapeId` archive numbers to new elements in place. AutoSave followed by
navigation could therefore add a content-free history entry after a public
cross-slide batch. Native undo consumed that entry without reverting the batch,
and the plugin correctly rejected the unchanged result. Reproduced through both
the public ref and a live DSH conversation.

Extend the existing exact-version compatibility patch in both module formats to
omit only slide/element `rawXml` caches and element `shapeId` archive numbers
from history equality, including group children and template elements. Preserve
element IDs, actual snapshots, nested XML in semantic properties, and all other
model fields. Do not weaken result checks, automatically replay undo, or
introduce a second history owner.

The public-ref regression verifies export, navigation, one undo and redo across
two pages. Additional failing-before-fix regressions cover new elements on both
existing and new slides, independent insertion history and redo after export.
Plugin browser regression also exercises AutoSave before navigation. This is a
bundled compatibility fix, not a claim about the unpatched package.

## Public cross-slide element batches (2026-09-17)

Expose `edit_pptx_batch` with root arguments and 1–100 distinct top-level
element targets across ordinary slides. Reuse the existing text, formatting and
geometry patch contract. Validate the document occurrence/version and every
target before building all patches, then call public `updateElements` once.
Preserve the active slide and selection. A changed batch owns one native undo
step; a no-op reports `unchanged` and zero steps. Slide insertion/deletion and
table/chart data commands remain separate operations.

The public call resolves asynchronously after its React commit. Await it in the
transport and fence other session reads, edits and saves while it is pending.
Verify every requested field in the live model before reporting success. A
rejection or uncertain result invalidates the version and requires a fresh read;
never automatically replay it or silently claim rollback after a failed check.

Repeated `updateElement` calls were rejected as the batch implementation because
they cannot offer one cross-slide history step. A private transaction bridge or
plugin-owned document/history copy is unnecessary with the released API.

Unit regressions cover preflight rejection, async fences and failure/no-op
results. A controlled-host browser case covers mixed cross-slide patches,
independent prior/subsequent undo, redo, invalid targets, stale replay and
native export/reopen. A new live DSH conversation also centered two titles
through one batch call, then a separate natural-language request reverted both
through one undo after AutoSave and navigation, without tool errors or retry.
Actual DOM alignment was checked on both pages. This source capability is not
included in published plugin 0.1.1.
