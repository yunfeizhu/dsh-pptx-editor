import { execFileSync } from 'node:child_process';
import {
  appendFileSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  evidenceVersion,
  findBrowserEvidence,
  fingerprint,
  isCommit,
  sha,
  sourceFingerprint,
} from './browser-evidence-policy.mjs';

const execute = (command, args, options = {}) =>
  execFileSync(command, args, {
    encoding: 'utf8',
    timeout: 20_000,
    maxBuffer: 4 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  });
const git = (args) => execute('git', args).trim();

function ensureCommit(commit) {
  if (!isCommit(commit)) throw new Error('Expected an exact commit.');
  try {
    git(['cat-file', '-e', `${commit}^{commit}`]);
  } catch {
    git(['fetch', '--no-tags', 'origin', commit]);
  }
}

export function readSourceFingerprint(commit) {
  ensureCommit(commit);
  const entries = git(['ls-tree', '-r', '-z', commit])
    .split('\0')
    .filter(Boolean)
    .map((line) => {
      const match = /^(\d+) \w+ ([a-f0-9]+)\t([\s\S]+)$/.exec(line);
      if (!match) throw new Error('Invalid Git tree entry.');
      return { mode: match[1], oid: match[2], path: match[3] };
    });
  return sourceFingerprint(entries, git(['show', `${commit}:package.json`]));
}

export function readCommitParents(commit) {
  ensureCommit(commit);
  return git(['show', '-s', '--format=%P', commit]).split(' ').filter(Boolean);
}

export function readAssetFingerprint(directory = 'dist') {
  const files = [];
  const visit = (path, prefix = '') => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const name = `${prefix}${entry.name}`;
      if (entry.isDirectory()) visit(join(path, entry.name), `${name}/`);
      else if (entry.isFile())
        files.push([name, sha(readFileSync(join(path, entry.name)))]);
      else throw new Error('Unexpected built asset type.');
    }
  };
  visit(directory);
  if (!files.some(([name]) => name === 'editor/editor.js'))
    throw new Error('Build the editor before planning browser tests.');
  files.sort((a, b) => a[0].localeCompare(b[0], 'en'));
  return sha(JSON.stringify(files));
}

function context(env) {
  const event = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8'));
  const pull = event.pull_request;
  const current = {
    schema: evidenceVersion,
    repository: env.GITHUB_REPOSITORY,
    runId: env.GITHUB_RUN_ID,
    runAttempt: env.GITHUB_RUN_ATTEMPT,
    event: env.GITHUB_EVENT_NAME,
    testedCommit: env.GITHUB_SHA,
    head: pull?.head.sha ?? env.GITHUB_SHA,
    headBranch: pull?.head.ref ?? env.GITHUB_REF_NAME,
    headRepository: pull?.head.repo.full_name ?? env.GITHUB_REPOSITORY,
    environment: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      image: env.ImageOS ?? '',
      imageVersion: env.ImageVersion ?? '',
    },
  };
  if (
    !/^[\w.-]+\/[\w.-]+$/.test(current.repository ?? '') ||
    !/^[1-9]\d*$/.test(current.runId ?? '') ||
    !/^[1-9]\d*$/.test(current.runAttempt ?? '') ||
    !isCommit(current.head) ||
    !isCommit(current.testedCommit) ||
    git(['rev-parse', 'HEAD']) !== current.testedCommit
  )
    throw new Error('Expected the exact GitHub CI checkout and run identity.');
  current.source = readSourceFingerprint(current.testedCommit);
  current.assets = readAssetFingerprint();
  current.fingerprint = fingerprint(current);
  return current;
}

export function githubEvidenceIO(
  repository,
  gh = (args, options) => execute('gh', args, options),
) {
  const api = (path) => JSON.parse(gh(['api', `repos/${repository}/${path}`]));
  return {
    runs: () =>
      api('actions/workflows/ci.yml/runs?status=success&per_page=30')
        .workflow_runs ?? [],
    source: readSourceFingerprint,
    parents: readCommitParents,
    ancestor: (ancestor, descendant) => {
      ensureCommit(ancestor);
      ensureCommit(descendant);
      try {
        git(['merge-base', '--is-ancestor', ancestor, descendant]);
        return true;
      } catch (error) {
        if (error.status === 1) return false;
        throw error;
      }
    },
    pulls: (commit) => api(`commits/${commit}/pulls?per_page=100`),
    jobs: (run) =>
      api(
        `actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100`,
      ).jobs ?? [],
    evidence: (run) => {
      const name = `browser-evidence-${run.id}-${run.run_attempt}`;
      const artifacts = api(
        `actions/runs/${run.id}/artifacts?per_page=100`,
      ).artifacts.filter((item) => item.name === name && !item.expired);
      if (artifacts.length !== 1) return;
      const artifact = artifacts[0];
      if (
        !Number.isSafeInteger(artifact.id) ||
        artifact.id <= 0 ||
        !(artifact.size_in_bytes > 0 && artifact.size_in_bytes < 64 * 1024)
      )
        return;
      const directory = mkdtempSync(join(tmpdir(), 'pptx-browser-evidence-'));
      try {
        const archive = join(directory, 'evidence.zip');
        writeFileSync(
          archive,
          gh(
            ['api', `repos/${repository}/actions/artifacts/${artifact.id}/zip`],
            { encoding: 'buffer', maxBuffer: 64 * 1024 },
          ),
        );
        // Read only the known entry; never extract or execute artifact contents.
        return JSON.parse(
          execute('unzip', ['-p', archive, 'evidence.json'], {
            maxBuffer: 16 * 1024,
          }),
        );
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    },
  };
}

export async function main(mode, env = process.env) {
  const current = context(env);
  const directory = '.cache/browser-evidence';
  if (mode === 'plan') {
    // A fresh directory prevents a reused run from uploading an old witness.
    rmSync(directory, { recursive: true, force: true });
    mkdirSync(directory, { recursive: true });
    const result = await findBrowserEvidence(
      current,
      githubEvidenceIO(current.repository),
    );
    const runBrowser = !result.run;
    writeFileSync(
      `${directory}/plan.json`,
      JSON.stringify({ current, runBrowser }),
    );
    appendFileSync(env.GITHUB_OUTPUT, `run-browser=${runBrowser}\n`);
    const message = result.run
      ? `Reused browser regression from [CI ${result.run.id}](https://github.com/${current.repository}/actions/runs/${result.run.id}). ${result.reason}`
      : `Run browser regression. ${result.reason}`;
    appendFileSync(
      env.GITHUB_STEP_SUMMARY,
      `### Browser verification\n\n${message}\n\nSource: \`${current.source}\`\n\nBuilt assets: \`${current.assets}\`\n`,
    );
    console.log(message);
  } else if (mode === 'record') {
    const plan = JSON.parse(readFileSync(`${directory}/plan.json`, 'utf8'));
    if (
      !plan.runBrowser ||
      JSON.stringify(plan.current) !== JSON.stringify(current)
    )
      throw new Error(
        'Only unchanged, actually tested inputs may record browser evidence.',
      );
    writeFileSync(
      `${directory}/evidence.json`,
      `${JSON.stringify(current, null, 2)}\n`,
    );
  } else throw new Error('Expected plan or record.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await main(process.argv[2]);
