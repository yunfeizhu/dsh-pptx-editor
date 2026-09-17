import { validatePrMetadata } from './pr-metadata.mjs';

const errors = validatePrMetadata({
  title: process.env.PR_TITLE,
  body: process.env.PR_BODY,
  branch: process.env.PR_BRANCH,
  author: process.env.PR_AUTHOR,
  authorType: process.env.PR_AUTHOR_TYPE,
});
if (errors.length) {
  for (const error of errors) console.error(error);
  process.exitCode = 1;
} else console.log('PR metadata passed.');
