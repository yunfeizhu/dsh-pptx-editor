const titlePattern =
  /^(feat|fix|docs|chore|test|ci|build|refactor|perf|revert)(?:\([a-z0-9][a-z0-9/-]*\))?(!)?: [^\r\n]+$/;

export function validatePrMetadata({
  title = '',
  body = '',
  branch = '',
  author = '',
  authorType = '',
}) {
  const errors = [];
  const match = titlePattern.exec(title);
  if (!match)
    return [
      'PR title must use a supported Conventional Commit type and a nonempty subject.',
    ];
  const dependabot =
    authorType === 'Bot' &&
    author === 'dependabot[bot]' &&
    branch.startsWith('dependabot/');
  const releasePlease =
    authorType === 'Bot' &&
    author === 'github-actions[bot]' &&
    branch.startsWith('release-please--') &&
    match[1] === 'chore';
  if (!dependabot && !releasePlease && !branch.startsWith(`${match[1]}/`)) {
    errors.push('Branch prefix must match the Conventional Commit title type.');
  }
  if (match[2] && !/^BREAKING CHANGE:\s*\S/m.test(body))
    errors.push(
      'Breaking changes require a BREAKING CHANGE: explanation in the PR body.',
    );
  return errors;
}
