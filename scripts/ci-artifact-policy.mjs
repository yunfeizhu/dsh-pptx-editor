import { createHash } from 'node:crypto';
import { validateReleaseIdentity } from './release-target.mjs';

export function validateCiRun(run, repository, commit) {
  validateReleaseIdentity('v0.0.0', commit, '0.0.0');
  if (
    run.repository?.full_name !== repository ||
    run.head_repository?.full_name !== repository ||
    run.path !== '.github/workflows/ci.yml' ||
    run.event !== 'push' ||
    run.head_branch !== 'main' ||
    run.head_sha !== commit ||
    run.status !== 'completed' ||
    run.conclusion !== 'success' ||
    !Number.isSafeInteger(run.id) ||
    run.id <= 0 ||
    !Number.isSafeInteger(run.run_attempt) ||
    run.run_attempt <= 0
  )
    throw new Error(
      'Only successful main-push CI for the exact repository and commit can supply a release.',
    );
  return {
    commit,
    repository,
    runId: String(run.id),
    runAttempt: String(run.run_attempt),
  };
}

export function checksum(bytes, filename) {
  return `${createHash('sha256').update(bytes).digest('hex')}  ${filename}\n`;
}

export function validateCiArtifact(
  { provenance, commitRecord, sums, bytes, filename, pkg },
  expected,
  tag,
) {
  validateReleaseIdentity(tag, expected.commit, pkg.version);
  if (
    pkg.name !== 'dsh-pptx-editor' ||
    pkg.private ||
    filename !== `dsh-pptx-editor-${pkg.version}.tgz`
  )
    throw new Error('Unexpected release package.');
  if (
    Object.keys(provenance).length !== Object.keys(expected).length ||
    Object.entries(expected).some(
      ([key, value]) => provenance[key] !== value,
    ) ||
    commitRecord !== `${expected.commit}\n`
  )
    throw new Error('CI artifact identity does not match the approved run.');
  if (sums !== checksum(bytes, filename))
    throw new Error('CI artifact checksum does not match the package.');
}
