import { execFileSync } from 'node:child_process';

export function validateReleaseIdentity(tag, commit, version) {
  if (!/^v\d+\.\d+\.\d+$/.test(tag ?? ''))
    throw new Error('Release tag must be vMAJOR.MINOR.PATCH.');
  if (!/^[a-f0-9]{40}$/.test(commit ?? ''))
    throw new Error('An exact 40-character release commit is required.');
  if (tag !== `v${version}`)
    throw new Error('Tag and package version must agree.');
}

export function verifyReleaseTarget(tag, commit) {
  // Validate both inputs before passing them to Git as arguments.
  validateReleaseIdentity(tag, commit, tag?.slice(1));
  const git = (...args) =>
    execFileSync('git', args, { encoding: 'utf8' }).trim();
  const actual = git('rev-parse', '--verify', `refs/tags/${tag}^{commit}`);
  if (actual !== commit)
    throw new Error('Release tag does not match the approved commit.');
  git('merge-base', '--is-ancestor', commit, 'origin/main');
  const pkg = JSON.parse(git('show', `${commit}:package.json`));
  validateReleaseIdentity(tag, commit, pkg.version);
  if (pkg.name !== 'dsh-pptx-viewer' || pkg.private === true)
    throw new Error('Release target is not the public plugin package.');
}
