import {
  appendFileSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import {
  checksum,
  validateCiArtifact,
  validateCiRun,
} from './ci-artifact-policy.mjs';

const directory = '.cache/packages';
const env = process.env;
const mode = process.argv[2];
const repository = env.GITHUB_REPOSITORY;
const commit = mode === 'seal' ? env.GITHUB_SHA : env.RELEASE_COMMIT;
if (
  !/^[\w.-]+\/[\w.-]+$/.test(repository ?? '') ||
  !/^[a-f0-9]{40}$/.test(commit ?? '')
)
  throw new Error('An exact repository and commit are required.');

if (mode === 'select') {
  const response = JSON.parse(
    execFileSync(
      'gh',
      [
        'api',
        `repos/${repository}/actions/workflows/ci.yml/runs?event=push&branch=main&head_sha=${commit}&status=success&per_page=100`,
      ],
      { encoding: 'utf8' },
    ),
  );
  const run = response.workflow_runs?.[0];
  if (!run)
    throw new Error(
      'No successful main-push CI artifact exists for this commit. Wait for CI, or rerun its main-push run if the artifact expired.',
    );
  const source = validateCiRun(run, repository, commit);
  appendFileSync(
    env.GITHUB_OUTPUT,
    `run-id=${source.runId}\nrun-attempt=${source.runAttempt}\nartifact-name=checked-package-${commit}-${source.runAttempt}\n`,
  );
} else if (mode === 'seal' || mode === 'verify') {
  const runId = mode === 'seal' ? env.GITHUB_RUN_ID : env.SOURCE_RUN_ID;
  const runAttempt =
    mode === 'seal' ? env.GITHUB_RUN_ATTEMPT : env.SOURCE_RUN_ATTEMPT;
  if (!/^[1-9]\d*$/.test(runId ?? '') || !/^[1-9]\d*$/.test(runAttempt ?? ''))
    throw new Error('An exact CI run and attempt are required.');
  const expected = { commit, repository, runId, runAttempt };
  const tarballs = readdirSync(directory).filter((name) =>
    name.endsWith('.tgz'),
  );
  if (
    tarballs.length !== 1 ||
    !/^dsh-pptx-viewer-\d+\.\d+\.\d+\.tgz$/.test(tarballs[0])
  )
    throw new Error('Expected one stable plugin tarball.');
  const filename = tarballs[0];
  const path = `${directory}/${filename}`;
  const bytes = readFileSync(path);
  if (mode === 'seal') {
    if (
      env.GITHUB_EVENT_NAME !== 'push' ||
      env.GITHUB_REF !== 'refs/heads/main'
    )
      throw new Error('Only main-push CI may seal a release candidate.');
    writeFileSync(
      `${directory}/CI_ARTIFACT.json`,
      `${JSON.stringify(expected, null, 2)}\n`,
    );
    writeFileSync(`${directory}/COMMIT.txt`, `${commit}\n`);
    writeFileSync(`${directory}/SHA256SUMS.txt`, checksum(bytes, filename));
  } else {
    validateCiArtifact(
      {
        provenance: JSON.parse(
          readFileSync(`${directory}/CI_ARTIFACT.json`, 'utf8'),
        ),
        commitRecord: readFileSync(`${directory}/COMMIT.txt`, 'utf8'),
        sums: readFileSync(`${directory}/SHA256SUMS.txt`, 'utf8'),
        bytes,
        filename,
        pkg: JSON.parse(
          execFileSync('tar', ['-xOf', path, 'package/package.json'], {
            encoding: 'utf8',
          }),
        ),
      },
      expected,
      env.RELEASE_TAG,
    );
  }
  console.log(
    `${mode === 'seal' ? 'Sealed' : 'Verified'} checked CI package for ${commit}.`,
  );
} else throw new Error('Expected seal, select or verify.');
