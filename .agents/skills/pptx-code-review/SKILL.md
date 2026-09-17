---
name: pptx-code-review
description:
  Review dsh-pptx-editor changes for document state, direct editing, undo, save
  integrity, component compatibility, and workflow security. Use for a
  substantive diff review.
---

# PPTX Code Review

Read [AGENTS.md](../../../AGENTS.md) and affected subtree guidance. Remain
read-only unless fixes are requested. Identify the real base and include
committed, staged, unstaged, and untracked task changes.

Trace public component calls through state updates, history, serialization, and
disk writes. Prioritize stale or repeated edit requests, partial batches, lost
manual edits, duplicate/out-of-order events, open-document ownership, disposal,
and falsely reported saves. Check supported public exports against actual
package versions and validate any claimed fidelity with fixtures.

For automation, inspect token scope, trusted checkout origin, untrusted input,
failure propagation, and release/merge authority. Formatter findings belong in
CI.

An initial independent review reports all P0/P1 and worthwhile P2 findings with
locations and evidence. After one repair batch, the termination pass reports
only P0/P1; do not reopen optional P2 cycles. Substantive edits require a new
termination review. State what was reviewed and what remains unverified.
