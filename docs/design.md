# Initial product scope

Status: conversation-driven content, formatting, slide/element management and
history operations are implemented. See
[implementation-plan.md](implementation-plan.md) for verified and deferred scope
and [usage.md](usage.md) for the supported source-run workflow.

- Open and edit an existing PPTX in a panel adjacent to chat.
- Read the editor's latest committed state before preparing changes.
- Apply Agent changes directly without confirmation, and support undo.
- Add one blank slide or one text box per command through released viewer APIs.
  Select each new slide and keep separate Undo/Redo steps for each insertion.
- Format text, paragraphs and shapes; manage slides and top-level elements;
  align unrotated elements within their selection bounds. Read selection and
  current capabilities through public APIs. Operations share viewer history.
- Separate live page updates, browser recovery snapshots and downloaded files.
  Reuse the viewer's native file controls; do not add a duplicate plugin
  toolbar.
- Add automatic disk saving only when change detection and failure handling are
  reliable. A dedicated selection action is deferred; normal conversation can
  use the selected element IDs already exposed by the editor.

Prefer published public APIs. The released `updateElements` API now powers
bounded cross-slide element batches with one undo step. It is not a general
transaction for slide insertion/deletion. Reliable complete document change
events remain upstream API work to track.

Keep the complete component editor. Do not replace it with a custom editor or
access private component state merely to work around an unverified API gap.

## UI ownership

This is a desktop presentation tool: preserve the familiar, dense component
ribbon and canvas. The component owns file opening, Save/download and AutoSave;
the plugin offers Open PPTX only in the empty state and connection feedback only
on failure. There is no extra file toolbar or save-status label. The component
defaults to its public light theme inside an isolated iframe; DSH owns
surrounding navigation and the style of plugin controls.
`src/editor/shell-theme.ts` copies an allowlist of inherited DSH color tokens
with light fallbacks for connection feedback and confirmation dialogs. The
viewer's own theme selection never overrides the shell. See `DESIGN.md`.
`src/confirm-action.ts` owns scoped, centered confirmation surfaces and native
dialog focus/inert behavior.

### Canonical UI Map

| Capability      | Canonical owner                         | Source of truth             | Allowed variants                                  | Verification                                              |
| --------------- | --------------------------------------- | --------------------------- | ------------------------------------------------- | --------------------------------------------------------- |
| Select/Listbox  | DSH language settings / viewer settings | DESIGN.md                   | Native popup geometry                             | Shared active locale without remounting the document      |
| Scrollbar       | Isolated editor stylesheet              | DSH shell variables         | Standard and WebKit engine styling; forced colors | Computed root scrollbar style                             |
| Confirmation    | `confirm-action.ts`                     | File and recovery lifecycle | Open another file; discard recovery               | Cancel first, Escape cancels, explicit affirmative action |
| Status          | Viewer / `App.tsx`                      | Recovery / transport        | Native save feedback; plugin connection failure   | Native downloads and recovery tests                       |
| Editor lifetime | `panel-lifetime.ts`                     | DSH tab occurrence          | Mounted, parked, closed                           | Module reload and recovery tests                          |

User-facing guides are bilingual. The plugin and full component share Chinese
and English dictionaries through one i18next instance. The host supplies the
pinned upstream Chinese dictionary because the current component package only
exports English. Key and interpolation parity are checked against the installed
version. Locale/theme changes preserve the document identity and undo history.
This remains a desktop editor; narrow-panel controls do not imply full mobile
editing support.
