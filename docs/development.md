# Development workflow

## Runtime boundary

`src/index.ts` registers the DSH host tools and authenticated routes.
`src/client.tsx` registers the sidebar tab type without a Start-page guide
entry. Chat attachments and conversation requests open the tab. The full React
editor runs in an isolated iframe; esbuild emits its JS/CSS separately from the
DSH module factory. Runtime use is documented in [usage.md](usage.md).

## Daily work

1. Inspect the current branch and all changes. Choose a focused Conventional
   Commit branch: `feat/`, `fix/`, `docs/`, `chore/`, `test/`, `ci/`, `build/`,
   `refactor/`, `perf/`, or `revert/`.
2. Read the owning design and relevant public package contracts.
3. Implement within the requested scope. Reproduce behavior defects before
   fixing them and test their failure class.
4. Run `pnpm check`. Tool tests cover repository policies; all production TS and
   TSX files under `src/` are subject to per-file coverage thresholds.
5. Under the user's authorization for incremental local commits, commit each
   completed and verified module promptly, including its relevant tests. Keep
   unrelated modules in separate commits and inspect the staged diff before
   committing. Do not accumulate several completed modules in the worktree.
6. Before an authorized push, use the
   [pre-push skill](../.agents/skills/pptx-pre-push/SKILL.md). Review the
   complete task diff independently, fix the initial findings together, and
   finish with a P0/P1-only review. Do not repeat optional P2 cycles.

Only create a commit, push, or PR when authorized. Use a verified author
identity and DCO sign-off (`git commit -s`) when committing. Never manufacture
another person's sign-off. PR titles use Conventional Commits; non-bot branch
prefixes match the title type. Breaking changes include a `BREAKING CHANGE:`
explanation in the PR body.

## Checks

| Command                 | Evidence                                                   |
| ----------------------- | ---------------------------------------------------------- |
| `pnpm format:check`     | Deterministic formatting                                   |
| `pnpm lint`             | JavaScript and TypeScript lint                             |
| `pnpm typecheck`        | Strict TypeScript config and current source                |
| `pnpm test:coverage`    | Policy, runtime and UI boundary tests                      |
| `pnpm build`            | Build host, DSH client factory and editor assets           |
| `pnpm check:package`    | Actual tarball manifest, exports, assets and file boundary |
| `pnpm lint:markdown`    | Markdown structure                                         |
| `pnpm check:repository` | Local links, skills, notes, toolchain and workflow policy  |

For UI changes inspect the rendered editor and computed geometry/styles. For
document changes validate editing, undo, serialization and re-open separately.
For file writes exercise failure, stale state, and cleanup behavior. Live
harness tests require a working runtime and permitted test data; report skipped
live checks explicitly.

For distribution changes, install
`.cache/packages/dsh-pptx-editor-<version>.tgz` into a fresh `DSH_HOME` with
`dsh plugin --profile web add`, then inspect the composed config and boot the
installed package. Do not use the source patch for this check: it would hide
missing tarball contents. Keep this profile separate from normal conversations
and stop temporary smoke-test services afterwards.

## Model review

Local independent review and hosted review are separate evidence. Hosted review
is optional unless the repository owner configures a native review policy. A
pending review or workflow is not a passing result. No model provider
credentials are required by the checked-in CI configuration.

## Browser regression

```sh
pnpm test:browser
```

Locally this uses installed Chrome. CI runs `pnpm check`, then compares its
browser inputs, built assets and runner environment with trusted successful CI
evidence. When there is no match it installs Chromium with
`pnpm exec playwright install --with-deps chromium` and runs
`pnpm exec playwright test`, reusing the build without a second build. Otherwise
it links the actual source run and skips both browser installation and tests.
See the [browser evidence policy](github.md#reusing-browser-verification).
Standalone local `pnpm test:browser` still builds first. The browser test runs
the actual editor; only the OS picker/disk boundary and DSH registrations are
adapted. It checks direct editing, stale request rejection, undo/redo, tab
remount retention, serialization, chart/workbook values and re-open. Connection
tests cover repeated empty-tab reopens, delayed release, closing during a claim
and rejection of a separate competing editor. It is separate from live model and
DSH integration.

For an explicitly authorized local document, use an input copy:

```sh
mkdir -p .cache/manual
PPTX_TEST_FILE=/path/to/test-copy.pptx pnpm test:browser
```

This opt-in test reads the input, exports to `.cache/manual/roundtrip.pptx`, and
checks re-opening. It never overwrites the input or includes its contents in a
fixture. Keep all such files and test output out of commits.
