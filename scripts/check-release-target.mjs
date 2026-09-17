import { verifyReleaseTarget } from './release-target.mjs';

verifyReleaseTarget(process.env.RELEASE_TAG, process.env.RELEASE_COMMIT);
console.log(
  'Release tag, exact commit, main ancestry and package version match.',
);
