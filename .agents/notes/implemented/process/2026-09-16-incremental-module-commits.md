# Agent Note: Incremental module commits

Status: implemented

## Problem

Accumulating completed modules in the worktree makes their boundaries harder to
review and increases the cost of selectively reverting a change. The user has
authorized incremental local commits as each module is completed and verified.

## Decision

The [root guide](../../../../AGENTS.md) and
[development workflow](../../../../docs/development.md) require a focused local
commit for each completed and verified module, including its relevant tests.
Inspect the staged diff and preserve unrelated work. Keep distinct modules in
separate commits, and use the existing verified author identity and DCO
sign-off.

This cadence applies within the user's authorized development scope. It does not
authorize pushes, pull requests, merges, settings changes, or publication. The
existing independent review requirement still applies before an authorized push.

## Alternatives considered

- One large commit at the end: simpler staging, but harder review and rollback.
- A commit after every edit: smaller diffs, but incomplete behavior and
  unrelated checkpoint noise obscure the module boundary.
- Wait for a new commit request after every module: conflicts with the user's
  explicit standing request for incremental local commits.

## Consequences

Completed modules leave a reviewable local history instead of a growing dirty
worktree. Work in progress can remain uncommitted until its behavior is
verified. Commit messages and reports must distinguish local verification from
remote CI and live integration evidence.
