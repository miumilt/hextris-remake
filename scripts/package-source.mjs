import { cp, mkdir, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// The script travels with Corresponding Source, so rebuilding a source package
// uses that package's own files, independent of the caller's working directory.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(root, 'dist');
const source = resolve(dist, 'source');
const notices = ['LICENSE', 'THIRD_PARTY_NOTICES.md', 'SOURCE.md'];
const inputs = [
  'index.html', 'src', 'package.json', 'package-lock.json', 'tsconfig.json',
  'vite.config.ts', 'vitest.config.ts', 'tests', 'docs', 'README.md', ...notices,
  'scripts/package-source.mjs',
  'test-artifacts/run-premium-arcade-qa.mjs',
];

// Vite must have produced a fresh dist first. Copy only the explicit build
// inputs: never recurse through the repository, dependencies, or prior builds.
await stat(resolve(dist, 'index.html'));
for (const input of inputs) {
  const destination = resolve(source, input);
  await mkdir(dirname(destination), { recursive: true });
  await cp(resolve(root, input), destination, { recursive: true });
}
for (const notice of notices) await cp(resolve(root, notice), resolve(dist, notice));
console.log('Packaged license, notices, and matching Corresponding Source in dist/source/.');
