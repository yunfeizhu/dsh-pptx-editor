import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, relative, resolve } from 'node:path';
import { load } from 'js-yaml';
import { filesUnder } from './files.mjs';
import {
  missingLocalLinks,
  validateSkill,
  validateWorkflow,
} from './policy.mjs';

const root = process.cwd();
const errors = [];
const read = (path) => readFileSync(path, 'utf8');
const pkg = JSON.parse(read('package.json'));
const nodeVersion = read('.node-version').trim();
if (
  !/^24\.\d+\.\d+$/.test(nodeVersion) ||
  !/^24\.\d+\.\d+$/.test(pkg.devDependencies['@types/node'])
)
  errors.push('Node and exact @types/node must use runtime major 24.');
if (!/^pnpm@\d+\.\d+\.\d+$/.test(pkg.packageManager))
  errors.push('Pin the pnpm version.');
if (!existsSync('pnpm-lock.yaml')) errors.push('Commit the pnpm lockfile.');
const manifest = JSON.parse(read('.release-please-manifest.json'));
if (manifest['.'] !== pkg.version)
  errors.push('Release manifest and package version must agree.');
const dependabot = load(read('.github/dependabot.yml'));
if (
  !dependabot.updates?.some(
    (update) =>
      update['package-ecosystem'] === 'npm' &&
      update.ignore?.some(
        (rule) =>
          rule['dependency-name'] === '@types/node' &&
          rule['update-types']?.length === 1 &&
          rule['update-types'][0] === 'version-update:semver-major' &&
          !rule.versions,
      ),
  )
)
  errors.push('Dependabot must keep Node types on the runtime major.');

for (const file of filesUnder(root)) {
  const local = relative(root, file).replaceAll('\\', '/');
  if (local.endsWith('.md')) {
    const content = read(file);
    errors.push(
      ...missingLocalLinks(content, file).map((error) => `${local}: ${error}`),
    );
    if (local.startsWith('.agents/skills/') && basename(file) === 'SKILL.md') {
      const header = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
      const frontmatter = header ? load(header[1]) : undefined;
      errors.push(
        ...validateSkill(frontmatter, basename(dirname(file))).map(
          (error) => `${local}: ${error}`,
        ),
      );
      const metadataPath = resolve(dirname(file), 'agents/openai.yaml');
      if (!existsSync(metadataPath))
        errors.push(`${local}: missing UI metadata.`);
      else {
        const metadata = load(read(metadataPath));
        if (
          !metadata?.interface?.default_prompt?.includes(
            `$${frontmatter?.name}`,
          )
        )
          errors.push(`${local}: default prompt must invoke its skill.`);
      }
    }
    const note =
      /^\.agents\/notes\/(proposed|implemented|rejected|archived)\/(architecture|feature|compatibility|security|testing|process)\/\d{4}-\d{2}-\d{2}-.+\.md$/.exec(
        local,
      );
    if (note) {
      const status = note[1] === 'archived' ? 'implemented' : note[1];
      if (
        !content.includes(`Status: ${status}`) ||
        !content.includes('## Problem') ||
        !content.includes('## Alternatives considered')
      )
        errors.push(`${local}: incomplete decision record.`);
    }
  }
  if (local.startsWith('.github/workflows/') && /\.ya?ml$/.test(local)) {
    errors.push(
      ...validateWorkflow(load(read(file))).map(
        (error) => `${local}: ${error}`,
      ),
    );
  }
}

if (errors.length) {
  for (const error of errors) console.error(error);
  process.exitCode = 1;
} else
  console.log(
    'Repository links, Agent resources, toolchain and workflow policy passed.',
  );
