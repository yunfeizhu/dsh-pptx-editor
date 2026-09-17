import { describe, expect, it } from 'vitest';
import {
  checksum,
  validateCiArtifact,
  validateCiRun,
} from './ci-artifact-policy.mjs';

const commit = 'a'.repeat(40);
const repository = 'example/plugin';
const run = () => ({
  repository: { full_name: repository },
  head_repository: { full_name: repository },
  path: '.github/workflows/ci.yml',
  event: 'push',
  head_branch: 'main',
  head_sha: commit,
  status: 'completed',
  conclusion: 'success',
  id: 123,
  run_attempt: 2,
});

describe('release CI source', () => {
  it('accepts only the exact successful main-push run', () => {
    expect(validateCiRun(run(), repository, commit)).toEqual({
      commit,
      repository,
      runId: '123',
      runAttempt: '2',
    });
  });
  it.each([
    { event: 'pull_request' },
    { event: 'workflow_dispatch' },
    { head_branch: 'feature' },
    { head_sha: 'b'.repeat(40) },
    { conclusion: 'failure' },
    { status: 'in_progress' },
    { path: '.github/workflows/other.yml' },
    { repository: { full_name: 'fork/plugin' } },
    { head_repository: { full_name: 'fork/plugin' } },
    { id: -1 },
    { run_attempt: 0 },
  ])('rejects untrusted or unsuccessful source %j', (change) => {
    expect(() =>
      validateCiRun({ ...run(), ...change }, repository, commit),
    ).toThrow();
  });
});

describe('release artifact identity and bytes', () => {
  const expected = validateCiRun(run(), repository, commit);
  const bytes = Buffer.from('checked package');
  const filename = 'dsh-pptx-viewer-0.1.2.tgz';
  const artifact = () => ({
    provenance: { ...expected },
    commitRecord: `${commit}\n`,
    sums: checksum(bytes, filename),
    bytes,
    filename,
    pkg: { name: 'dsh-pptx-viewer', version: '0.1.2' },
  });
  it('accepts the checked tarball for the approved target', () => {
    expect(() =>
      validateCiArtifact(artifact(), expected, 'v0.1.2'),
    ).not.toThrow();
  });
  it.each([
    { bytes: Buffer.from('tampered') },
    { commitRecord: `${'b'.repeat(40)}\n` },
    { provenance: { ...expected, runAttempt: '1' } },
    { provenance: { ...expected, commit: 'b'.repeat(40) } },
    { provenance: { ...expected, extra: 'unexpected' } },
    { sums: `${checksum(bytes, filename)}extra\n` },
    { filename: 'other.tgz' },
    { pkg: { name: 'another-package', version: '0.1.2' } },
    { pkg: { name: 'dsh-pptx-viewer', version: '0.1.2', private: true } },
    { pkg: { name: 'dsh-pptx-viewer', version: '0.1.3' } },
  ])('rejects mismatched or tampered artifact %j', (change) => {
    expect(() =>
      validateCiArtifact({ ...artifact(), ...change }, expected, 'v0.1.2'),
    ).toThrow();
  });
});
