import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { load } from 'js-yaml';
import { validatePackage } from './package-policy.mjs';

const destination = resolve('.cache/packages');
mkdirSync(destination, { recursive: true });
const result = JSON.parse(
  execFileSync(
    'npm',
    ['pack', '--ignore-scripts', '--json', '--pack-destination', destination],
    {
      encoding: 'utf8',
      env: { ...process.env, npm_config_cache: resolve('.cache/npm') },
    },
  ),
);
if (result.length !== 1) throw new Error('Expected exactly one package.');
const packed = result[0];
if (!/^[\w.-]+\.tgz$/.test(packed.filename))
  throw new Error('Invalid tarball name.');
const tarball = resolve(destination, packed.filename);
const read = (file) =>
  execFileSync('tar', ['-xOf', tarball, `package/${file}`], {
    encoding: 'utf8',
  });
const pkg = JSON.parse(read('package.json'));
const errors = validatePackage(
  pkg,
  load(read('cordis.patch.yml')),
  packed.files,
);
if (errors.length) throw new Error(errors.join('\n'));
console.log(
  `Verified ${pkg.name}@${pkg.version}: ${packed.files.length} files, ${packed.size} packed bytes.`,
);
console.log(`Tarball: .cache/packages/${packed.filename}`);
