import { describe, expect, it } from 'vitest';
import { validateReleaseIdentity } from './release-target.mjs';

describe('release identity', () => {
  it('accepts an immutable stable version target', () => {
    expect(() =>
      validateReleaseIdentity('v0.1.0', 'a'.repeat(40), '0.1.0'),
    ).not.toThrow();
  });
  it.each(['main', 'v0.1.0-beta.1', '--upload-pack=x', 'v0.1.0\ncommand'])(
    'rejects unsafe or non-release tag %s',
    (tag) => {
      expect(() =>
        validateReleaseIdentity(tag, 'a'.repeat(40), '0.1.0'),
      ).toThrow();
    },
  );
  it('rejects abbreviated commits and mismatched versions', () => {
    expect(() =>
      validateReleaseIdentity('v0.1.0', 'abcdef0', '0.1.0'),
    ).toThrow();
    expect(() =>
      validateReleaseIdentity('v0.1.0', 'a'.repeat(40), '0.2.0'),
    ).toThrow();
  });
});
