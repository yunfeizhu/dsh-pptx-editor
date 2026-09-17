import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const ignored = new Set([
  '.git',
  'node_modules',
  'dist',
  'coverage',
  '.cache',
  '.pnpm-store',
  '.dsh-dev',
]);
export function filesUnder(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (ignored.has(entry.name) || entry.isSymbolicLink()) return [];
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(path) : [path];
  });
}
