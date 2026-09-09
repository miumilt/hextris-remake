// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, it } from 'vitest';

it('packages matching build sources and notices while excluding dependencies and QA artifacts', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'hextris-distribution-'));
  const progressionFiles = [
    'src/game/progressionTypes.ts',
    'src/game/CycleDirector.ts',
    'src/game/BonusSystem.ts',
    'src/game/UpgradeSystem.ts',
    'src/render/EffectsSystem.ts',
    'src/render/CanvasRenderer.ts',
    'tests/CycleDirector.test.ts',
    'tests/BonusSystem.test.ts',
    'tests/UpgradeSystem.test.ts',
    'tests/Anomalies.test.ts',
    'tests/ProgressionEffects.test.ts',
    'tests/ProgressionRenderer.test.ts',
    'tests/EndlessRun.test.ts',
    'docs/superpowers/specs/2026-09-06-hextris-endless-progression-design.md',
    'docs/superpowers/plans/2026-09-06-hextris-endless-progression.md',
  ];
  const files = ['index.html', 'package.json', 'package-lock.json', 'tsconfig.json', 'vite.config.ts',
    'vitest.config.ts', 'README.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'SOURCE.md',
    'src/main.ts', 'tests/example.test.ts', ...progressionFiles];
  try {
    for (const file of files) {
      mkdirSync(resolve(fixture, file, '..'), { recursive: true });
      writeFileSync(join(fixture, file), `fixture content for ${file}\n`);
    }
    mkdirSync(join(fixture, 'scripts'));
    cpSync(resolve('scripts/package-source.mjs'), join(fixture, 'scripts/package-source.mjs'));
    mkdirSync(join(fixture, 'dist/assets'), { recursive: true });
    writeFileSync(join(fixture, 'dist/index.html'), 'built application');
    for (const excluded of ['node_modules', 'test-artifacts']) {
      mkdirSync(join(fixture, excluded));
      writeFileSync(join(fixture, excluded, 'private.txt'), 'must not distribute');
    }
    execFileSync(process.execPath, [join(fixture, 'scripts/package-source.mjs')], { cwd: fixture });
    expect(readdirSync(join(fixture, 'dist')).sort()).toEqual([
      'LICENSE', 'SOURCE.md', 'THIRD_PARTY_NOTICES.md', 'assets', 'index.html', 'source',
    ]);
    const bundled = readdirSync(join(fixture, 'dist/source'), { recursive: true }) as string[];
    expect(bundled.some(file => /node_modules|test-artifacts|dist/.test(file))).toBe(false);
    for (const file of [...files, 'scripts/package-source.mjs']) {
      expect(readFileSync(join(fixture, 'dist/source', file))).toEqual(readFileSync(join(fixture, file)));
    }
    for (const file of ['LICENSE', 'THIRD_PARTY_NOTICES.md', 'SOURCE.md']) {
      expect(readFileSync(join(fixture, 'dist', file))).toEqual(readFileSync(join(fixture, file)));
    }
    expect(readFileSync(join(fixture, 'dist/index.html'), 'utf8')).toBe('built application');
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
