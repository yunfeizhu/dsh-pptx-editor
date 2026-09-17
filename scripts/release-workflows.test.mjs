import { execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { load } from 'js-yaml';
import { expect, it } from 'vitest';

it('promotes the same tested package and keeps metadata edits out of code CI', () => {
  const workflow = (name) =>
    load(readFileSync(`.github/workflows/${name}.yml`, 'utf8'));
  const ci = workflow('ci');
  expect(ci.on.pull_request.types).not.toContain('edited');
  expect(workflow('pull-request-metadata').on.pull_request.types).toContain(
    'edited',
  );
  const steps = ci.jobs['repository-checks'].steps;
  expect(steps.filter((step) => step.run === 'pnpm check')).toHaveLength(1);
  expect(steps.some((step) => step.run === 'pnpm test:browser')).toBe(false);
  expect(ci.permissions.actions).toBeUndefined();
  expect(ci.jobs['repository-checks'].permissions).toEqual({
    contents: 'read',
    actions: 'read',
  });
  const decision = steps.findIndex(
    (step) => step.run === 'node scripts/browser-evidence.mjs plan',
  );
  expect(decision).toBeGreaterThan(
    steps.findIndex((step) => step.run === 'pnpm check'),
  );
  for (const run of [
    'pnpm exec playwright install --with-deps chromium',
    'pnpm exec playwright test',
    'node scripts/browser-evidence.mjs record',
  ]) {
    const index = steps.findIndex((step) => step.run === run);
    expect(index).toBeGreaterThan(decision);
    expect(steps[index].if).toBe(
      "steps.browser-plan.outputs.run-browser == 'true'",
    );
  }
  expect(
    steps.findIndex((step) => step.run === 'node scripts/ci-artifact.mjs seal'),
  ).toBeGreaterThan(
    steps.findIndex((step) => step.run === 'pnpm exec playwright test'),
  );
  expect(
    workflow('prepare-release').jobs.promote.steps.some((step) =>
      /pnpm (?:check|build|install|test)/.test(step.run ?? ''),
    ),
  ).toBe(false);
  const publish = workflow('publish-npm');
  expect(publish.permissions.contents).toBe('read');
  expect(publish.jobs.publish.environment).toBe('npm');
  expect(publish.jobs.publish.permissions.contents).toBe('write');
  expect(publish.jobs.publish.steps.at(-1).run).toContain(
    'npm publish ./release-package/',
  );
});

it('seals and verifies an actual tarball, rejecting PR sealing and altered bytes', () => {
  const directory = mkdtempSync(join(tmpdir(), 'pptx-release-'));
  const script = resolve('scripts/ci-artifact.mjs');
  const commit = 'a'.repeat(40);
  const env = {
    ...process.env,
    GITHUB_SHA: commit,
    GITHUB_REPOSITORY: 'example/plugin',
    GITHUB_EVENT_NAME: 'push',
    GITHUB_REF: 'refs/heads/main',
    GITHUB_RUN_ID: '123',
    GITHUB_RUN_ATTEMPT: '2',
    RELEASE_COMMIT: commit,
    RELEASE_TAG: 'v0.1.2',
    SOURCE_RUN_ID: '123',
    SOURCE_RUN_ATTEMPT: '2',
  };
  const run = (mode, overrides = {}) =>
    execFileSync(process.execPath, [script, mode], {
      cwd: directory,
      env: { ...env, ...overrides },
      stdio: 'pipe',
    });
  try {
    mkdirSync(join(directory, 'package'));
    mkdirSync(join(directory, '.cache/packages'), { recursive: true });
    writeFileSync(
      join(directory, 'package/package.json'),
      JSON.stringify({ name: 'dsh-pptx-editor', version: '0.1.2' }),
    );
    const tarball = join(
      directory,
      '.cache/packages/dsh-pptx-editor-0.1.2.tgz',
    );
    execFileSync('tar', ['-czf', tarball, '-C', directory, 'package']);
    expect(() => run('seal', { GITHUB_EVENT_NAME: 'pull_request' })).toThrow();
    expect(() => run('seal')).not.toThrow();
    expect(() => run('verify')).not.toThrow();
    expect(() => run('verify', { SOURCE_RUN_ATTEMPT: '1' })).toThrow();
    writeFileSync(
      join(directory, '.cache/packages/SHA256SUMS.txt'),
      'incorrect',
    );
    expect(() => run('verify')).toThrow();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
