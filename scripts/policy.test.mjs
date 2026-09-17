import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  missingLocalLinks,
  validateSkill,
  validateWorkflow,
} from './policy.mjs';
import { validatePrMetadata } from './pr-metadata.mjs';

describe('PR metadata', () => {
  it('accepts a matching human branch and rejects mismatches', () => {
    expect(
      validatePrMetadata({
        title: 'feat(editor): update elements',
        branch: 'feat/updates',
      }),
    ).toEqual([]);
    expect(
      validatePrMetadata({
        title: 'fix: correct undo',
        branch: 'feat/updates',
      }),
    ).not.toEqual([]);
  });
  it('requires a breaking-change explanation', () => {
    expect(
      validatePrMetadata({ title: 'feat!: change API', branch: 'feat/api' }),
    ).not.toEqual([]);
    expect(
      validatePrMetadata({
        title: 'feat!: change API',
        branch: 'feat/api',
        body: 'BREAKING CHANGE: callers must migrate.',
      }),
    ).toEqual([]);
  });
  it('allows verified bot branch conventions without allowing human spoofing', () => {
    const data = {
      title: 'chore(deps): update tooling',
      branch: 'dependabot/npm/tool',
      author: 'dependabot[bot]',
      authorType: 'Bot',
    };
    expect(validatePrMetadata(data)).toEqual([]);
    expect(validatePrMetadata({ ...data, authorType: 'User' })).not.toEqual([]);
    expect(
      validatePrMetadata({
        title: 'chore(main): release 0.1.0',
        branch: 'release-please--branches--main',
        author: 'github-actions[bot]',
        authorType: 'Bot',
      }),
    ).toEqual([]);
  });
  it('rejects malformed and multiline titles without executing their contents', () => {
    expect(
      validatePrMetadata({ title: 'hello', branch: 'feat/a' }),
    ).not.toEqual([]);
    expect(
      validatePrMetadata({ title: 'fix: text\ncommand', branch: 'fix/a' }),
    ).not.toEqual([]);
  });
});

describe('workflow trust boundaries', () => {
  const base = () => ({
    on: { pull_request: {} },
    permissions: { contents: 'read' },
    concurrency: { group: 'ci' },
    jobs: {
      check: {
        'timeout-minutes': 5,
        steps: [
          {
            uses: `actions/checkout@${'a'.repeat(40)}`,
            with: { 'persist-credentials': false },
          },
        ],
      },
    },
  });
  it('accepts read-only pinned PR checks', () =>
    expect(validateWorkflow(base())).toEqual([]));
  it('rejects mutable Actions and privileged PR jobs', () => {
    const workflow = base();
    workflow.jobs.check.steps[0].uses = 'actions/checkout@main';
    workflow.jobs.check.permissions = { contents: 'write' };
    expect(validateWorkflow(workflow)).toHaveLength(2);
  });
  it('rejects write-all permissions while allowing read-all shorthand', () => {
    const workflow = base();
    workflow.jobs.check.permissions = 'write-all';
    expect(validateWorkflow(workflow)).toContain(
      'check: PR jobs must not have write permissions.',
    );
    workflow.jobs.check.permissions = 'read-all';
    expect(validateWorkflow(workflow)).toEqual([]);
  });
  it.each(['workflow', 'job'])(
    'rejects secrets inherited from the %s environment',
    (scope) => {
      const workflow = base();
      const target = scope === 'workflow' ? workflow : workflow.jobs.check;
      target.env = { TOKEN: '${{ secrets.API_KEY }}' };
      expect(validateWorkflow(workflow)).toHaveLength(1);
      target.env = { TOKEN: "${{ secrets['API_KEY'] }}" };
      expect(validateWorkflow(workflow)).toHaveLength(1);
      target.env = { CI: 'true' };
      expect(validateWorkflow(workflow)).toEqual([]);
    },
  );
  it('rejects metadata interpolation and secrets in PR jobs', () => {
    const workflow = base();
    workflow.jobs.check.steps.push({
      run: 'echo ${{ github.event.pull_request.title }}',
      env: { TOKEN: '${{ secrets.KEY }}' },
    });
    expect(validateWorkflow(workflow)).toHaveLength(2);
  });
  it('requires issue automation to check out the trusted default branch', () => {
    const workflow = base();
    workflow.on = { issues: {} };
    expect(validateWorkflow(workflow)).not.toEqual([]);
    workflow.jobs.check.steps[0].with.ref =
      '${{ github.event.repository.default_branch }}';
    expect(validateWorkflow(workflow)).toEqual([]);
  });
});

describe('Agent resources and links', () => {
  it('rejects a skill whose identity does not match its folder', () => {
    expect(
      validateSkill(
        { name: 'wrong', description: 'Review changes' },
        'pptx-review',
      ),
    ).not.toEqual([]);
    expect(
      validateSkill(
        { name: 'pptx-review', description: 'Review changes' },
        'pptx-review',
      ),
    ).toEqual([]);
  });
  it('checks actual relative targets and ignores external links and fenced examples', () => {
    const directory = mkdtempSync(join(tmpdir(), 'pptx-policy-'));
    try {
      writeFileSync(join(directory, 'exists.md'), '# Target\n');
      const markdown =
        '[ok](exists.md#section) [broken](missing.md) [web](https://example.com)\n```md\n[example](fake.md)\n```';
      expect(missingLocalLinks(markdown, join(directory, 'README.md'))).toEqual(
        ['Missing local link: missing.md'],
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
