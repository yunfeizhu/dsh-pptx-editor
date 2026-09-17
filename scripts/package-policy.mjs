const requiredFiles = [
  'package.json',
  'cordis.patch.yml',
  'dist/index.js',
  'dist/index.d.ts',
  'dist/client.js',
  'dist/client.d.ts',
  'dist/editor/editor.html',
  'dist/editor/editor.js',
  'dist/editor/editor.css',
  'dist/THIRD_PARTY_LICENSES.txt',
  'LICENSE',
  'README.md',
  'README.zh-CN.md',
  'THIRD_PARTY_NOTICES.md',
];

export function validatePackage(pkg, patch, entries) {
  const errors = [];
  const files = new Set(entries.map((entry) => entry.path));
  if (pkg.name !== 'dsh-pptx-editor' || pkg.private === true)
    errors.push('Package must be the public dsh-pptx-editor bundle.');
  if (!/^\d+\.\d+\.\d+$/.test(pkg.version ?? ''))
    errors.push('Use a stable three-part release version.');
  if (pkg.dsh?.bundle?.patch !== './cordis.patch.yml')
    errors.push('Declare the packed DSH bundle patch.');
  if (
    !Array.isArray(patch) ||
    patch.length !== 1 ||
    patch[0]?.insert?.length !== 1 ||
    patch[0]?.insert?.[0]?.id !== 'pptx-editor' ||
    patch[0]?.insert?.[0]?.name !== pkg.name
  )
    errors.push('The bundle must load the installed package by name.');
  if (!pkg.dsh?.client?.inject?.length || pkg.dsh.client.platform !== 'web')
    errors.push('Retain the Web client injection manifest.');
  for (const file of requiredFiles) {
    if (!files.has(file) || !entries.find((entry) => entry.path === file)?.size)
      errors.push(`Missing or empty packed file: ${file}`);
  }
  const exports = [pkg.main, pkg.types];
  for (const value of Object.values(pkg.exports ?? {})) {
    exports.push(
      ...(typeof value === 'string' ? [value] : Object.values(value)),
    );
  }
  for (const file of exports) {
    if (typeof file !== 'string' || !files.has(file.replace(/^\.\//, '')))
      errors.push(`Export does not resolve inside the tarball: ${file}`);
  }
  for (const file of files) {
    if (
      file.includes('..') ||
      (!requiredFiles.includes(file) &&
        !/^dist\/[\w./-]+\.(?:js|css|html|d\.ts|LICENSE\.txt)$/.test(file))
    )
      errors.push(`Unexpected packed file: ${file}`);
  }
  for (const name of ['preinstall', 'install', 'postinstall', 'prepare']) {
    if (pkg.scripts?.[name])
      errors.push('The prebuilt package must not run install-time scripts.');
  }
  return errors;
}
