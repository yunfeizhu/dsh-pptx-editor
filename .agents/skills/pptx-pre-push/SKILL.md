---
name: pptx-pre-push
description:
  Verify dsh-pptx-viewer changes and complete independent review before an
  authorized push or merge-readiness claim. Does not authorize remote changes.
---

# PPTX Pre-Push

Read [development.md](../../../docs/development.md). Establish the actual
branch, base, and complete task diff. Preserve unrelated files. Do not invent a
remote when one is not configured.

Run `pnpm check`, then add evidence for the changed surface: browser
verification for UI, edit/undo/round-trip cases for documents, failure and
ownership cases for file writes, or workflow event/permission cases for
automation. Report absent runtime code and skipped live integration explicitly.

Before pushing, request an independent complete-diff review using
[$pptx-code-review](../pptx-code-review/SKILL.md). Repair P0/P1 and selected P2
findings in one batch, rerun affected checks, then request a P0/P1-only
termination review. A blocker or substantive later edit invalidates readiness.

Inspect whitespace, staged and unstaged changes, and the exact outgoing branch.
Existing explicit push authorization applies within its scope; otherwise report
the reviewable result and request authorization only for the external mutation.
After an authorized push, verify the remote commit and actual GitHub checks.
