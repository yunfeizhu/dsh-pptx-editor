import { describe, expect, it, vi } from 'vitest';
import { applyIssueLabels, classifyIssue } from './issue-labels.mjs';

const context = {
  repo: { owner: 'example', repo: 'example' },
  issue: { number: 7 },
};
function client(title, labels = []) {
  const issues = {
    get: vi.fn().mockResolvedValue({ data: { title, labels } }),
    getLabel: vi.fn().mockResolvedValue({ data: {} }),
    createLabel: vi.fn().mockResolvedValue({ data: {} }),
    addLabels: vi.fn().mockResolvedValue({ data: {} }),
  };
  return { rest: { issues } };
}

describe('issue labels', () => {
  it.each([
    ['[Bug] Save fails', 'bug'],
    ['[Feature] Batch editing', 'enhancement'],
    ['[Docs] Clarify undo', 'documentation'],
    ['[Question] How to save?', 'question'],
    ['[缺陷] 保存失败', 'bug'],
    ['Unclassified report', 'needs-triage'],
  ])('classifies %s without model calls', (title, expected) =>
    expect(classifyIssue(title).name).toBe(expected),
  );
  it('adds only the inferred label without replacing existing labels', async () => {
    const github = client('[Bug] Save fails', [{ name: 'priority:high' }]);
    await applyIssueLabels({ github, context });
    expect(github.rest.issues.addLabels).toHaveBeenCalledWith({
      owner: 'example',
      repo: 'example',
      issue_number: 7,
      labels: ['bug'],
    });
    expect(github.rest.issues.createLabel).not.toHaveBeenCalled();
  });
  it('is idempotent for an already present label', async () => {
    const github = client('[Bug] Save fails', ['bug']);
    await applyIssueLabels({ github, context });
    expect(github.rest.issues.addLabels).not.toHaveBeenCalled();
  });
  it('does not add triage to an issue a maintainer already classified', async () => {
    const github = client('Investigate rendering', ['bug']);
    await applyIssueLabels({ github, context });
    expect(github.rest.issues.addLabels).not.toHaveBeenCalled();
  });
  it('creates missing repository labels', async () => {
    const github = client('[Docs] Update guide');
    github.rest.issues.getLabel.mockRejectedValueOnce({ status: 404 });
    await applyIssueLabels({ github, context });
    expect(github.rest.issues.createLabel).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'documentation', color: '0075ca' }),
    );
  });
  it('handles another issue creating the same label concurrently', async () => {
    const github = client('[Bug] Failure');
    github.rest.issues.getLabel.mockRejectedValueOnce({ status: 404 });
    github.rest.issues.createLabel.mockRejectedValueOnce({ status: 422 });
    await applyIssueLabels({ github, context });
    expect(github.rest.issues.getLabel).toHaveBeenCalledTimes(2);
    expect(github.rest.issues.addLabels).toHaveBeenCalledTimes(1);
  });
  it('propagates permission failure without claiming labeling succeeded', async () => {
    const github = client('[Bug] Failure');
    github.rest.issues.getLabel.mockRejectedValueOnce({ status: 403 });
    await expect(applyIssueLabels({ github, context })).rejects.toEqual({
      status: 403,
    });
    expect(github.rest.issues.addLabels).not.toHaveBeenCalled();
  });
});
