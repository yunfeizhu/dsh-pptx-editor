# Using dsh-pptx-editor

[English](usage.md) · [简体中文](usage.zh-CN.md)

## Install 1.0.0

**This version is not yet published on GitHub Releases or npm.** Install Node 24
and configure DeepSeek Harness, then build the package from source:

```sh
git clone https://github.com/yunfeizhu/dsh-pptx-editor.git
cd dsh-pptx-editor
corepack enable
pnpm install --frozen-lockfile
pnpm build
pnpm check:package
dsh plugin --profile web add ./.cache/packages/dsh-pptx-editor-1.0.0.tgz
dsh web
```

The package includes the host plugin, browser client and editor assets. Do not
also load the source `dsh.patch.yml`, which would register the plugin twice.
Future prebuilt packages will be available from
[GitHub Releases](https://github.com/yunfeizhu/dsh-pptx-editor/releases); verify
downloads against `SHA256SUMS.txt` before installation.

### Migrate from the previous name

Save open documents and stop DSH Web first. If you installed the old package,
run `dsh plugin --profile web remove dsh-pptx-viewer`, then install the new
package and restart DSH Web. Existing npm packages keep their original name and
version; this rename does not replace them. Browser AutoSave recovery
identifiers remain unchanged.

To remove the new package, run
`dsh plugin --profile web remove dsh-pptx-editor`, then restart DSH Web. Removal
does not delete browser recovery data.

## Run from source

For development, use Node 24, the pnpm version in `package.json`, and a
configured local DeepSeek Harness:

```sh
pnpm install --frozen-lockfile
pnpm dev
```

The host compatibility baseline is DSH CLI `0.1.5-rc.1` with public plugin
packages `0.1.5-rc.2`. Plugin `1.0.0` bundles `pptx-react-viewer` `3.19.2`. The
source launch patch registers the local build; removing it from the launch
command disables that build.

To keep development separate from your normal DSH configuration:

```sh
pnpm build
DSH_HOME="$PWD/.dsh-dev" dsh web --patch ./dsh.patch.yml --port 3082 --no-open
```

Open the login link printed by DSH. Configure a model through DSH's normal
settings if using a new profile. The plugin uses the model selected in the
conversation; it needs no separate provider key.

Use a current Chrome or Edge browser. Native file pickers and state-preserving
iframe moves are required. The server must listen on `127.0.0.1`; remote-server
file editing is outside this version's scope.

## Open and edit

### From a chat attachment

Use **Add attachment** in a new or existing conversation, select one `.pptx`
file up to 50 MiB, and send it with your request. The plugin opens the newly
sent attachment in the right sidebar. For a preview, ask “Preview this
presentation.” After it loads, the Agent can edit it directly through the same
conversation.

The sidebar's Start page has no separate PPTX entry. Sending an attachment is
the starting point; conversation requests can reopen its editor later.

Choosing an attachment without sending the message does not open it. This
version uses DSH's public admitted-message feed, which has no draft-upload
completion event. On a fresh page or when first opening an older conversation,
the plugin restores its latest PPTX attachment from the loaded history unless
you explicitly closed its PPTX tab. Closing is remembered for that conversation
in the current browser tab, so refreshing keeps it closed. Ask to reopen it or
send a new PPTX attachment to open it again. If browser storage is unavailable,
automatic history opening is skipped; explicit opens still work. This stores
only the close preference, not the document. Paging through older messages does
not replace the open document. Send one PPTX per message to identify the
document unambiguously. Loading a replacement temporarily locks the previous
editor; unsaved changes require a discard decision, and a failed download
preserves it.

Use the viewer's **Save** button to download the edited PPTX. The browser's
download settings determine its destination. The original local file and chat
attachment remain unchanged; the plugin does not overwrite them.

### Edit the opened presentation

1. Edit with the component's full toolbar, thumbnails and properties. Expand the
   DSH panel to full screen when more space is needed.
2. In the conversation, ask for a change on the currently selected slide, for
   example: “Use the PPTX tools to change the cover title to Project Nova.”
3. The Agent applies the change directly to the canvas, without a separate
   confirmation step. Use the editor's **Undo** and **Redo** to reverse it.
4. Click the viewer's **Save** button (disk icon) to download the edited PPTX.
   To select another file, use **File > Open > Browse this device**. There is no
   separate plugin file toolbar.

To reopen a closed or hidden panel, say “Reopen the PPTX on the right.” The
`open_pptx` tool reveals the retained editor and waits until it is visible and
ready. It preserves unsaved edits and undo history within the same browser page.
After a page reload, the uploaded original is reopened and the viewer can offer
a matching AutoSave recovery copy; locally picked files need to be selected
again. Recovery does not restore undo history. Native attachment-card clicks are
not supported by the current plugin API.

`read_pptx` reports the live document, selected element IDs, available history,
supported operations, text runs, formatting and geometry. `edit_pptx` changes
one top-level element on the specified slide. Geometry uses CSS pixels; rotation
uses degrees. Font sizes also use CSS pixels (32 pt in PowerPoint is about 42.67
px). Text replacement retains the first run's style and replaces rich text runs;
format-only edits preserve run boundaries and unrelated styles. A successful
change returns `status: applied` and a new document version. Tools do not save
to disk.

The element-level formatting summary describes its first paragraph. Per-run
formatting includes authored paragraph settings, so imported indentation takes
precedence over inherited defaults after saving and reopening.

### Batch element edits (0.2.0)

Ask, for example: “Center the titles on slides 1 and 2.” The Agent reads both
targets, then calls `edit_pptx_batch` with root arguments
`{documentId, version, summary, edits: [{slideIndex, elementId, patch}, ...]}`.
It accepts 1–100 distinct top-level targets and the same patch fields as
`edit_pptx`. Every target is checked before the released `updateElements` API
applies the batch with one independent undo step. The active slide and selection
stay unchanged. An invalid target or stale base rejects the whole batch; an
uncertain failure still requires rereading before retrying. A batch with no
actual changes returns `unchanged` and zero undo steps.

Batches do not include slide/element insertion or deletion, table/chart data
updates, or disk saves. Separate tool calls still have separate history steps.

### Formatting and paragraph alignment

For example: “Center this title, make it bold and blue, with 1.5 line spacing.”
The Agent uses the selected element and the latest read. With no unambiguous
target, it should clarify which element to change.

| Field              | Supported changes                                                                                                             |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `patch.textStyle`  | Font family/size, RGB color, bold, italic, underline, strikethrough                                                           |
| Paragraphs         | `align`: left/center/right/justify; `vAlign`: top/middle/bottom                                                               |
| Spacing            | Line-height multiplier, paragraph spacing before/after, left/right paragraph margins, first-line indent, four text-box insets |
| Lists              | `listType`: bullet/numbered/none, applied to all paragraphs in the box                                                        |
| `patch.shapeStyle` | Solid fill or no fill, fill color, outline color/width on text boxes and shapes                                               |
| Geometry           | x/y/width/height, rotation, horizontal/vertical flip                                                                          |

Paragraph alignment changes text **inside its existing box**. It does not shrink
or reposition that box. Formatting applies to the whole element, not a selected
character range. New text accepts the same `textStyle` fields; these override
the legacy `fontSize`, `color` and `bold` insertion fields.

Imported custom numbering (such as letters or Roman numerals) must be converted
through the editor UI; conversational lists use decimal numbering with periods.

### Pages, shapes, elements and history

`operate_pptx` accepts an `action` object with the same current document
ID/version as editing:

- `navigate`: select a slide for viewing. Edits automatically select their
  target slide after validating the document version and requested targets.
- `duplicate-slide`, `delete-slide`, `move-slide`, `set-slide-hidden`: manage
  pages. Indexes start at zero; the move destination is the final position.
  Duplicating selects the new page. The last page cannot be deleted.
- `add-shape`: insert a rectangle, rounded rectangle, ellipse, triangle,
  diamond, hexagon, chevron or right arrow, optionally with styled text.
- `duplicate-element`, `delete-elements`: copy or remove specified top-level
  elements on the specified slide. A copy receives new IDs and defaults to a 16
  px offset in each direction.
- `arrange-elements`: align two or more unrotated elements to their combined
  left/center/right/top/middle/bottom bounds, or distribute three or more with
  equal horizontal/vertical gaps. This aligns element boxes within the
  selection; it does not center paragraphs or align to the slide. Distribution
  rejects a selection with insufficient room for non-overlapping gaps.
- `undo`, `redo`: one step of the editor's shared history, including manual
  edits. They are not limited to Agent operations.

Examples: “Copy slide 2 and move the copy to the beginning”, “Delete this
shape”, “Align these three boxes along the top”, “Undo the last change”.
Multi-element arrangement uses separate public updates: each changed element has
its own undo step. A failed operation can leave partial changes; read the actual
state before retrying. There is no automatic rollback of a sequence.

A successful `read_pptx` reports `preview.status: ready` and the slide count.
Its `readProjection` describes the text, formatting and geometry returned to the
Agent; table values and styles are included (at most 100 rows and 30 columns,
with a truncation flag). Chart categories/series/styles are also included (up to
20 series and 1000 points). Notes and image text are excluded from this
response. Those omissions do not indicate missing objects in the visual preview.
Simple preview requests need no extra shell scripts or conversion.

Finish inline text entry before asking the Agent or downloading the file. Manual
interaction, navigation, undo or a document switch makes an earlier read version
stale. The Agent must read again before applying another edit. Opening another
file creates an independent document identity, even when its name and size
match.

Each new editing turn requires a fresh `read_pptx`, including after answering a
clarification or reloading the page. `Stale edit` rejects that request before
any change; the Agent must re-read and reassess before retrying. This rejection
is returned in the conversation without a duplicate editor toast. It does not
mean AutoSave failed. Actual editing failures still appear in the editor.
AutoSave's archive IDs, page numbers and default table grouping lock do not
advance the editing version; content, element identity and slide structure
remain checked.

### Add slides and text through conversation

For example: “Add a third slide at the end, with the title Next steps and a text
box containing Define goals, Build, and Verify.” Or: “Insert a blank slide after
slide 1.” The Agent first reads the document, adds the slide, then adds text to
the new active slide. Changes appear immediately, with no extra confirmation.

- `add_pptx_slide` adds one blank slide and selects it. By default it appends;
  `afterSlideIndex` inserts after a specific existing slide. Tool indexes are
  zero-based, so slide 1 has index 0.
- `add_pptx_text` adds one text box to the specified slide, with text and
  explicit x/y/width/height in CSS pixels. Optional insertion styling includes
  font size (CSS pixels, default 24), `#RRGGBB` color (default black) and bold
  (default false), plus the full `textStyle` formatting fields above. A title
  and body use separate text boxes. The returned element ID can subsequently be
  used with `edit_pptx`.
- Every insertion requires a current document ID and version. The Agent reads
  again between operations. Finish inline editing first. After a timeout or
  failure, read the actual state before deciding whether to repeat an insertion.
- Each slide or text-box insertion has its own **Undo/Redo** step. Adding a
  slide plus two text boxes takes three undo steps; these calls are not one
  atomic transaction. If a later call fails, earlier successful changes remain
  editable.
- These operations do not write to disk. Use the viewer's **Save** button to
  download a file containing your changes. After rebuilding the plugin, restart
  the DSH development service to register the new tools; save open work before
  restarting.

## Saving and lifetime

> **AutoSave is a local browser recovery cache (IndexedDB), not automatic
> writing to a PPTX file.** “Saved to this computer” describes that browser
> copy, not a file in your Downloads folder or an updated attachment. Use
> **Save** to download the edited `.pptx`, and check that the download
> completed.

- The component's native **AutoSave** switch is enabled by default, respecting
  the preference saved in its settings. Every two seconds it checks for edits
  and writes a recovery snapshot to this browser's IndexedDB. It covers Agent
  and manual edits without writing the local PPTX.
- Reopen the same source in the same conversation and browser to check for the
  native **Recover unsaved changes?** prompt. Choose Restore or Discard before
  asking the Agent to continue. Uploaded occurrences are isolated, even when
  names and bytes match. Local recovery matches the file name and original
  bytes; identical local copies in one conversation share that recovery slot. A
  changed local source or newly uploaded attachment has a different slot.
- Recovery stores an unencrypted presentation in browser storage. It does not
  preserve undo history or file-write permission, and cannot guarantee edits
  made before the next snapshot. Clearing browser data removes recovery copies;
  storage errors remain visible in the viewer. Turn AutoSave off to stop new
  snapshots; use Discard in the native recovery prompt to remove a prior copy.
- Recovery prompts cover snapshots from the last 24 hours. This repository
  includes a pinned component compatibility fix: restoring a snapshot leaves it
  available after another refresh, and restoring/discarding one document does
  not suppress another document's prompt. Explicit Discard removes that source's
  snapshot. **Save to a local file for durable file storage.**
- The native Save button downloads a new file; it does not overwrite the opened
  file or the chat attachment. Check the browser's downloads for completion.
- Close and replacement guards remain conservative. The viewer has no public
  download-completion notification, so downloading does not clear the plugin's
  guard. Selection or navigation can also mark the editor as changed. A later
  close or file switch may still ask you to keep or discard the in-memory work.
- Switching DSH tabs or hiding the sidebar retains the document and undo history
  while its tab record exists, including client-module hot reloads during
  development. Closing a loaded tab keeps its editor in memory. Unsaved
  documents also show a compact notice with **Continue editing** and **Discard
  changes** actions, following DSH's language and theme. **Hide notice** only
  dismisses the notice; it keeps the document. Continuing opens the retained
  editor without saving a file. Reopening PPTX in the same conversation also
  restores that editor. Agent commands are suspended while closed. This full
  in-memory editor does not survive refresh or browser exit. AutoSave can offer
  its last completed snapshot on reopening, but explicit saving remains the
  reliable way to preserve a local file.
- Only one open PPTX panel can own a conversation at a time. A disconnected
  owner expires after about 15 seconds. Healthy connections have no toolbar
  indicator. If the connection fails, use **Retry** to retain the current
  editor. The button is disabled while reconnecting and disappears after
  recovery. Commands with uncertain outcomes are not replayed.
- Automatic overwrite saving, editing masters/animations, grouping and
  layer-order manipulation are deferred. Rich text formatting is currently
  whole-element only. The editor's built-in AutoSave is recovery storage, not
  automatic overwrite of your file.

## Data and compatibility

When the Agent calls `open_pptx` or `read_pptx`, the file name and live slide
text/formatting/geometry, table values/styles, chart data and image properties
become part of that DSH conversation and can be sent to its configured model
provider. The plugin itself does not log document bodies or upload the original
PPTX. DSH retains conversation/tool history according to its own configuration.

Files sent as chat attachments use DSH's normal upload and attachment storage.
The plugin fetches only a file admitted to the current conversation, using DSH
authentication. This differs from opening a local file in the editor's picker.

Verified browser fixtures cover text, shapes, a table, an image, speaker notes,
a chart and its embedded workbook through save and reopen. This is not a general
PowerPoint fidelity guarantee. Complex documents, macros, signatures and
third-party presentation extensions need separate validation.

Plugin messages and the full editor follow the current DSH language. Change it
in DSH **Settings > General**; both update without replacing your document or
undo history. The plugin has no separate language selector. Chinese and English
are supported; other DSH languages use English. The editor starts with a light
theme and reuses any saved theme choice. Change its theme in **File > Options >
General > Viewer theme**. Plugin controls follow the DSH shell style.

## Troubleshooting

- **After updating plugin code:** save open documents, restart DSH, reload the
  page and reopen the file. Existing editor frames retain their loaded code; a
  client-module hot reload alone does not update the editor or host tools.
- **PPTX does not open after sending an attachment:** for an installed package,
  check that it was added to the active Web profile and restart DSH. For a
  source checkout, run `pnpm build`, launch with `dsh.patch.yml`, and reopen
  DSH.
- **Open file picker does not appear:** use Chrome or Edge. Some embedded
  browsers expose the API but do not display its native picker correctly.
- **Agent cannot find the editor:** open PPTX in the same conversation. If a
  connection warning appears, use **Retry** and wait for the warning to
  disappear. Finish any active text field before retrying.
- **Connection after refresh:** the departing page releases its ownership. If
  the browser drops that request, the new page waits up to about 20 seconds for
  the old lease to expire and reconnects automatically. A different active
  browser window keeps ownership; close its PPTX panel and retry.
- **Downloaded file not found:** check the browser's downloads and download
  folder settings. If the download failed, keep the editor open and retry its
  Save button. AutoSave recovery does not create a file in that folder.

## Tables through conversation

Ask “Add a two-column table for item and score”, “Change the second row's score
to 42 and center it”, or “Insert an empty row at the end”. The Agent uses
`operate_pptx` with `add-table` or `update-table`. Cell text, font size,
emphasis, colors, fills, alignment, margins and per-edge borders are supported,
along with row/column insertion and deletion, row heights, relative column
widths and header/banding flags. Table font sizes use points; geometry uses
pixels.

Each table operation uses one viewer update and one undo step. All cell targets
are validated before updating. Text replacement removes that cell's rich runs;
style-only changes preserve unrelated formatting. Merged cells can be edited
through their anchor; structural changes currently require an unmerged table.
Creating/editing tables is limited to 100 rows by 30 columns. Table font-family
changes are excluded because the released serializer does not preserve them.
Font-only edits to multi-run cells, and structural changes to tables containing
such cells, are rejected to avoid losing formatting. Explicit text replacement
remains available when replacing those rich runs is intended.

Table/chart reads share a 128,000-character detail budget. Oversized details are
truncated with a flag; document identity/version and element IDs remain
readable. Only send fields that should change, rather than copying a whole read
result.

## Charts through conversation

Ask “Change the chart values to 42, 60 and 80” or “Add a pie chart with shares
30 and 70”. `add-chart` supports six families: bar/column, line, pie, doughnut,
area and radar. `update-chart` changes title, data, legend and labels. Newly
created charts also support type, grouping and bar-direction changes. Replacing
`series` replaces the entire supplied series list; read first to retain data
that should remain. Each chart operation has one undo step.

The released serializer does not reliably persist category, type, grouping or
direction changes in imported charts. These changes are rejected; create a new
chart instead. Scatter/bubble creation and editing are excluded because x-values
and bubble sizes are not reliably saved. Gridline/background controls and
independent title visibility are also excluded after round-trip failures.
Specialized and combination charts remain outside these conversational
operations. These are compatibility limits, not new component APIs supplied by
this plugin.

## Images through conversation

Upload an image in the same conversation, then ask “Insert the uploaded picture
on slide 3, crop 10% from the left, and set its opacity to 80%.” The Agent calls
`list_pptx_images` to identify admitted attachments and `add_pptx_image` to
insert one on the specified slide. `update-image` changes alternative text, edge
crop fractions, crop shape, brightness, contrast and opacity. Geometry, rotation
and flips use `edit_pptx`. Each insertion or image update has one undo step.

The current transport supports normalized PNG/JPEG/WebP/GIF images up to 1 MiB.
Only user-uploaded images admitted to this conversation are eligible; paths,
remote URLs and attachments from other conversations are rejected. The plugin
passes the verified bytes directly to the editor, without placing image bytes in
its tool result. DSH's normal image upload and model processing still apply.
Image text recognition is not part of `read_pptx`.

Grayscale editing is excluded for now: the released viewer displays it but loses
that flag when reopening its own saved file. See the
[capability boundaries](capabilities.md) for missing APIs and compatibility
gaps.
