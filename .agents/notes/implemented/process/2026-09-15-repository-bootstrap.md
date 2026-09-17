# Agent Note: Repository bootstrap

Status: implemented

## Problem

The project needs repeatable contributor checks and portable AI guidance before
plugin implementation. Earlier feasibility probes were disposable and the user
requested an empty directory followed by a fresh configuration baseline.

## Decision

Use the local Harapter project's governance structure as a reference, adapting
it to one package with no runtime source. The repository defines one root Agent
guide, Claude forwarding instructions, review/pre-push/note skills,
deterministic checks, PR metadata validation, Dependabot, and manual release-PR
preparation.

Use Apache License 2.0, matching Harapter, for the public repository. The
initial private-package guard is superseded by the distribution decision below;
repository visibility and actual npm publication remain separate facts.

Issue forms use explicit title prefixes and request one language per issue,
English by default or Simplified Chinese. Bilingual documentation does not
require translating an issue body. Completing PRs use closing references;
partial work uses ordinary references. Default-branch automation infers one
category, creates the label when missing, and only adds labels. It does not send
issue text to a model or remove maintainer labels. Unknown titles receive triage
unless a known category is already present. Edits can add another category;
maintainers resolve obsolete categories manually.

Public onboarding and community documents use synchronized English and
Simplified Chinese pairs with reciprocal language links. Internal plans and
procedures may use either language; code comments and API docstrings use
English. The root Agent Guide owns the language rules. The README follows the
reference project's presentation structure while marking planned features and
omitting unavailable package or release badges.

Community entrypoints are CONTRIBUTING, CODE_OF_CONDUCT, and SECURITY, separate
from internal Agent guidance. Security instructions include a contact-request
fallback when GitHub private reporting is unavailable; they do not claim a
reporting setting is enabled or a runtime release exists.

## Alternatives considered

- Copying the whole reference workspace would add unrelated provider
  architecture, history, publication scripts, and credentials assumptions.
- Leaving only Markdown guidance would not make workflow and metadata rules
  executable or regression-tested.
- Generating placeholder plugin code to satisfy CI would confuse tooling
  evidence with implemented functionality. A no-source build reports an explicit
  skip.
- English-only community documents would not satisfy the bilingual onboarding
  requirement. Translating every internal note would add unnecessary
  maintenance.
- Model-based Issue classification would require provider setup and additional
  data handling. Explicit prefixes are sufficient for the initial forms.

## Consequences

The checkout can be checked locally and prepared for GitHub, but it contains no
plugin runtime. Remote checks, protections, model review integration, and
package publication require separate setup and evidence. No remote resources are
created by this initialization. Keeping publication absent avoids a workflow
with no valid artifact to publish. Future UI source needs the appropriate
browser build configuration and consumer tests.

The selected Markdown tooling still resolves smol-toml 1.7.0 by default. A
narrow override follows the reference project's patched 1.7.1 selection for
GHSA-7w5x-hrqm-74c2; remove it when the direct dependency resolves a patched
version.

Public documentation changes require paired language review. Translation parity
is a review responsibility; the current link checks do not prove semantic
parity.

## Distribution decision (2026-09-16)

Prepare the first standard DSH bundle under the previous package name at
`0.1.0`. The packed `cordis.patch.yml` resolves the installed package by name;
the development `dsh.patch.yml` continues to resolve the local build. Shipping
both loading mechanisms does not mean they should be enabled together.

The editor, including the pinned component compatibility patch, is compiled into
browser assets. Browser-only dependencies are development dependencies; Zod is
the host runtime dependency. Optional DSH peer declarations record the tested
contract without causing a second harness installation. A clean DSH tarball
installation initially failed on a transitive core-js build-policy rejection;
after this split, a fresh profile installed only the plugin and Zod
successfully, without build approval. Structural tarball validation is part of
`pnpm check`; consumer installation and actual harness boot are separate
evidence.

The publication pipeline accepts a stable tag and exact main-ancestor commit,
checks and packs that immutable code, and prepares a draft release. A separate
protected OIDC job dispatched from that same tag publishes the checked artifact;
the workflow SHA must equal the approved commit so provenance cannot name a
different revision. First registration may require interactive npm
authentication and publishing the already checked release tarball; no
placeholder version, long-lived CI token or mutable checkout publish is used.
Workflow definitions do not prove remote environment protections, OIDC setup, CI
execution or publication. The owning procedure is
[GitHub setup](../../../../docs/github.md).

The browser build collects LICENSE, COPYING and NOTICE files for every bundled
dependency. Published tarballs missing those files require version-specific
license copies from pinned official upstream commits. Unknown missing notices
fail the build; the final tarball must include the generated notice file.

Alternatives rejected: source-only Git installs require consumers to approve
build scripts; shipping browser dependencies as runtime dependencies triggers
unnecessary installs and build policies; publishing directly from the working
checkout breaks the reviewed artifact boundary.

## Promote checked CI artifacts (2026-09-17)

PR metadata edits have a separate read-only workflow so editing a description
cannot cancel or rerun code CI. Required check names remain stable. Main-push CI
builds and packs once, runs browser regression against that build, and seals the
package with commit, run-attempt identity and SHA-256. Release preparation only
accepts successful CI from this repository's main push and exact approved
commit; PR, fork, manual CI and failed runs cannot supply release bytes. Missing
or expired artifacts require rerunning that main-push CI, not a release-time
rebuild. The browser-evidence decision below supersedes the original
unconditional browser checks on documentation and version changes.

The protected npm job has contents-write solely because GitHub draft release
reads require it; workflow defaults and CI remain read-only. Publication uses an
explicit local tarball path. Release Please failures explain the external
Actions PR-creation setting but never change it automatically or bypass merge
gates. Main CI and PR checks remain distinct trust boundaries.

Alternatives rejected: rebuilding during release repeats checks against
different bytes; accepting arbitrary successful workflow artifacts weakens
provenance; publicizing a draft solely to avoid its read permission publishes
prematurely. Local policy, source-identity, checksum and tarball integration
tests verify these contracts. Remote workflow execution, environment approval,
repository settings and OIDC publication still require separate evidence.

## Reuse browser evidence, not PR release bytes (2026-09-17)

The 0.2.0 release ran the same 30 browser cases four times: feature PR, feature
merge, version/documentation PR, and version merge. A new evidence planner runs
after each checkout's normal checks/build. It compares a conservative Git input
digest (only known documentation and version metadata excluded), all built
files, and the runner/Node environment. It recomputes candidate Git inputs
instead of trusting an uploaded digest alone. GitHub must confirm the exact
successful same-repository CI run/attempt and actual browser/record steps. The
source must be an ancestor main run, an earlier head in the same PR branch, or a
PR whose main merge is an ancestor of the current checkout.

PR evidence checks both its branch head and actual tested synthetic merge input
hashes, including the two-parent merge relationship to that head. Push evidence
must test its exact run commit. A matching artifact digest alone is
insufficient. This intentionally rejects stale-branch evidence when only its
merge tree matches: the producer's branch inputs must also be verifiable as
unchanged.

Only actual browser execution creates a 14-day JSON witness. Reused jobs cannot
create chained witnesses. Failed, fork, unrelated, manual, expired or mismatched
evidence is rejected; API/read failures fall back to actual tests. Manual CI
forces testing. The bounded search and summary identify the reason and original
run. Main creates its own package with the correct version and retains the
existing release-artifact identity/checksum boundary.

Alternatives rejected: path-only skips can hide changed build results; a shared
cache key is not proof of successful tests or trusted origin; skipping every
main run assumes unchanged merge inputs; reusing arbitrary PR tarballs weakens
publication provenance. Tests cover the four-stage release sequence, real Git
version/docs equivalence, build drift, unsafe sources, missing permissions and
bounded artifact reads. Static/local tests establish decision behavior; actual
GitHub reuse and environment identity require separate remote verification.

## GitHub identity and rebuilt history (2026-09-17)

Repository-local Git identity must match the authenticated GitHub owner and use
that account's GitHub no-reply email. Global workstation identity is not a safe
default for public commits. Check both author and committer fields, taggers and
commit trailers before pushing; the account used for transport does not rewrite
those fields.

The owner requested a fresh repository with focused module commits. Rebuilding
the public history intentionally retires old Issue/PR identifiers, tags and CI
evidence. Local private backups are excluded from the new Git object database.
Runtime source stays unchanged. The new main-push CI establishes one browser
baseline; release preparation promotes its package without rerunning browsers.
The prepared 1.0.0 build does not publish a tag, GitHub release or npm package.
Existing npm packages and their provenance remain unchanged. External repository
protections must be restored and verified after creation, and npm publisher
identity must be rechecked before future publishing.

Alternatives considered: rewriting branch history leaves GitHub-managed PR
references; reusing old release artifacts would associate them with a different
source history. A fresh repository loses its old collaboration records and
requires new CI evidence, but makes the public commit baseline explicit.

## Rename the public package (2026-09-17)

Use `dsh-pptx-editor` for the repository, npm package, DSH host/client
identifiers, internal event namespaces and release artifact checks. The first
intended release under this name is 1.0.0; preparing a build does not authorize
publishing a tag, GitHub Release or npm package. Keep upstream component package
names unchanged. The old npm package remains separate and must be removed before
loading the renamed plugin. Preserve native browser AutoSave recovery keys and
migrate explicit panel-dismissal preferences so renaming does not discard
recovery data or reopen deliberately closed panels.
