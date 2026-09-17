# Agent Note: Constrain the fixture generator's image parser dependency

Status: implemented

## Problem

The browser fixture generator `pptxgenjs@4.0.1` declares `image-size@^1.2.1`.
GitHub dependency review rejects the resolved 1.2.1 for
[GHSA-5p2g-fcmc-qvqq](https://github.com/advisories/GHSA-5p2g-fcmc-qvqq) and
[GHSA-w3rx-r6r6-pgpr](https://github.com/advisories/GHSA-w3rx-r6r6-pgpr). The
dependency is used only by the development fixture generator, but it still
belongs to the repository's dependency graph and security gate.

## Decision

Use the exact, parent-scoped override `pptxgenjs@4.0.1>image-size: 2.0.4` in
[pnpm-workspace.yaml](../../../../pnpm-workspace.yaml), with the corresponding
registry integrity in the lockfile. Do not broaden the override to other parents
or weaken dependency review. Remove it when the generator selects a compatible
version outside the affected range itself.

This crosses the parser's major version, so compatibility evidence is limited to
this repository's synthetic generator, not arbitrary PptxGenJS consumers. The
generator uses embedded PNG data with explicit dimensions and creates text,
shapes, tables, notes, charts and embedded workbooks. Fixture generation and
browser save/reopen tests remain the behavioral validation for this path.

## Alternatives considered

- Ignore the advisories because this is a development dependency: leaves the
  known vulnerable package installed and weakens the existing gate.
- Upgrade PptxGenJS: the current published 4.0.1 still selects the affected
  major.
- Replace the fixture generator: a much larger change to independently generated
  OOXML fixtures and their round-trip coverage.

## Consequences

Only the fixture dependency resolution changes; plugin runtime dependencies and
public APIs remain unchanged. Keep the full repository checks and real-browser
fixture generation/save/reopen validation when updating this override.
