# Hextris Remake Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Построить минималистичный браузерный ремейк Hextris с оригинальной механикой, авторским матовым визуальным стилем и плавной Canvas-анимацией.

**Architecture:** Чистая TypeScript-симуляция хранит правила и состояние отдельно от браузера. Vite запускает статическое приложение, Canvas 2D рисует игру, а небольшой DOM-контроллер управляет меню, паузой и экраном проигрыша. Фиксированный шаг симуляции и детерминированный генератор делают механику и браузерные проверки воспроизводимыми.

**Tech Stack:** Node.js 24+, TypeScript, Vite, Vitest, jsdom, Canvas 2D, Playwright-клиент из навыка `develop-web-game`.

**Spec:** `docs/superpowers/specs/2026-09-04-hextris-remake-design.md`

## Global Constraints

- Desktop-first статический сайт без сервера, базы данных, аккаунтов и аналитики.
- Экраны только: старт, игра, пауза и game over.
- Управление: `A`/`D`, `←`/`→`, `Escape`; `F` используется только как техническое полноэкранное управление для браузерного тестового контура.
- Во время игры показывается только текущий счёт и компактная кнопка паузы.
- Нет настроек, рекордов, сохранений, музыки, звуков, дополнительных режимов и отдельной мобильной версии.
- Визуальный стиль: графитовый фон, матовые коралловый/янтарный/бирюзовый/небесно-синий, без неона, glassmorphism, фиолетовых градиентов и pill-кнопок.
- Игровая логика не зависит от DOM, Canvas или частоты рендера.
- Проект лицензируется под `GPL-3.0-or-later` с указанием оригинального Hextris и его авторов.
- Реализация ведётся маленькими TDD-итерациями; после каждого значимого изменения выполняется игровой Playwright-цикл из `develop-web-game` и обновляется `progress.md`.

---

## File Map

- `package.json` — команды разработки, тестов, сборки и проверки типов.
- `tsconfig.json`, `vite.config.ts`, `vitest.config.ts` — настройки TypeScript/Vite/Vitest.
- `index.html` — единственный canvas и минимальные DOM-экраны.
- `src/main.ts` — композиция зависимостей и запуск приложения.
- `src/styles.css` — типографика, геометрические экраны и адаптация окна.
- `src/game/types.ts` — общие типы симуляции, снимков и событий.
- `src/game/constants.ts` — все числовые параметры правил и палитра.
- `src/game/HexGrid.ts` — ориентация, стопки, закрепление, уплотнение и переполнение.
- `src/game/MatchResolver.ts` — поиск связных групп и цепных очисток.
- `src/game/random.ts` — внедряемый детерминированный источник случайности.
- `src/game/WaveSpawner.ts` — сложность, интервалы и паттерны появления.
- `src/game/GameEngine.ts` — команды, падение, столкновения, счёт, комбо и режимы.
- `src/runtime/InputController.ts` — клавиатура и очередь команд.
- `src/runtime/GameRuntime.ts` — fixed timestep, RAF, resize, visibility и тестовые хуки.
- `src/render/geometry.ts` — чистые расчёты точек шестиугольника и блоков.
- `src/render/EffectsSystem.ts` — частицы, импульсы, следы и тряска.
- `src/render/CanvasRenderer.ts` — фон и отрисовка снимка симуляции.
- `src/ui/ScreenController.ts` — меню, пауза, game over и кнопочные действия.
- `tests/**/*.test.ts` — модульные и DOM-тесты.
- `progress.md` — журнал реализации и проверок согласно `develop-web-game`.
- `LICENSE`, `THIRD_PARTY_NOTICES.md`, `README.md` — лицензия, происхождение и запуск.

---

### Task 1: Project foundation, licensing, and smoke test

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `tsconfig.json`
- Create: `vite.config.ts`
- Create: `vitest.config.ts`
- Create: `index.html`
- Create: `src/main.ts`
- Create: `src/styles.css`
- Create: `src/game/constants.ts`
- Create: `tests/constants.test.ts`
- Create: `progress.md`
- Create: `LICENSE`
- Create: `THIRD_PARTY_NOTICES.md`
- Create: `README.md`

**Interfaces:**
- Produces: `APP_TITLE`, `BLOCK_COLORS`, `FIXED_STEP_MS` from `src/game/constants.ts`.
- Produces: npm scripts `dev`, `test`, `test:run`, `typecheck`, `build`.

- [ ] **Step 1: Create the toolchain files and install dependencies**

Use this `package.json` before installing so the lockfile is reproducible:

```json
{
  "name": "hextris-remake",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "test": "vitest",
    "test:run": "vitest run",
    "typecheck": "tsc --noEmit",
    "build": "tsc --noEmit && vite build"
  },
  "devDependencies": {}
}
```

Run:

```powershell
npm install --save-dev typescript vite vitest jsdom @types/node
```

Configure strict TypeScript with `target: ES2022`, `moduleResolution: Bundler`, `lib: ["ES2022", "DOM", "DOM.Iterable"]`, `noUncheckedIndexedAccess: true`, and include `src`, `tests`, and both config files. Configure Vitest with `environment: "jsdom"`, `globals: false`, and tests matching `tests/**/*.test.ts`.

```json
// tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noEmit": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["vitest/globals", "node"]
  },
  "include": ["src", "tests", "vite.config.ts", "vitest.config.ts"]
}
```

```ts
// vite.config.ts
import { defineConfig } from 'vite';
export default defineConfig({});
```

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { environment: 'jsdom', include: ['tests/**/*.test.ts'] } });
```

```gitignore
node_modules/
dist/
test-artifacts/
*.log
```

- [ ] **Step 2: Write the failing smoke test**

```ts
// tests/constants.test.ts
import { describe, expect, it } from 'vitest';
import { APP_TITLE, BLOCK_COLORS, FIXED_STEP_MS } from '../src/game/constants';

describe('game constants', () => {
  it('defines the approved title, palette, and 60 Hz step', () => {
    expect(APP_TITLE).toBe('HEXTRIS');
    expect(BLOCK_COLORS).toEqual(['coral', 'amber', 'teal', 'sky']);
    expect(FIXED_STEP_MS).toBeCloseTo(1000 / 60);
  });
});
```

- [ ] **Step 3: Run the smoke test and verify failure**

Run: `npm run test:run -- tests/constants.test.ts`

Expected: FAIL because `src/game/constants.ts` does not exist.

- [ ] **Step 4: Add the minimal constants and application shell**

```ts
// src/game/constants.ts
export const APP_TITLE = 'HEXTRIS';
export const BLOCK_COLORS = ['coral', 'amber', 'teal', 'sky'] as const;
export const FIXED_STEP_MS = 1000 / 60;
export const SIDE_COUNT = 6;
export const HEX_APOTHEM = 72;
export const BLOCK_DEPTH = 24;
export const START_DISTANCE = 520;
export const MAX_STACK_DEPTH = 12;
export const COMBO_WINDOW_MS = 1200;
```

Create `index.html` with exactly one `<canvas id="game-canvas">`, a `<main id="ui-root">`, and a module script for `/src/main.ts`. `src/main.ts` should set the document title and import `styles.css`; it must not implement gameplay yet.

```html
<!-- index.html -->
<!doctype html>
<html lang="en">
  <head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>HEXTRIS</title></head>
  <body><canvas id="game-canvas"></canvas><main id="ui-root"></main><script type="module" src="/src/main.ts"></script></body>
</html>
```

```ts
// src/main.ts
import './styles.css';
import { APP_TITLE } from './game/constants';
document.title = APP_TITLE;
```

```css
/* src/styles.css */
:root { color: #eee9df; background: #171918; font-family: Arial, sans-serif; }
* { box-sizing: border-box; }
html, body, #game-canvas, #ui-root { width: 100%; height: 100%; margin: 0; }
#game-canvas, #ui-root { position: fixed; inset: 0; }
```

- [ ] **Step 5: Add license, attribution, instructions, and progress log**

Copy the complete GPLv3 text from `https://www.gnu.org/licenses/gpl-3.0.txt` into `LICENSE`. Put this exact attribution in `THIRD_PARTY_NOTICES.md`:

```markdown
# Third-party notices

This project is a modern remake based in part on Hextris:
https://github.com/Hextris/hextris

Original Hextris authors: Logan Engstrom, Garrett Finucane,
Noah Moroze, and Michael Yang. Original code is licensed under GPLv3.
This remake is distributed under GPL-3.0-or-later.
```

Start `progress.md` with the original user request and the approved design path:

```markdown
Original prompt: сделать веб-ремейк Hextris на основе оригинального кода, улучшить анимации и сделать красивое минимальное меню без шаблонного AI-интерфейса.

Design: docs/superpowers/specs/2026-09-04-hextris-remake-design.md
Plan: docs/superpowers/plans/2026-09-04-hextris-remake.md
Current status: project foundation created.
```

Document `npm install`, `npm run dev`, `npm run test:run`, and `npm run build` in `README.md`.

- [ ] **Step 6: Verify and commit**

Run: `npm run test:run -- tests/constants.test.ts && npm run typecheck && npm run build`

Expected: all three commands succeed and Vite creates `dist/`.

```powershell
git add package.json package-lock.json .gitignore tsconfig.json vite.config.ts vitest.config.ts index.html src tests progress.md LICENSE THIRD_PARTY_NOTICES.md README.md
git commit -m "chore: scaffold Hextris remake"
```

---

### Task 2: Hex grid domain model and rotation

**Files:**
- Create: `src/game/types.ts`
- Create: `src/game/HexGrid.ts`
- Create: `tests/HexGrid.test.ts`
- Modify: `progress.md`

**Interfaces:**
- Produces: `BlockColor`, `GridBlock`, `CellRef`, `FallingBlock`, `GameMode`, `GameCommand`, `GameEvent`, `GameSnapshot`.
- Produces: `HexGrid.rotate(steps: -1 | 1): void`, `laneToSide(lane: number): number`, `attach(side: number, block: GridBlock): CellRef`, `collapse(cells: readonly CellRef[]): void`, `isOverflowed(): boolean`, `snapshot(): readonly (readonly GridBlock[])[]`.

- [ ] **Step 1: Define the failing grid tests**

```ts
// tests/HexGrid.test.ts
import { describe, expect, it } from 'vitest';
import { HexGrid } from '../src/game/HexGrid';

const block = (id: number, color = 'coral' as const) => ({ id, color });

describe('HexGrid', () => {
  it('maps world lanes through wrapped 60-degree rotation', () => {
    const grid = new HexGrid(12);
    expect(grid.laneToSide(0)).toBe(0);
    grid.rotate(1);
    expect(grid.laneToSide(0)).toBe(1);
    grid.rotate(-1);
    expect(grid.laneToSide(5)).toBe(5);
  });

  it('attaches, collapses, and detects overflow', () => {
    const grid = new HexGrid(2);
    grid.attach(0, block(1));
    grid.attach(0, block(2));
    expect(grid.isOverflowed()).toBe(true);
    grid.collapse([{ side: 0, index: 0 }]);
    expect(grid.snapshot()[0]?.map((item) => item.id)).toEqual([2]);
    expect(grid.isOverflowed()).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests and verify failure**

Run: `npm run test:run -- tests/HexGrid.test.ts`

Expected: FAIL because the domain modules do not exist.

- [ ] **Step 3: Define stable domain types**

```ts
// src/game/types.ts
import type { BLOCK_COLORS } from './constants';

export type BlockColor = (typeof BLOCK_COLORS)[number];
export interface GridBlock { id: number; color: BlockColor }
export interface CellRef { side: number; index: number }
export interface FallingBlock extends GridBlock { lane: number; distance: number; speed: number }
export type GameMode = 'menu' | 'playing' | 'paused' | 'gameOver';
export type GameCommand = { type: 'rotate'; steps: -1 | 1 } | { type: 'togglePause' };
export type GameEvent =
  | { type: 'blockLanded'; block: GridBlock; cell: CellRef }
  | { type: 'matchCleared'; cells: readonly CellRef[]; color: BlockColor; chain: number }
  | { type: 'comboChanged'; multiplier: number }
  | { type: 'gameOver'; score: number };

export interface GameSnapshot {
  mode: GameMode;
  score: number;
  combo: number;
  orientation: number;
  stacks: readonly (readonly GridBlock[])[];
  falling: readonly FallingBlock[];
  elapsedMs: number;
}
```

- [ ] **Step 4: Implement `HexGrid` minimally**

Store six private stacks and normalize every side with `((value % 6) + 6) % 6`. `rotate` updates `orientation`; `laneToSide` returns the normalized sum of lane and orientation. `snapshot` returns copied arrays so consumers cannot mutate internal state. `collapse` groups indices per side, sorts descending, and splices them. Overflow means any stack length is greater than or equal to the configured maximum.

```ts
// src/game/HexGrid.ts — complete public shape and core operations
import { MAX_STACK_DEPTH, SIDE_COUNT } from './constants';
import type { CellRef, GridBlock } from './types';

const wrapSide = (value: number) => ((value % SIDE_COUNT) + SIDE_COUNT) % SIDE_COUNT;

export class HexGrid {
  private readonly stacks: GridBlock[][] = Array.from({ length: SIDE_COUNT }, () => []);
  public orientation = 0;
  public constructor(private readonly maxDepth = MAX_STACK_DEPTH) {}
  public rotate(steps: -1 | 1): void { this.orientation = wrapSide(this.orientation + steps); }
  public laneToSide(lane: number): number { return wrapSide(lane + this.orientation); }
  public attach(side: number, block: GridBlock): CellRef {
    const wrapped = wrapSide(side);
    this.stacks[wrapped]!.push(block);
    return { side: wrapped, index: this.stacks[wrapped]!.length - 1 };
  }
  public collapse(cells: readonly CellRef[]): void {
    for (let side = 0; side < SIDE_COUNT; side += 1) {
      const indexes = cells.filter((cell) => cell.side === side).map((cell) => cell.index).sort((a, b) => b - a);
      for (const index of indexes) this.stacks[side]!.splice(index, 1);
    }
  }
  public isOverflowed(): boolean { return this.stacks.some((stack) => stack.length >= this.maxDepth); }
  public snapshot(): readonly (readonly GridBlock[])[] { return this.stacks.map((stack) => [...stack]); }
}
```

- [ ] **Step 5: Verify and commit**

Run: `npm run test:run -- tests/HexGrid.test.ts && npm run typecheck`

Expected: PASS.

Append `HexGrid implemented and verified.` to `progress.md`.

```powershell
git add src/game/types.ts src/game/HexGrid.ts tests/HexGrid.test.ts progress.md
git commit -m "feat: add rotating hex grid model"
```

---

### Task 3: Match detection and chain resolution

**Files:**
- Create: `src/game/MatchResolver.ts`
- Create: `tests/MatchResolver.test.ts`
- Modify: `progress.md`

**Interfaces:**
- Consumes: `GridBlock`, `CellRef`, six immutable stacks.
- Produces: `findConnectedGroup(stacks, start): CellRef[]` and `resolveAllMatches(stacks): MatchResolution` where `MatchResolution = { groups: ResolvedGroup[]; stacks: GridBlock[][] }` and `ResolvedGroup = { color: BlockColor; cells: CellRef[]; chain: number }`.

- [ ] **Step 1: Write failing connectivity tests**

```ts
// tests/MatchResolver.test.ts
import { describe, expect, it } from 'vitest';
import { resolveAllMatches } from '../src/game/MatchResolver';
import type { GridBlock } from '../src/game/types';

const b = (id: number, color: GridBlock['color']): GridBlock => ({ id, color });

describe('resolveAllMatches', () => {
  it('clears a vertical group of three but keeps a pair', () => {
    const stacks = [[b(1, 'coral'), b(2, 'coral'), b(3, 'coral')], [b(4, 'sky'), b(5, 'sky')], [], [], [], []];
    const result = resolveAllMatches(stacks);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]?.cells).toHaveLength(3);
    expect(result.stacks[0]).toEqual([]);
    expect(result.stacks[1]).toHaveLength(2);
  });

  it('wraps connectivity between side five and side zero', () => {
    const stacks = [[b(1, 'teal')], [], [], [], [], [b(2, 'teal'), b(3, 'teal')]];
    const result = resolveAllMatches(stacks);
    expect(result.groups[0]?.cells).toHaveLength(3);
  });

  it('rechecks after collapse and reports a second chain', () => {
    const stacks = [
      [b(1, 'coral'), b(2, 'coral'), b(3, 'coral'), b(4, 'amber')],
      [b(5, 'amber')],
      [b(6, 'amber')],
      [], [], [],
    ];
    const result = resolveAllMatches(stacks);
    expect(result.groups.map((group) => group.chain)).toEqual([1, 2]);
  });
});
```

- [ ] **Step 2: Verify the tests fail**

Run: `npm run test:run -- tests/MatchResolver.test.ts`

Expected: FAIL because `MatchResolver` does not exist.

- [ ] **Step 3: Implement flood-fill and repeated resolution**

For a cell `(side, index)`, inspect `(side, index - 1)`, `(side, index + 1)`, `(side - 1, index)`, and `(side + 1, index)` with side wrapping. Use a `Set<string>` key `${side}:${index}`. In each resolution pass, collect all disjoint groups with length at least three, remove their union, increment `chain`, and repeat until no qualifying group remains. Return fresh stacks and preserve original block objects for effects.

```ts
// src/game/MatchResolver.ts — resolution loop
export function resolveAllMatches(source: readonly (readonly GridBlock[])[]): MatchResolution {
  const stacks = source.map((stack) => [...stack]);
  const groups: ResolvedGroup[] = [];
  let chain = 1;
  while (true) {
    const pass = findDisjointGroups(stacks).filter((cells) => cells.length >= 3);
    if (pass.length === 0) break;
    for (const cells of pass) groups.push({ color: stacks[cells[0]!.side]![cells[0]!.index]!.color, cells, chain });
    removeCells(stacks, pass.flat());
    chain += 1;
  }
  return { groups, stacks };
}

export function findConnectedGroup(stacks: readonly (readonly GridBlock[])[], start: CellRef): CellRef[] {
  const first = stacks[start.side]?.[start.index];
  if (!first) return [];
  const queue = [start];
  const found: CellRef[] = [];
  const seen = new Set<string>();
  while (queue.length > 0) {
    const cell = queue.shift()!;
    const side = ((cell.side % 6) + 6) % 6;
    const key = `${side}:${cell.index}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (stacks[side]?.[cell.index]?.color !== first.color) continue;
    found.push({ side, index: cell.index });
    queue.push(
      { side, index: cell.index - 1 }, { side, index: cell.index + 1 },
      { side: (side + 5) % 6, index: cell.index }, { side: (side + 1) % 6, index: cell.index },
    );
  }
  return found;
}
```

Define `findDisjointGroups` by calling `findConnectedGroup` for every unvisited cell and marking each returned `${side}:${index}` key before continuing. Define `removeCells` with the same per-side descending-index strategy used by `HexGrid.collapse`; both helpers stay private to this module.

- [ ] **Step 4: Verify and commit**

Run: `npm run test:run -- tests/MatchResolver.test.ts && npm run test:run`

Expected: PASS with no grid regression.

Append `Match resolution and chain collapse verified.` to `progress.md`.

```powershell
git add src/game/MatchResolver.ts tests/MatchResolver.test.ts progress.md
git commit -m "feat: resolve Hextris color matches"
```

---

### Task 4: Deterministic wave generator

**Files:**
- Create: `src/game/random.ts`
- Create: `src/game/WaveSpawner.ts`
- Create: `tests/WaveSpawner.test.ts`
- Modify: `progress.md`

**Interfaces:**
- Produces: `RandomSource { next(): number }`, `SeededRandom`, `SpawnRequest { lane: number; color: BlockColor; speed: number }`, `PatternEntry { lane: number; color: BlockColor; delayMs: number }`, `WavePattern`, and `WaveSpawner.update(deltaMs): SpawnRequest[]`.
- Produces: `WaveSpawner.createPattern(pattern, anchor, colorIndexes): PatternEntry[]` for deterministic pattern tests; `colorIndexes` must be non-empty or the method throws `RangeError`.

- [ ] **Step 1: Write failing pattern and difficulty tests**

```ts
// tests/WaveSpawner.test.ts
import { describe, expect, it } from 'vitest';
import { SeededRandom } from '../src/game/random';
import { WaveSpawner } from '../src/game/WaveSpawner';

describe('WaveSpawner', () => {
  it('creates the original-style lane patterns', () => {
    const spawner = new WaveSpawner(new SeededRandom(7));
    expect(spawner.createPattern('pair', 5, [0, 1]).map((x) => x.lane)).toEqual([5, 0]);
    expect(spawner.createPattern('opposite', 2, [0]).map((x) => x.lane)).toEqual([2, 5]);
    expect(spawner.createPattern('halfCircle', 4, [0, 1, 2]).map((x) => x.lane)).toEqual([4, 5, 0]);
    expect(spawner.createPattern('circle', 0, [0, 1, 2, 3]).map((x) => x.lane)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(spawner.createPattern('spiral', 3, [0, 1]).map((x) => x.lane)).toEqual([3, 4, 5, 0, 1, 2]);
    expect(spawner.createPattern('spiral', 3, [0, 1]).map((x) => x.delayMs)).toEqual([0, 160, 320, 480, 640, 800]);
  });

  it('never exceeds the configured speed or minimum interval', () => {
    const spawner = new WaveSpawner(new SeededRandom(11));
    for (let i = 0; i < 20_000; i += 1) spawner.update(16.6667);
    expect(spawner.intervalMs).toBeGreaterThanOrEqual(600);
    expect(spawner.speed).toBeLessThanOrEqual(420);
  });
});
```

- [ ] **Step 2: Run and verify failure**

Run: `npm run test:run -- tests/WaveSpawner.test.ts`

Expected: FAIL because both modules are missing.

- [ ] **Step 3: Implement seeded randomness and patterns**

Use a 32-bit mulberry-style generator so identical seeds produce identical waves. Define patterns `single`, `pair`, `opposite`, `halfCircle`, `circle`, and `spiral`. Normalize lanes to `0..5`; cycle supplied color indexes when a pattern needs more blocks. Circle entries share `delayMs: 0`; spiral entries are staggered by 160 ms. `WaveSpawner` owns the pending schedule and `update` returns only entries whose delay has elapsed. Start at a 2700 ms interval and 150 world-units/second, then ease toward 600 ms and 420 world-units/second based on elapsed play time.

```ts
// src/game/random.ts
export interface RandomSource { next(): number }
export class SeededRandom implements RandomSource {
  public constructor(private state: number) {}
  public next(): number {
    this.state |= 0;
    this.state = (this.state + 0x6d2b79f5) | 0;
    let value = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  }
}
```

```ts
// src/game/WaveSpawner.ts — public contract
export type WavePattern = 'single' | 'pair' | 'opposite' | 'halfCircle' | 'circle' | 'spiral';
export interface SpawnRequest { lane: number; color: BlockColor; speed: number }
export interface PatternEntry { lane: number; color: BlockColor; delayMs: number }

const OFFSETS: Record<WavePattern, number[]> = {
  single: [0], pair: [0, 1], opposite: [0, 3], halfCircle: [0, 1, 2],
  circle: [0, 1, 2, 3, 4, 5], spiral: [0, 1, 2, 3, 4, 5],
};

function buildPattern(pattern: WavePattern, anchor: number, colorIndexes: number[]): PatternEntry[] {
  return OFFSETS[pattern].map((offset, index) => ({
    lane: (anchor + offset) % 6,
    color: BLOCK_COLORS[colorIndexes[index % colorIndexes.length]! % BLOCK_COLORS.length]!,
    delayMs: pattern === 'spiral' ? index * 160 : 0,
  }));
}
```

`WaveSpawner.createPattern` delegates to `buildPattern`. `update` subtracts `deltaMs` from pending delays, releases every entry at or below zero in stable insertion order, accumulates time toward `intervalMs`, and schedules one seeded pattern whenever the interval is crossed.

- [ ] **Step 4: Verify and commit**

Run: `npm run test:run -- tests/WaveSpawner.test.ts && npm run typecheck`

Expected: PASS.

Append `Seeded wave patterns and difficulty caps verified.` to `progress.md`.

```powershell
git add src/game/random.ts src/game/WaveSpawner.ts tests/WaveSpawner.test.ts progress.md
git commit -m "feat: add deterministic wave generation"
```

---

### Task 5: Game engine, collisions, scoring, and modes

**Files:**
- Create: `src/game/GameEngine.ts`
- Create: `tests/GameEngine.test.ts`
- Modify: `src/game/HexGrid.ts`
- Modify: `src/game/types.ts`
- Modify: `progress.md`

**Interfaces:**
- Consumes: `HexGrid`, `resolveAllMatches`, `WaveSpawner`, `GameCommand`.
- Produces: `start(): void`, `restart(): void`, `returnToMenu(): void`, `enqueue(command): void`, `update(deltaMs): readonly GameEvent[]`, `getSnapshot(): GameSnapshot`.
- Produces test-only construction options: `{ randomSeed?: number; maxStackDepth?: number; spawning?: boolean }`, `debugSpawn(request: SpawnRequest): void`, and `debugAttachGroup(color: BlockColor, placements: { side: number; count: number }[]): void`.

- [ ] **Step 1: Write failing engine tests**

```ts
// tests/GameEngine.test.ts
import { describe, expect, it } from 'vitest';
import { GameEngine } from '../src/game/GameEngine';

describe('GameEngine', () => {
  it('rotates only while playing and lands a block on the mapped side', () => {
    const game = new GameEngine({ spawning: false });
    game.start();
    game.enqueue({ type: 'rotate', steps: 1 });
    game.debugSpawn({ lane: 0, color: 'coral', speed: 1000 });
    game.update(1000);
    expect(game.getSnapshot().orientation).toBe(1);
    expect(game.getSnapshot().stacks[1]).toHaveLength(1);
  });

  it('scores squared group size and advances combo inside the window', () => {
    const game = new GameEngine({ spawning: false });
    game.start();
    game.debugAttachGroup('coral', [{ side: 0, count: 3 }]);
    game.update(16.6667);
    expect(game.getSnapshot().score).toBe(9);
    game.debugAttachGroup('sky', [{ side: 1, count: 3 }]);
    game.update(16.6667);
    expect(game.getSnapshot().combo).toBe(2);
    expect(game.getSnapshot().score).toBe(27);
  });

  it('pauses without advancing elapsed time and emits game over on overflow', () => {
    const game = new GameEngine({ spawning: false, maxStackDepth: 2 });
    game.start();
    game.enqueue({ type: 'togglePause' });
    game.update(500);
    expect(game.getSnapshot().mode).toBe('paused');
    expect(game.getSnapshot().elapsedMs).toBe(0);
    game.enqueue({ type: 'togglePause' });
    game.update(0);
    game.debugAttachGroup('coral', [{ side: 0, count: 2 }]);
    const events = game.update(16.6667);
    expect(game.getSnapshot().mode).toBe('gameOver');
    expect(events.some((event) => event.type === 'gameOver')).toBe(true);
  });
});
```

- [ ] **Step 2: Run and verify failure**

Run: `npm run test:run -- tests/GameEngine.test.ts`

Expected: FAIL because `GameEngine` does not exist.

- [ ] **Step 3: Implement the command and fixed-step simulation contract**

Process at most two queued rotations per update and normalize orientation through `HexGrid`. Ignore rotations outside `playing`. While paused/menu/gameOver, do not advance elapsed time, blocks, combo timer, or spawner. Move each falling block inward by `speed * deltaMs / 1000`; land when it reaches `HEX_APOTHEM + stackLength * BLOCK_DEPTH`.

```ts
// src/game/GameEngine.ts — update order
public update(deltaMs: number): readonly GameEvent[] {
  const events: GameEvent[] = [];
  this.applyQueuedCommands();
  if (this.mode !== 'playing') return events;
  this.elapsedMs += deltaMs;
  this.spawn(this.spawner.update(deltaMs));
  this.moveAndLand(deltaMs, events);
  this.resolveAndScore(events);
  if (this.grid.isOverflowed()) {
    this.mode = 'gameOver';
    events.push({ type: 'gameOver', score: this.score });
  }
  return events;
}
```

- [ ] **Step 4: Implement resolution, score, and events**

After all landings in a step, resolve groups until stable. For each group, add `groupSize * groupSize * comboMultiplier`. A match inside `COMBO_WINDOW_MS` increments combo; otherwise reset it to one. Emit immutable `blockLanded`, `matchCleared`, `comboChanged`, and `gameOver` events. Keep `debugSpawn` and `debugAttachGroup` explicit and documented as deterministic test helpers; they must not be called by production code.

```ts
private resolveAndScore(events: GameEvent[]): void {
  const resolution = resolveAllMatches(this.grid.snapshot());
  for (const group of resolution.groups) {
    const insideWindow = this.elapsedMs - this.lastMatchAtMs <= COMBO_WINDOW_MS;
    this.combo = insideWindow ? this.combo + 1 : 1;
    this.score += group.cells.length ** 2 * this.combo;
    this.lastMatchAtMs = this.elapsedMs;
    events.push({ type: 'matchCleared', cells: group.cells, color: group.color, chain: group.chain });
    events.push({ type: 'comboChanged', multiplier: this.combo });
  }
  this.grid.replaceStacks(resolution.stacks);
}
```

Add `HexGrid.replaceStacks(stacks)` as a validated copy operation requiring exactly six stacks. Bound the command queue to two pending rotations plus one pause toggle; discard further repeated rotations until the next update.

- [ ] **Step 5: Verify and commit**

Run: `npm run test:run -- tests/GameEngine.test.ts && npm run test:run && npm run typecheck`

Expected: PASS.

Append `Core game loop, score, combo, pause, and game over verified.` to `progress.md`.

```powershell
git add src/game/GameEngine.ts src/game/HexGrid.ts src/game/types.ts tests/GameEngine.test.ts progress.md
git commit -m "feat: implement Hextris game engine"
```

---

### Task 6: Input, fixed-step runtime, and automation hooks

**Files:**
- Create: `src/runtime/InputController.ts`
- Create: `src/runtime/GameRuntime.ts`
- Create: `tests/InputController.test.ts`
- Create: `tests/GameRuntime.test.ts`
- Modify: `src/game/types.ts`
- Modify: `progress.md`

**Interfaces:**
- Produces: `InputController.start()`, `stop()`, with callback `(command: GameCommand) => void`.
- Produces: `GameRuntime.start()`, `stop()`, `advanceTime(ms)`, `advanceRealDelta(ms)`, `resize()`, `renderGameToText(): string`.
- Exposes: `window.render_game_to_text(): string` and `window.advanceTime(ms): void`.

- [ ] **Step 1: Write failing keyboard tests**

```ts
// tests/InputController.test.ts
import { describe, expect, it, vi } from 'vitest';
import { InputController } from '../src/runtime/InputController';

describe('InputController', () => {
  it.each([['ArrowLeft', -1], ['a', -1], ['ArrowRight', 1], ['d', 1]] as const)(
    'maps %s to rotation',
    (key, steps) => {
      const send = vi.fn();
      const input = new InputController(window, send);
      input.start();
      window.dispatchEvent(new KeyboardEvent('keydown', { key }));
      expect(send).toHaveBeenCalledWith({ type: 'rotate', steps });
      input.stop();
    },
  );
});
```

- [ ] **Step 2: Write failing runtime tests**

```ts
// tests/GameRuntime.test.ts
import { describe, expect, it, vi } from 'vitest';
import { GameEngine } from '../src/game/GameEngine';
import { GameRuntime } from '../src/runtime/GameRuntime';

describe('GameRuntime', () => {
  it('caps a long real frame but advances explicit test time fully', () => {
    const update = vi.fn();
    const snapshot = () => ({ mode: 'playing', score: 0, combo: 1, orientation: 0, stacks: [[], [], [], [], [], []], falling: [], elapsedMs: 0 } as const);
    const runtime = GameRuntime.forTest({ update, snapshot });
    runtime.advanceRealDelta(10_000);
    expect(update.mock.calls.length).toBeLessThanOrEqual(15);
    update.mockClear();
    runtime.advanceTime(1000);
    expect(update.mock.calls.length).toBe(60);
    expect(JSON.parse(runtime.renderGameToText())).toMatchObject({ mode: 'playing', score: 0, coordinateSystem: 'center origin; +x right; +y down; lanes clockwise from top' });
  });

  it('produces the same simulation result for different frame chunks', () => {
    const run = (chunks: number[]) => {
      const game = new GameEngine({ spawning: false });
      game.start();
      game.debugSpawn({ lane: 0, color: 'sky', speed: 120 });
      const runtime = GameRuntime.forTest({
        update: (ms) => game.update(ms),
        snapshot: () => game.getSnapshot(),
      });
      chunks.forEach((ms) => runtime.advanceRealDelta(ms));
      return game.getSnapshot();
    };

    expect(run([100, 100, 100])).toEqual(run([16, 17, 33, 34, 50, 50, 100]));
  });
});
```

- [ ] **Step 3: Run both tests and verify failure**

Run: `npm run test:run -- tests/InputController.test.ts tests/GameRuntime.test.ts`

Expected: FAIL because runtime modules do not exist.

- [ ] **Step 4: Implement input and deterministic stepping**

Map `Escape` to `{ type: 'togglePause' }`; ignore key repeat. Map `F` to `document.documentElement.requestFullscreen()` and allow the browser to use Escape to exit fullscreen. In runtime, `advanceRealDelta(ms)` caps accumulated real-frame time at 250 ms, steps using `FIXED_STEP_MS`, and renders once per RAF. `advanceTime(ms)` deliberately does not cap explicit test time: it uses the same fixed step for the entire requested duration and renders once, enabling deterministic Playwright tests.

```ts
// src/runtime/InputController.ts — key mapping
private readonly onKeyDown = (event: KeyboardEvent): void => {
  if (event.repeat) return;
  const key = event.key.toLowerCase();
  if (key === 'a' || key === 'arrowleft') this.send({ type: 'rotate', steps: -1 });
  if (key === 'd' || key === 'arrowright') this.send({ type: 'rotate', steps: 1 });
  if (key === 'escape' && !document.fullscreenElement) this.send({ type: 'togglePause' });
  if (key === 'f' && !document.fullscreenElement) void document.documentElement.requestFullscreen();
};
```

```ts
// src/runtime/GameRuntime.ts — shared stepping primitive
private stepDuration(durationMs: number): void {
  this.accumulatorMs += durationMs;
  while (this.accumulatorMs >= FIXED_STEP_MS) {
    const events = this.engine.update(FIXED_STEP_MS);
    this.effects.consume(events);
    this.effects.update(FIXED_STEP_MS);
    this.accumulatorMs -= FIXED_STEP_MS;
  }
  this.render(this.accumulatorMs / FIXED_STEP_MS);
}
public advanceRealDelta(ms: number): void { this.stepDuration(Math.min(ms, 250)); }
public advanceTime(ms: number): void { this.stepDuration(Math.max(0, ms)); }
```

`renderGameToText` must return concise JSON containing mode, score, combo, orientation, visible falling blocks, non-empty stacks, elapsed time, and the coordinate-system string asserted above.

- [ ] **Step 5: Handle browser lifecycle**

On `visibilitychange` to hidden, pause a playing game. On resize/fullscreen change, resize backing canvas using `devicePixelRatio` while preserving simulation state. Export test installation helpers, then assign both required functions on `window` in `src/main.ts` during application composition.

```ts
Object.assign(window, {
  render_game_to_text: () => runtime.renderGameToText(),
  advanceTime: (ms: number) => runtime.advanceTime(ms),
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && engine.getSnapshot().mode === 'playing') engine.enqueue({ type: 'togglePause' });
});
```

- [ ] **Step 6: Verify and commit**

Run: `npm run test:run -- tests/InputController.test.ts tests/GameRuntime.test.ts && npm run test:run && npm run typecheck`

Expected: PASS.

Append `Keyboard, lifecycle, fixed-step loop, and automation hooks verified.` to `progress.md`.

```powershell
git add src/runtime src/game/types.ts tests/InputController.test.ts tests/GameRuntime.test.ts progress.md
git commit -m "feat: add deterministic browser runtime"
```

---

### Task 7: Render geometry and effects system

**Files:**
- Create: `src/render/geometry.ts`
- Create: `src/render/EffectsSystem.ts`
- Create: `tests/geometry.test.ts`
- Create: `tests/EffectsSystem.test.ts`
- Modify: `progress.md`

**Interfaces:**
- Produces: `hexPoints(center, radius, rotationRad)`, `blockQuad(center, angleRad, near, depth)`.
- Produces: `EffectsSystem.consume(events)`, `update(deltaMs)`, `snapshot(): EffectsSnapshot`, `reset()`.

- [ ] **Step 1: Write failing geometry and lifetime tests**

```ts
// tests/geometry.test.ts
import { describe, expect, it } from 'vitest';
import { hexPoints } from '../src/render/geometry';

describe('hexPoints', () => {
  it('returns six equidistant clockwise points', () => {
    const points = hexPoints({ x: 0, y: 0 }, 10, 0);
    expect(points).toHaveLength(6);
    expect(points[0]).toEqual({ x: 10, y: 0 });
    expect(Math.hypot(points[3]!.x, points[3]!.y)).toBeCloseTo(10);
  });
});
```

```ts
// tests/EffectsSystem.test.ts
import { describe, expect, it } from 'vitest';
import { EffectsSystem } from '../src/render/EffectsSystem';

describe('EffectsSystem', () => {
  it('creates finite particles and removes them after their lifetime', () => {
    const effects = new EffectsSystem(() => 0.5);
    effects.consume([{ type: 'matchCleared', cells: [{ side: 0, index: 0 }, { side: 0, index: 1 }, { side: 0, index: 2 }], color: 'coral', chain: 1 }]);
    expect(effects.snapshot().particles.length).toBeGreaterThan(0);
    effects.update(2000);
    expect(effects.snapshot().particles).toEqual([]);
  });
});
```

- [ ] **Step 2: Run and verify failure**

Run: `npm run test:run -- tests/geometry.test.ts tests/EffectsSystem.test.ts`

Expected: FAIL because render helpers do not exist.

- [ ] **Step 3: Implement pure geometry and bounded effects**

Keep all geometry in world coordinates. Return new point arrays without Canvas calls. Model particles with position, velocity, rotation, color, age, and lifetime; model camera shake as magnitude plus remaining time; model landing flashes and combo impulses separately. Cap particles at 180 by removing the oldest, and clamp any single effect update to 50 ms.

```ts
// src/render/geometry.ts
export interface Point { x: number; y: number }
export function hexPoints(center: Point, radius: number, rotationRad: number): Point[] {
  return Array.from({ length: 6 }, (_, index) => {
    const angle = rotationRad + index * Math.PI / 3;
    return { x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius };
  });
}
```

```ts
// EffectsSystem.update — deterministic lifetime integration
public update(deltaMs: number): void {
  const dt = Math.min(deltaMs, 50);
  for (const particle of this.particles) {
    particle.ageMs += dt;
    particle.x += particle.vx * dt / 1000;
    particle.y += particle.vy * dt / 1000;
    particle.rotation += particle.spin * dt / 1000;
  }
  this.particles = this.particles.filter((particle) => particle.ageMs < particle.lifetimeMs).slice(-180);
}
```

- [ ] **Step 4: Verify and commit**

Run: `npm run test:run -- tests/geometry.test.ts tests/EffectsSystem.test.ts && npm run typecheck`

Expected: PASS.

Append `Geometry and bounded visual effects model verified.` to `progress.md`.

```powershell
git add src/render/geometry.ts src/render/EffectsSystem.ts tests/geometry.test.ts tests/EffectsSystem.test.ts progress.md
git commit -m "feat: add render geometry and effects"
```

---

### Task 8: Canvas renderer and authored visual language

**Files:**
- Create: `src/render/CanvasRenderer.ts`
- Create: `tests/CanvasRenderer.test.ts`
- Modify: `src/game/constants.ts`
- Modify: `src/main.ts`
- Modify: `progress.md`

**Interfaces:**
- Consumes: `GameSnapshot`, `EffectsSnapshot`, canvas size and interpolation alpha.
- Produces: `CanvasRenderer.resize(width, height, dpr)`, `render(snapshot, effects, alpha)`, `worldToScreen(point)`.

- [ ] **Step 1: Write the failing resize/render contract test**

```ts
// tests/CanvasRenderer.test.ts
import { describe, expect, it, vi } from 'vitest';
import { CanvasRenderer } from '../src/render/CanvasRenderer';

describe('CanvasRenderer', () => {
  it('scales the backing canvas without changing world coordinates', () => {
    const canvas = document.createElement('canvas');
    const setTransform = vi.fn();
    const context = { setTransform, clearRect: vi.fn() } as unknown as CanvasRenderingContext2D;
    vi.spyOn(canvas, 'getContext').mockReturnValue(context);
    const renderer = new CanvasRenderer(canvas);
    renderer.resize(800, 600, 2);
    expect(canvas.width).toBe(1600);
    expect(canvas.height).toBe(1200);
    expect(setTransform).toHaveBeenCalledWith(2, 0, 0, 2, 0, 0);
  });
});
```

- [ ] **Step 2: Run and verify failure**

Run: `npm run test:run -- tests/CanvasRenderer.test.ts`

Expected: FAIL because `CanvasRenderer` does not exist.

- [ ] **Step 3: Implement layered canvas rendering**

Render in this order: graphite fill; low-contrast grain generated procedurally; slowly rotating geometric guide lines; trails; central hex shadow; central hex body; attached blocks; falling blocks; landing flashes; particles; score-adjacent combo impulse. Define exact palette constants:

```ts
export const VISUAL_COLORS = {
  background: '#171918',
  backgroundLift: '#202321',
  ink: '#EEE9DF',
  muted: '#8D918C',
  coral: '#D96C5F',
  amber: '#D7A84A',
  teal: '#5C9D91',
  sky: '#6E9FBC',
  hexTop: '#343936',
  hexBottom: '#252825',
} as const;
```

Give blocks a restrained vertical gradient, one-pixel light edge, two-pixel dark edge, and soft offset shadow. Do not use glow or blur as a primary styling device. Camera shake affects only the world layer, never DOM text.

- [ ] **Step 4: Connect renderer to runtime and verify**

Run: `npm run test:run -- tests/CanvasRenderer.test.ts && npm run test:run && npm run build`

Expected: PASS and successful production bundle.

Start `npm run dev -- --host 127.0.0.1`, run the installed `develop-web-game` Playwright client against the shown URL, capture the canvas after starting a game, open the screenshot, and confirm that the field is centered, all four colors are distinguishable, and no canvas content is clipped.

Append the screenshot path and visual observations to `progress.md`.

- [ ] **Step 5: Commit**

```powershell
git add src/render/CanvasRenderer.ts src/game/constants.ts src/main.ts tests/CanvasRenderer.test.ts progress.md
git commit -m "feat: render the Hextris playfield"
```

---

### Task 9: Minimal screens, transitions, and full playthrough QA

**Files:**
- Create: `src/ui/ScreenController.ts`
- Create: `tests/ScreenController.test.ts`
- Modify: `index.html`
- Modify: `src/styles.css`
- Modify: `src/main.ts`
- Modify: `src/runtime/GameRuntime.ts`
- Modify: `README.md`
- Modify: `progress.md`

**Interfaces:**
- Consumes: actions `start`, `resume`, `restart`, `returnToMenu` and `GameSnapshot`.
- Produces: `ScreenController.render(mode, score)`, `bind(actions)`, `destroy()`.

- [ ] **Step 1: Write failing DOM flow tests**

```ts
// tests/ScreenController.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ScreenController } from '../src/ui/ScreenController';

describe('ScreenController', () => {
  beforeEach(() => {
    document.body.innerHTML = '<main id="ui-root"></main><canvas id="game-canvas"></canvas>';
  });

  it('moves from menu to play and exposes the approved controls', () => {
    const start = vi.fn();
    const controller = new ScreenController(document.getElementById('ui-root')!);
    controller.bind({ start, resume: vi.fn(), restart: vi.fn(), returnToMenu: vi.fn(), togglePause: vi.fn() });
    controller.render('menu', 0);
    expect(document.body.textContent).toContain('HEXTRIS');
    expect(document.body.textContent).toContain('A / D');
    (document.querySelector('[data-action="play"]') as HTMLButtonElement).click();
    expect(start).toHaveBeenCalledOnce();
  });

  it('shows only result, retry, and menu after game over', () => {
    const controller = new ScreenController(document.getElementById('ui-root')!);
    controller.render('gameOver', 144);
    expect(document.body.textContent).toContain('144');
    expect(document.querySelector('[data-action="retry"]')).not.toBeNull();
    expect(document.querySelector('[data-action="menu"]')).not.toBeNull();
    expect(document.body.textContent).not.toContain('SETTINGS');
  });
});
```

- [ ] **Step 2: Run and verify failure**

Run: `npm run test:run -- tests/ScreenController.test.ts`

Expected: FAIL because `ScreenController` does not exist.

- [ ] **Step 3: Implement the four-state UI**

Build menu markup from semantic heading, one `PLAY` button, and one control hint. Playing mode shows a plain score label and clipped-corner pause button. Paused mode shows `PAUSED`, `RESUME`, `RESTART`, `MENU`. Game-over mode shows `GAME OVER`, score, `RETRY`, and `MENU`. Use `data-action` attributes and event delegation; `destroy` removes the listener.

While mode is `menu`, keep the renderer active with a slow decorative hex snapshot and no gameplay updates. The `PLAY` transition scales and rotates that same visual center into the live game field so the menu and canvas read as one authored composition rather than separate template screens.

- [ ] **Step 4: Implement the non-template visual system**

Use a bold condensed display stack for the title and a monospace stack for score/control labels. Compose around the hex axis, use hard 1 px rules, asymmetric small labels, uppercase copy, and buttons made with `clip-path: polygon(...)`. Keep corner radii at `0`; do not add cards around menu content. Animate menu-to-game with a 420 ms scale/rotation transition, pause with a 160 ms wipe, and game over with a 260 ms stagger. Respect `prefers-reduced-motion` by collapsing these durations to 1 ms.

- [ ] **Step 5: Connect composition and run automated checks**

In `src/main.ts`, create engine, effects, renderer, screen controller, input, and runtime in that order. Route engine events to effects and snapshots to both renderer and screens. Ensure restart resets effects, input queue, score, combo, stacks, falling blocks, spawner, and elapsed time.

Run: `npm run test:run && npm run typecheck && npm run build`

Expected: all commands succeed.

- [ ] **Step 6: Run the complete `develop-web-game` browser loop**

Start the local server and exercise these separate short action bursts with pauses between them:

1. Menu screenshot and click `PLAY`.
2. Advance deterministic time until blocks are visible; press left/right and verify orientation in `render_game_to_text`.
3. Pause with Escape; advance time; verify elapsed time and block distances do not change.
4. Resume; force or naturally reach game over; verify final screen.
5. Click `RETRY`; verify score/stacks reset.
6. Return to menu without page reload.
7. Resize to 1280×720 and 1920×1080; verify no clipping.
8. Inspect the latest screenshot after every visual state and check the browser console after every burst.

If a screenshot, text state, or console log disagrees, fix the first concrete issue and repeat the affected burst plus the full critical path. Do not accept a test run that only captures the start screen.

- [ ] **Step 7: Final documentation and commit**

Update `README.md` with controls, architecture summary, attribution, license, and production command `npm run build`. Record final test commands, screenshot paths, browser sizes, and any consciously deferred non-MVP ideas in `progress.md`.

```powershell
git add index.html src tests README.md progress.md
git commit -m "feat: complete the Hextris browser experience"
```

---

## Final Verification Gate

- [ ] Run `npm run test:run` and record the exact passing test count.
- [ ] Run `npm run typecheck` and confirm exit code 0.
- [ ] Run `npm run build` and confirm `dist/index.html` exists.
- [ ] Run the full menu-to-retry Playwright scenario and visually inspect gameplay, pause, and game-over screenshots.
- [ ] Confirm `window.render_game_to_text()` contains only current player-relevant state and valid JSON.
- [ ] Confirm `window.advanceTime(ms)` advances deterministically while playing and does nothing while paused.
- [ ] Search the final UI for prohibited features and visual clichés: settings, high score, login, glass cards, pill buttons, purple gradients, neon glow.
- [ ] Compare every section of the design spec with the shipped behavior and document the result in `progress.md`.
