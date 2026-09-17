import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const licenseDirectory = new URL('./vendor-licenses/', import.meta.url);
const upstreamLicenses = JSON.parse(
  readFileSync(new URL('sources.json', licenseDirectory), 'utf8'),
);

export function bundleLicenses(metafiles, root = process.cwd()) {
  const packages = new Map();
  for (const metafile of metafiles) {
    for (const input of Object.keys(metafile.inputs)) {
      if (!input.replaceAll('\\', '/').includes('node_modules/')) continue;
      let directory = dirname(resolve(root, input));
      while (true) {
        if (directory === resolve(root))
          throw new Error('Cannot identify a bundled dependency.');
        const manifest = join(directory, 'package.json');
        const pkg = existsSync(manifest)
          ? JSON.parse(readFileSync(manifest, 'utf8'))
          : undefined;
        if (pkg?.name && pkg?.version) {
          packages.set(directory, pkg);
          break;
        }
        const parent = dirname(directory);
        if (parent === directory || directory === resolve(root))
          throw new Error('Cannot identify a bundled dependency.');
        directory = parent;
      }
    }
  }
  const records = [];
  const missing = [];
  for (const [directory, pkg] of packages) {
    const files = readdirSync(directory, { withFileTypes: true })
      .filter(
        (file) =>
          file.isFile() &&
          /^(?:licen[cs]e|copying|notice)(?:[.-]|$)/i.test(file.name),
      )
      .map((file) => file.name)
      .sort();
    if (!files.length) {
      const upstream = upstreamLicenses[`${pkg.name}@${pkg.version}`];
      if (upstream) {
        const text = readFileSync(
          new URL(upstream.file, licenseDirectory),
          'utf8',
        ).trim();
        if (!text)
          throw new Error(`Empty license for ${pkg.name}@${pkg.version}.`);
        records.push(
          `${pkg.name}@${pkg.version}\n${'='.repeat(72)}\nSource: ${upstream.source}\n${text}`,
        );
        continue;
      }
      missing.push(`${pkg.name}@${pkg.version}`);
      continue;
    }
    const texts = files.map((file) => {
      const text = readFileSync(join(directory, file), 'utf8').trim();
      if (!text)
        throw new Error(`Empty license for ${pkg.name}@${pkg.version}.`);
      return `${file}\n${text}`;
    });
    records.push(
      `${pkg.name}@${pkg.version}\n${'='.repeat(72)}\n${texts.join('\n\n')}`,
    );
  }
  if (missing.length)
    throw new Error(`Missing license text for bundled ${missing.join(', ')}.`);
  if (!records.length) throw new Error('No bundled dependency licenses found.');
  return `Third-party software bundled in dsh-pptx-editor\n\n${records.sort().join('\n\n\n')}\n`;
}
