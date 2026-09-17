# GitHub setup and release preparation

The files in this checkout define automation. They do not create a remote
repository, enable GitHub settings, register npm publishing, or prove remote CI.

## Available workflows

- **CI**: runs on PRs targeting `main`, pushes to `main`, and manual dispatch.
  It checks the repository with read-only permissions. PR title/body edits run
  only the separate **Pull request metadata** workflow. They do not cancel or
  rerun code checks; required job names stay unchanged. Browser regression uses
  the evidence policy below, so unchanged editor behavior is not tested again
  for a merge, documentation update or version PR.
- **Dependency review**: checks PR dependency changes for moderate-or-higher
  vulnerabilities. It requires Dependency Graph and the appropriate GitHub
  repository entitlement; private repositories may need an additional plan.
- **Release Please**: manually prepares a version/changelog PR on `main`.
  `skip-github-release: true` prevents this bootstrap workflow from creating
  releases or tags. No code is checked out by this write-enabled job.
- **Prepare release artifacts**: promotes the checked tarball from successful
  main-push CI for an existing stable tag and its exact commit. It verifies the
  source repository, workflow, run attempt, commit, checksum and package version
  before creating a draft release. It does not reinstall, rebuild or repeat
  browser regression. The draft-writing job is separate from read-only artifact
  verification.
- **Publish npm package**: manually verifies that same tag, commit and prepared
  tarball, then publishes through npm OIDC. It does not rebuild the package or
  make the draft release public. Its protected `npm` job needs `contents: write`
  to read draft release assets; the workflow default remains read-only. The
  publish command uses an explicit `./` local path so npm cannot interpret the
  tarball path as a GitHub shorthand.
- **Dependabot**: checks npm packages and pinned GitHub Actions weekly. Node
  types stay on runtime major 24; compatible development updates are grouped.
- **Issue labels**: runs on issue creation, edits, and reopening. Title prefixes
  `[Bug]`, `[Feature]`, `[Docs]`, and `[Question]` map to `bug`, `enhancement`,
  `documentation`, and `question`. Chinese prefixes are also supported. Unknown
  titles receive `needs-triage` unless already categorized. Missing labels are
  created as needed; existing labels are never removed. If a title changes type,
  a maintainer can remove any obsolete category. This workflow reads only
  trusted default-branch code, needs no model key, and never executes issue
  text.

## Repository owner setup

After an authorized remote creation/push:

1. Use `main` as the default branch, enable Actions and Dependency Graph, and
   verify all three PR check names: `Repository checks`,
   `Pull request metadata`, and `Dependency review`.
2. Protect `main` with PR-only changes, required checks, resolved conversations,
   no force-push/deletion, and no unintended bypass. Do not require a check
   until it has actually run and the repository can support it.
3. Prefer squash merging and branch deletion. Enabling native auto-merge does
   not enroll individual PRs; enable it per eligible, authorized PR only.
4. To use Release Please, allow GitHub Actions to create pull requests. Dispatch
   it on `main` only when preparing a release is intended. A denied repository
   setting cannot be fixed by adding workflow token scopes; inspect the failure
   summary and have an authorized owner change the setting before retrying. A PR
   created with `GITHUB_TOKEN` may not trigger ordinary PR workflows: a
   maintainer can close and reopen that PR to trigger the normal checks, then
   verify its exact head before merging. Manual CI alone does not run the
   PR-only metadata/dependency jobs. Branch protection remains the merge
   authority.

## Reusing browser verification

`pnpm check` still verifies every checkout and builds its own package. After
that build, CI hashes the browser inputs and every file in `dist`. Only known
documentation paths and the root package version/release manifest are omitted
from the input hash; other package fields, unknown files, source, patches,
dependencies, toolchain, build/test scripts and workflows remain inputs. The
runner image/version, Node version, platform and architecture must also match.
Even a metadata-only change runs browsers if the resulting build differs.

A successful full browser run uploads a small JSON record for 14 days. CI can
reuse it only after checking GitHub's successful run/attempt and actual browser
execution steps, recomputing the candidate's Git input hash, and matching the
built bytes and environment. Sources must be this repository's `ci.yml`:

- A main push already in the current checkout's ancestry.
- An earlier commit on the current same-repository PR branch.
- A same-repository PR merged into main, whose merge is in the current
  checkout's ancestry. The tested head must be an ancestor of that PR's head.

Both the PR head and its actual tested synthetic merge must have matching input
hashes. The tested merge must have exactly two parents with the run's PR head as
its second parent; push evidence must name the exact run commit. Unavailable
merge commits fail closed. This conservative producer check can rerun browsers
for a stale PR branch whose head differs even if its merge tree would match.

Fork runs, unrelated or unmerged PRs, manual runs, failed/cancelled runs and
records for another attempt cannot supply evidence. A reused run does not upload
another browser record: subsequent jobs trace back to the run that actually
executed the tests. Artifact contents are bounded JSON data, never executable
code. Read failures, expired/missing evidence or mismatches fall back to full
browser regression. The lookup considers at most 30 recent successful runs and
stops starting further candidates after one minute. Manual CI deliberately
forces a fresh browser run.

The job summary states whether browser regression ran or was reused and links
the source run. For unchanged inputs, a feature PR, its merge, the subsequent
version PR and its merge share one browser execution. The first run after this
policy is introduced has no compatible evidence and must establish a baseline.

This reuses **verification**, not a PR's release package. Main still creates and
seals its own version-correct tarball. Release preparation accepts only the
exact approved main-push package, with the existing source and checksum checks.

## Publishing a release

The package name is `dsh-pptx-editor`; the first version under this name is
`1.0.0`, licensed under [Apache License 2.0](../LICENSE). The standard
`dsh.bundle` patch loads the installed package by name. `pnpm check:package`
examines the actual tarball and rejects missing exports, missing editor assets,
unintended files, source paths and install-time scripts. The editor and its
compatibility patch are compiled into the browser assets. Only Zod is a runtime
npm dependency; optional DSH peers document compatibility without installing a
second harness.

Before remote publication, configure these external controls and verify them:

1. Protect `main` and release tags (`v*`) against unauthorized updates/deletion.
2. Create `release` and `npm` environments with required maintainer review.
   Restrict `release` to the `main` branch and `npm` to protected `v*` tags.
   Artifact preparation is dispatched from `main`; npm publication is dispatched
   from the release tag itself, so provenance identifies the package's exact
   source commit. Both workflows verify the tag and approved commit.
3. On the npm package, configure a GitHub trusted publisher for owner
   `yunfeizhu`, repository `dsh-pptx-editor`, workflow `publish-npm.yml`,
   environment `npm`, with permission to run `npm publish`. Never store a
   long-lived npm token in GitHub. The Node 24 toolchain supplies a recent
   OIDC-capable npm CLI.

Release order:

1. Merge reviewed, passing changes. For subsequent versions, use Release Please
   to prepare the version/changelog PR first. Version and release manifest must
   agree. The initial `1.0.0` baseline is prepared in this repository change.
2. Under release authorization, create an annotated stable tag, such as
   `v1.0.0`, at the approved `main` commit and push it. Record the full
   40-character commit.
3. Dispatch **Prepare release artifacts** on `main` with that tag and commit.
   The exact commit must have successful main-push CI from the new artifact
   workflow. CI builds and packs once, verifies those assets using fresh or
   matching recorded browser evidence, then retains the sealed tarball for 14
   days. PR runs and manually dispatched CI runs cannot supply release
   artifacts. If missing or expired, rerun the original main-push CI; do not
   substitute a different commit or rebuild in release preparation. Review the
   draft release, checksum, `CI_ARTIFACT.json` and checks. Existing releases are
   not silently replaced; a failed/partial draft needs maintainer inspection.
4. Dispatch **Publish npm package** from that **tag** with the same target, then
   verify the official registry version, tarball integrity, `latest` tag and
   provenance. Test a clean
   `dsh plugin --profile web add dsh-pptx-editor@<version>` installation.
5. Make the matching GitHub release public, then publish the community post with
   the verified installation command. A draft post is not a community listing.

### First npm publication

A new package has no npm settings in which to register its trusted publisher.
The first release may therefore need a maintainer's interactive npm login and
2FA. Download the **checked tarball from the draft GitHub release**, verify its
`SHA256SUMS.txt` and `COMMIT.txt`, and publish that exact `.tgz` using
`npm publish ./dsh-pptx-editor-1.0.0.tgz --access public --ignore-scripts`. Do
not build or publish from a mutable local checkout, create a placeholder
version, or add a token to CI. Then configure OIDC for later releases. A manual
first publication does not have GitHub Actions provenance; report this
accurately.

This exception only covers the first package registration after the artifact
checks and publication authorization. Login/2FA remain interactive user actions.
If npm permits trusted-publisher registration before the first version, use the
OIDC workflow directly instead. Consult the current
[npm documentation](https://docs.npmjs.com/trusted-publishers/) when setting it
up.

## Workflow maintenance

Pin Actions by full commit SHA, disable checkout credential persistence, use
read-only permissions by default, and apply timeouts/concurrency. Pass untrusted
metadata through environment variables; never interpolate it into shell code.
The local YAML policy checks are a bounded safeguard, not a complete GitHub
Actions emulator. Validate actual event paths after the workflows reach GitHub.

References:
[GitHub secure use](https://docs.github.com/en/actions/reference/security/secure-use)
and
[Release Please action](https://github.com/googleapis/release-please-action).

## Repository history baseline

The repository is re-established with module-level commits using the owner's
GitHub account and GitHub no-reply commit email. Old PR, Issue, commit and tag
identifiers are not part of the new repository. Retain previous release notes as
historical package information without linking them to unrelated new IDs.

Version 1.0.0 is prepared for a later release. Build and verify once in
main-push CI, then wait for explicit release authorization after the next
content changes. No tag, GitHub release or npm publication is created by this
history rebuild. The existing npm versions and their provenance remain
unchanged. Before a later npm release, recheck the trusted publisher against the
new repository identity and protected npm environment; matching repository names
alone do not establish working OIDC publication.
