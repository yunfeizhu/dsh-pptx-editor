# Agent Notes

Record durable architecture, API, lifecycle, compatibility, security, testing,
and workflow decisions. Notes are not task logs or replacements for API docs.
Update the existing owner when a decision changes; do not create duplicate notes
for the same rationale.

Use `.agents/notes/<status>/<class>/YYYY-MM-DD-short-title.md`.

- Status: `proposed`, `implemented`, `rejected`, or `archived`.
- Class: `architecture`, `feature`, `compatibility`, `security`, `testing`, or
  `process`.
- Begin with `# Agent Note: ...`, followed by `Status: ...`.
- Include `## Problem` and `## Alternatives considered`.
- Proposed notes include Proposal, Acceptance criteria, and Risks.
- Implemented notes include Decision and Consequences, reflecting actual
  evidence.
- Preserve the original date during lifecycle transitions. Archived notes retain
  `Status: implemented`, add an archive date, and are frozen.

Start with [TEMPLATE.md](TEMPLATE.md). See the
[note skill](../skills/pptx-agent-notes/SKILL.md). Mechanical changes without a
durable decision do not need a note.
