import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import JSZip from 'jszip';
import {
  eligibleRun,
  evidenceVersion,
  findBrowserEvidence,
  fingerprint,
  matchingEvidence,
  sourceFingerprint,
} from './browser-evidence-policy.mjs';
import { githubEvidenceIO, readAssetFingerprint } from './browser-evidence.mjs';

const repository = 'example/plugin';
const tested = 'a'.repeat(40);
const merged = 'b'.repeat(40);
const next = 'c'.repeat(40);
const syntheticMerge = 'd'.repeat(40);
const current = {
  schema: evidenceVersion,
  repository,
  runId: '200',
  runAttempt: '1',
  event: 'push',
  head: merged,
  testedCommit: merged,
  headRepository: repository,
  headBranch: 'main',
  source: 'source',
  assets: 'assets',
  environment: {
    node: 'v24.19.0',
    platform: 'linux',
    arch: 'x64',
    image: 'ubuntu24',
    imageVersion: '20260914.1.0',
  },
};
const candidate = {
  id: 100,
  run_attempt: 1,
  repository: { full_name: repository },
  head_repository: { full_name: repository },
  path: '.github/workflows/ci.yml',
  status: 'completed',
  conclusion: 'success',
  event: 'pull_request',
  head_sha: tested,
  head_branch: 'feat/batch',
};
const record = {
  ...current,
  runId: '100',
  head: tested,
  testedCommit: syntheticMerge,
  fingerprint: fingerprint(current),
};
const pull = {
  merged_at: '2026-09-17T00:00:00Z',
  merge_commit_sha: merged,
  base: { ref: 'main', repo: { full_name: repository } },
  head: {
    ref: candidate.head_branch,
    sha: tested,
    repo: { full_name: repository },
  },
};
const completedJobs = [
  {
    name: 'Repository checks',
    conclusion: 'success',
    steps: ['Run browser regression', 'Record browser test evidence'].map(
      (name) => ({ name, conclusion: 'success' }),
    ),
  },
];
const ioFor = (overrides = {}) => ({
  runs: vi.fn(async () => [candidate]),
  source: vi.fn(async () => current.source),
  parents: vi.fn(async () => [merged, tested]),
  ancestor: vi.fn(async () => true),
  pulls: vi.fn(async () => [pull]),
  jobs: vi.fn(async () => completedJobs),
  evidence: vi.fn(async () => record),
  ...overrides,
});

it('needs only one full browser run for feature PR, merged main, release PR and release main', async () => {
  const runs = [];
  const io = ioFor({ runs: async () => runs });
  let executions = 0;
  const reused = [];
  const events = [
    {
      ...current,
      runId: '100',
      event: 'pull_request',
      headBranch: candidate.head_branch,
      head: tested,
      testedCommit: syntheticMerge,
    },
    current,
    {
      ...current,
      runId: '300',
      event: 'pull_request',
      headBranch: 'release-please--main',
      head: next,
      testedCommit: next,
    },
    { ...current, runId: '400', head: next, testedCommit: next },
  ];
  for (const event of events) {
    const plan = await findBrowserEvidence(event, io);
    if (!plan.run) {
      executions++;
      runs.push(candidate);
    } else reused.push(plan.run.id);
  }
  expect(executions).toBe(1);
  expect(reused).toEqual([100, 100, 100]);
});

it('reuses an earlier successful input on the same PR branch after a docs-only commit', async () => {
  const io = ioFor({ pulls: vi.fn(async () => []) });
  const plan = await findBrowserEvidence(
    {
      ...current,
      event: 'pull_request',
      headBranch: candidate.head_branch,
      head: next,
    },
    io,
  );
  expect(plan.run?.id).toBe(candidate.id);
  expect(io.pulls).not.toHaveBeenCalled();
  expect(io.ancestor).toHaveBeenCalledWith(tested, next);
});

it('reuses the original browser attempt after only a different failed job was rerun', async () => {
  const io = ioFor({
    runs: async () => [{ ...candidate, run_attempt: 2 }],
    jobs: vi.fn(async (run) =>
      run.run_attempt === 1
        ? completedJobs
        : [{ name: 'Dependency review', conclusion: 'success' }],
    ),
  });
  const result = await findBrowserEvidence(current, io);
  expect(result.run).toEqual(candidate);
  expect(result.reason).toContain('attempt 1');
  expect(io.jobs.mock.calls.map(([run]) => run.run_attempt)).toEqual([2, 1]);
  expect(io.evidence).toHaveBeenCalledExactlyOnceWith(candidate);
});

it.each(['failed browser job', 'mismatched artifact attempt'])(
  'rejects an earlier attempt with %s',
  async (failure) => {
    const io = ioFor({
      runs: async () => [{ ...candidate, run_attempt: 2 }],
      jobs: async (run) =>
        run.run_attempt === 1
          ? completedJobs.map((job) => ({
              ...job,
              conclusion:
                failure === 'failed browser job' ? 'failure' : 'success',
            }))
          : [],
      evidence: vi.fn(async () => ({ ...record, runAttempt: '2' })),
    });
    expect((await findBrowserEvidence(current, io)).run).toBeUndefined();
    expect(io.evidence).toHaveBeenCalledTimes(
      failure === 'failed browser job' ? 0 : 1,
    );
  },
);

it('checks at most five attempts per successful run', async () => {
  const io = ioFor({
    runs: async () => [{ ...candidate, run_attempt: 10 }],
    jobs: vi.fn(async () => []),
  });
  expect((await findBrowserEvidence(current, io)).run).toBeUndefined();
  expect(io.jobs.mock.calls.map(([run]) => run.run_attempt)).toEqual([
    10, 9, 8, 7, 6,
  ]);
});

it('accepts an ancestral main run but never an unrelated main commit', async () => {
  const mainRun = { ...candidate, event: 'push', head_branch: 'main' };
  const io = ioFor({
    runs: async () => [mainRun],
    evidence: async () => ({ ...record, testedCommit: tested }),
  });
  expect((await findBrowserEvidence(current, io)).run).toEqual(mainRun);
  io.ancestor = async () => false;
  expect((await findBrowserEvidence(current, io)).run).toBeUndefined();
});

it.each([
  ['failed run', { conclusion: 'failure' }],
  ['unfinished run', { status: 'in_progress' }],
  ['cancelled run', { conclusion: 'cancelled' }],
  ['fork', { head_repository: { full_name: 'someone/fork' } }],
  ['other repository', { repository: { full_name: 'someone/fork' } }],
  ['other workflow', { path: '.github/workflows/other.yml' }],
  ['manual run', { event: 'workflow_dispatch' }],
  ['branch push', { event: 'push', head_branch: 'feature' }],
  ['same run', { id: 200 }],
  ['unsafe run ID', { id: '100/../../something' }],
  ['missing attempt', { run_attempt: undefined }],
])('does not trust %s', async (_name, mutation) => {
  const run = { ...candidate, ...mutation };
  expect(eligibleRun(run, repository, current.runId)).toBe(false);
  const io = ioFor({ runs: async () => [run] });
  expect((await findBrowserEvidence(current, io)).run).toBeUndefined();
  expect(io.evidence).not.toHaveBeenCalled();
});

it.each([
  ['dependency or workflow change', { source: 'changed' }],
  ['different built editor bytes', { assets: 'changed' }],
  [
    'different runner image',
    { environment: { ...current.environment, imageVersion: 'new' } },
  ],
])(
  'runs again for %s even if a receipt claims a matching digest',
  async (_name, changes) => {
    const now = { ...current, ...changes };
    const forged = { ...record, fingerprint: fingerprint(now) };
    const io = ioFor({ evidence: async () => forged });
    expect((await findBrowserEvidence(now, io)).run).toBeUndefined();
  },
);

it.each([
  { runId: '99' },
  { runAttempt: '2' },
  { head: next },
  { repository: 'someone/fork' },
  { schema: 0 },
  { fingerprint: 'fabricated' },
])('rejects mismatched evidence identity %j', async (mutation) => {
  const changed = { ...record, ...mutation };
  expect(matchingEvidence(changed, candidate, current)).toBe(false);
  const io = ioFor({ evidence: async () => changed });
  expect((await findBrowserEvidence(current, io)).run).toBeUndefined();
});

it('recomputes candidate Git inputs instead of accepting its self-reported source digest', async () => {
  const io = ioFor({ source: async () => 'a different workflow' });
  expect((await findBrowserEvidence(current, io)).run).toBeUndefined();
  expect(io.evidence).not.toHaveBeenCalled();
});

it('checks the actual PR merge tree as well as its branch head', async () => {
  const io = ioFor({
    source: vi.fn(async (commit) =>
      commit === syntheticMerge ? 'different tested tree' : current.source,
    ),
  });
  expect((await findBrowserEvidence(current, io)).run).toBeUndefined();
  expect(io.source).toHaveBeenCalledWith(tested);
  expect(io.source).toHaveBeenCalledWith(syntheticMerge);
});

it.each([
  [],
  [tested],
  [merged, next],
  [tested, merged],
  ['invalid', tested],
  [merged, tested, next],
])(
  'rejects PR evidence with invalid tested merge parents %j',
  async (...parents) => {
    const io = ioFor({ parents: async () => parents });
    expect((await findBrowserEvidence(current, io)).run).toBeUndefined();
  },
);

it('requires push evidence to test the exact run commit', async () => {
  const io = ioFor({
    runs: async () => [{ ...candidate, event: 'push', head_branch: 'main' }],
  });
  expect((await findBrowserEvidence(current, io)).run).toBeUndefined();
  expect(io.parents).not.toHaveBeenCalled();
});

it.each([
  ['unmerged PR', { ...pull, merged_at: null }],
  ['non-main target', { ...pull, base: { ...pull.base, ref: 'other' } }],
  [
    'foreign head',
    { ...pull, head: { ...pull.head, repo: { full_name: 'someone/fork' } } },
  ],
])('does not use an %s as main evidence', async (_name, changed) => {
  const io = ioFor({ pulls: async () => [changed] });
  expect((await findBrowserEvidence(current, io)).run).toBeUndefined();
});

it('rejects a merged PR outside the current ancestry and a detached same-branch run', async () => {
  const io = ioFor({ ancestor: async () => false });
  expect((await findBrowserEvidence(current, io)).run).toBeUndefined();
  expect(
    (
      await findBrowserEvidence(
        {
          ...current,
          event: 'pull_request',
          headBranch: candidate.head_branch,
        },
        io,
      )
    ).run,
  ).toBeUndefined();
});

it('never chains evidence from a run which skipped browser regression', async () => {
  const jobs = structuredClone(completedJobs);
  jobs[0].steps[0].conclusion = 'skipped';
  const io = ioFor({ jobs: async () => jobs });
  expect((await findBrowserEvidence(current, io)).run).toBeUndefined();
  expect(io.evidence).not.toHaveBeenCalled();
});

it.each(['runs', 'source', 'parents', 'ancestor', 'pulls', 'jobs', 'evidence'])(
  'falls back to actual testing when %s is unavailable',
  async (method) => {
    const io = ioFor({
      [method]: async () => {
        throw new Error('403 or expired');
      },
    });
    expect((await findBrowserEvidence(current, io)).run).toBeUndefined();
  },
);

it('runs when the artifact is missing, and a manual dispatch always forces fresh testing', async () => {
  expect(
    (
      await findBrowserEvidence(
        current,
        ioFor({ evidence: async () => undefined }),
      )
    ).run,
  ).toBeUndefined();
  const io = ioFor();
  expect(
    (await findBrowserEvidence({ ...current, event: 'workflow_dispatch' }, io))
      .run,
  ).toBeUndefined();
  expect(io.runs).not.toHaveBeenCalled();
  expect(
    (
      await findBrowserEvidence(
        {
          ...current,
          environment: { ...current.environment, imageVersion: '' },
        },
        io,
      )
    ).run,
  ).toBeUndefined();
});

it('bounds evidence lookup and falls back to the test instead of delaying it indefinitely', async () => {
  const times = [0, 60_001];
  const io = ioFor();
  const result = await findBrowserEvidence(current, io, () => times.shift());
  expect(result.run).toBeUndefined();
  expect(result.reason).toContain('budget');
  expect(io.source).not.toHaveBeenCalled();
});

it.each([
  ['expired', { expired: true }],
  ['wrong attempt', { name: 'browser-evidence-100-2' }],
  ['oversized', { size_in_bytes: 100_000 }],
  ['invalid identity', { id: '../other' }],
])('does not download %s artifacts', (_label, change) => {
  const gh = vi.fn(() =>
    JSON.stringify({
      artifacts: [
        {
          id: 1,
          name: 'browser-evidence-100-1',
          size_in_bytes: 1024,
          expired: false,
          ...change,
        },
      ],
    }),
  );
  expect(githubEvidenceIO(repository, gh).evidence(candidate)).toBeUndefined();
  expect(gh).toHaveBeenCalledTimes(1);
});

it('reads only the known JSON entry from the identified artifact without extracting code', async () => {
  const zip = new JSZip();
  zip.file('evidence.json', JSON.stringify(record));
  zip.file(
    'should-not-run.mjs',
    'throw new Error("artifact code must not execute")',
  );
  const archive = await zip.generateAsync({ type: 'nodebuffer' });
  const gh = vi.fn((args) =>
    args[1].endsWith('/zip')
      ? archive
      : JSON.stringify({
          artifacts: [
            {
              id: 123,
              name: 'browser-evidence-100-1',
              size_in_bytes: archive.length,
              expired: false,
            },
          ],
        }),
  );
  expect(githubEvidenceIO(repository, gh).evidence(candidate)).toEqual(record);
  expect(gh.mock.calls[1][0][1]).toBe(
    'repos/example/plugin/actions/artifacts/123/zip',
  );
});

const entries = (changes = {}) =>
  Object.entries({
    'package.json': 'package',
    'README.md': 'readme',
    'docs/usage.md': 'guide',
    '.release-please-manifest.json': 'release',
    'src/editor/App.tsx': 'editor',
    'tests/e2e/editor.spec.mjs': 'tests',
    'pnpm-lock.yaml': 'deps',
    'patches/viewer.patch': 'patch',
    'scripts/build.mjs': 'build',
    '.github/workflows/ci.yml': 'workflow',
    '.node-version': 'node',
    ...changes,
  }).map(([path, oid]) => ({ path, oid, mode: '100644' }));
const pkg = {
  name: 'plugin',
  version: '0.2.0',
  scripts: { build: 'node build.mjs' },
};

it('ignores only documented metadata and the root package version', () => {
  const baseline = sourceFingerprint(entries(), JSON.stringify(pkg));
  expect(
    sourceFingerprint(
      entries({
        'README.md': 'new',
        'docs/usage.md': 'new',
        '.release-please-manifest.json': 'new',
        'package.json': 'new',
      }),
      JSON.stringify({ ...pkg, version: '0.3.0' }),
    ),
  ).toBe(baseline);
  expect(
    sourceFingerprint(
      entries(),
      JSON.stringify({ ...pkg, scripts: { build: 'other' } }),
    ),
  ).not.toBe(baseline);
  expect(
    sourceFingerprint(
      entries().map((e) => ({
        ...e,
        mode: e.path === 'README.md' ? '120000' : e.mode,
      })),
      JSON.stringify(pkg),
    ),
  ).not.toBe(baseline);
});

it.each([
  'src/editor/App.tsx',
  'tests/e2e/editor.spec.mjs',
  'pnpm-lock.yaml',
  'patches/viewer.patch',
  'scripts/build.mjs',
  '.github/workflows/ci.yml',
  '.node-version',
  'unknown-input.md',
])('invalidates evidence when %s changes', (path) => {
  expect(
    sourceFingerprint(entries({ [path]: 'new' }), JSON.stringify(pkg)),
  ).not.toBe(sourceFingerprint(entries(), JSON.stringify(pkg)));
});

const directories = [];
const temp = () => {
  const path = mkdtempSync(join(tmpdir(), 'pptx-evidence-test-'));
  directories.push(path);
  return path;
};
afterEach(() =>
  directories
    .splice(0)
    .forEach((path) => rmSync(path, { recursive: true, force: true })),
);

it('fingerprints real built files, including added files, and requires a built editor', () => {
  const directory = temp();
  expect(() => readAssetFingerprint(directory)).toThrow('Build the editor');
  mkdirSync(join(directory, 'editor'));
  writeFileSync(join(directory, 'editor/editor.js'), 'editor');
  const baseline = readAssetFingerprint(directory);
  writeFileSync(join(directory, 'editor/editor.js'), 'changed editor');
  expect(readAssetFingerprint(directory)).not.toBe(baseline);
  writeFileSync(join(directory, 'editor/editor.js'), 'editor');
  writeFileSync(join(directory, 'extra.js'), 'extra');
  expect(readAssetFingerprint(directory)).not.toBe(baseline);
});

it('computes source equivalence from real Git commits after version/docs changes', () => {
  const directory = temp();
  const git = (args) =>
    execFileSync('git', args, { cwd: directory, encoding: 'utf8' }).trim();
  git(['init', '-q']);
  git(['config', 'user.name', 'Test']);
  git(['config', 'user.email', 'test@example.invalid']);
  writeFileSync(join(directory, 'package.json'), JSON.stringify(pkg));
  writeFileSync(join(directory, 'README.md'), 'Before');
  writeFileSync(join(directory, 'editor.js'), 'editor');
  const commit = () => {
    git(['add', '.']);
    git(['commit', '-qm', 'test']);
    return git(['rev-parse', 'HEAD']);
  };
  const original = commit();
  writeFileSync(
    join(directory, 'package.json'),
    JSON.stringify({ ...pkg, version: '0.3.0' }),
  );
  writeFileSync(join(directory, 'README.md'), 'After');
  const docs = commit();
  writeFileSync(join(directory, 'editor.js'), 'changed editor');
  const runtime = commit();
  const moduleURL = new URL(`file://${resolve('scripts/browser-evidence.mjs')}`)
    .href;
  const hash = (revision) =>
    execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `import {readSourceFingerprint} from ${JSON.stringify(moduleURL)}; console.log(readSourceFingerprint(process.argv[1]));`,
        revision,
      ],
      { cwd: directory, encoding: 'utf8' },
    ).trim();
  expect(hash(original)).toBe(hash(docs));
  expect(hash(original)).not.toBe(hash(runtime));
  git(['checkout', '-qb', 'feature', docs]);
  writeFileSync(join(directory, 'feature.js'), 'feature');
  const feature = commit();
  git(['checkout', '--detach', runtime]);
  git(['merge', '--no-ff', '-m', 'Synthetic PR merge', feature]);
  const mergeCommit = git(['rev-parse', 'HEAD']);
  const parents = execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `import {readCommitParents} from ${JSON.stringify(moduleURL)}; console.log(JSON.stringify(readCommitParents(process.argv[1])));`,
      mergeCommit,
    ],
    { cwd: directory, encoding: 'utf8' },
  );
  expect(JSON.parse(parents)).toEqual([runtime, feature]);
});
