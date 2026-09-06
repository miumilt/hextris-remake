# HEXTRIS Endless Progression Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the existing Hextris remake into an evolving endless run with timed cycles, escalating wave pressure, disruptive but telegraphed anomalies, one-slot active bonuses, permanent-for-the-run upgrades, and stronger event feedback.

**Architecture:** `CycleDirector`, `BonusSystem`, and `UpgradeSystem` remain deterministic domain modules without DOM or Canvas dependencies. `GameEngine` is the single authoritative coordinator and exposes the new state/events through immutable snapshots; input, screens, effects, and rendering consume those contracts without mutating simulation state. Difficulty continues to rise by active fixed-step time, while UI selection and visual hit stops never change simulation timing.

**Tech Stack:** TypeScript 5.9, Vite 7, Vitest 4 with jsdom, Canvas 2D, semantic HTML/CSS, Playwright through the installed `develop-web-game` client.

**Spec:** `docs/superpowers/specs/2026-09-06-hextris-endless-progression-design.md`

## Global Constraints

- Active play uses repeating 55-second cycles: `FLOW` 30 seconds, `PRESSURE` 15 seconds, `SURGE` 10 seconds, then a frozen upgrade choice.
- Falling speed grows from 150 world units/second by about 1.5 units per active second and is capped at 780; normal wave interval declines smoothly from 2700 ms to a 320 ms floor.
- `PRESSURE` uses a 0.78 interval multiplier and `SURGE` uses 0.52.
- Anomaly warnings last 1000 ms; anomaly timers do not advance in pause, menu, game over, or upgrade selection.
- `REVERSE` and `INERTIA` are never paired in the first version.
- Bonus tokens spawn every seeded 28–42 active seconds outside `SURGE`; one stored bonus replaces the previous one and `Space` activates it.
- Bonus removals award 3 points per removed block and do not directly increase or extend match combo.
- Upgrades persist only for the current run, have the exact caps and modifiers from the spec, and never use browser storage.
- The game remains a desktop-first static build with no server, accounts, analytics, audio, saved progression, shop, currency, or touch-specific UI.
- Visual language stays graphite/ivory with matte coral, amber, teal, and sky; no neon glow, purple gradient, glass card, or pill control.
- Strong shake, flashes, fragments, typographic strikes, and visual hit stops are allowed for important events; simulation stays fixed-step and deterministic.
- `prefers-reduced-motion` removes large shake, visual holds, and parallax while retaining readable rule warnings.
- Restart and menu reset cycles, anomalies, delayed rotations, falling bonus tokens, stored/active bonuses, upgrade levels, choices, and every visual effect.
- GPL-3.0-or-later packaging continues to include `LICENSE`, notices, `SOURCE.md`, and matching Corresponding Source in `dist/source/`.

## File Structure

- Create `src/game/progressionTypes.ts`: shared progression, anomaly, bonus, upgrade, phase, directive, and snapshot types.
- Create `src/game/CycleDirector.ts`: active-time cycle clock, difficulty profile, surge cadence, anomaly warning/active state, compatibility, and bonus schedule.
- Modify `src/game/WaveSpawner.ts`: consume a director-supplied wave profile instead of owning the global difficulty curve.
- Create `src/game/UpgradeSystem.ts`: seeded two-choice offers, selection, caps, modifiers, last-stand consumption, and reset.
- Create `src/game/BonusSystem.ts`: one-slot inventory, weighted token types, active slow timer, deterministic grid targeting, and reset.
- Modify `src/game/types.ts`: authoritative commands, block metadata, events, game mode, and expanded immutable `GameSnapshot`.
- Modify `src/game/GameEngine.ts`: coordinate directors/systems, tokens, upgrade mode, anomaly mechanics, bonus removals, score, and overflow rescue.
- Modify `src/game/HexGrid.ts`: expose validated targeted removal through existing collapse semantics without sparse stacks.
- Modify `src/runtime/InputController.ts`: context-sensitive Space/Enter and upgrade navigation while preserving left/right semantics.
- Modify `src/ui/ScreenController.ts`: compact HUD plus two-option geometric upgrade selection.
- Modify `src/render/EffectsSystem.ts`: stronger bounded impacts, rings, labels, flashes, and visual-hold state for new events.
- Modify `src/render/CanvasRenderer.ts`: anomalous block paths/decoys/facets, bonus token, cycle/anomaly cues, stronger impacts, and visual hold.
- Modify `src/main.ts`: wire expanded immutable snapshot into screens and renderer without changing runtime ownership.
- Modify `src/styles.css`: cycle/bonus/upgrade HUD and reduced-motion rules in the established authored visual language.
- Modify `README.md`, `SOURCE.md`, and `progress.md`: controls, mechanics, build/source packaging, and verification evidence.

---

### Task 1: Standalone cycle director and pressure profile

**Files:**
- Create: `src/game/progressionTypes.ts`
- Create: `src/game/CycleDirector.ts`
- Create: `tests/CycleDirector.test.ts`
- Modify: `src/game/constants.ts`
- Modify: `progress.md`

**Interfaces:**
- Consumes: `RandomSource.next(): number` and existing `WavePattern`.
- Produces: `CycleDirector.update(deltaMs, modifiers): DirectorTick`, `getSnapshot(): CycleSnapshot`, `getWaveProfile(): WaveProfile`, `beginNextCycle()`, and `reset()`.

- [ ] **Step 1: Define progression types and write failing director tests**

Create exact shared contracts in `src/game/progressionTypes.ts`:

```ts
import type { BlockColor } from './types';
import type { WavePattern } from './WaveSpawner';

export type GamePhase = 'flow' | 'pressure' | 'surge';
export type AnomalyType = 'reverse' | 'mirage' | 'drift' | 'colorShift' | 'inertia';
export type BonusType = 'slow' | 'pulse' | 'cleanse' | 'colorBreak';
export type UpgradeId = 'stabilizer' | 'comboRelay' | 'salvage' | 'deepPulse' | 'anomalyShield' | 'lastStand';

export interface DirectorModifiers {
  readonly anomalyDurationMultiplier: number;
  readonly bonusIntervalMultiplier: number;
}

export interface WaveProfile {
  readonly intervalMs: number;
  readonly speed: number;
  readonly patternWeights: Readonly<Record<WavePattern, number>>;
  readonly forcedPattern: WavePattern | null;
}

export type DirectorEvent =
  | { readonly type: 'phaseChanged'; readonly phase: GamePhase; readonly cycle: number }
  | { readonly type: 'anomalyWarning'; readonly anomalies: readonly AnomalyType[] }
  | { readonly type: 'anomalyStarted'; readonly anomalies: readonly AnomalyType[] }
  | { readonly type: 'anomalyEnded'; readonly anomalies: readonly AnomalyType[] }
  | { readonly type: 'cycleCompleted'; readonly cycle: number };

export interface DirectorTick {
  readonly events: readonly DirectorEvent[];
  readonly bonusDue: boolean;
  readonly upgradeDue: boolean;
}

export interface ActiveAnomaly {
  readonly type: AnomalyType;
  readonly remainingMs: number;
}

export interface CycleSnapshot {
  readonly number: number;
  readonly phase: GamePhase;
  readonly elapsedMs: number;
  readonly durationMs: 55_000;
  readonly progress: number;
  readonly warning: readonly AnomalyType[];
  readonly warningRemainingMs: number;
  readonly anomalies: readonly ActiveAnomaly[];
}

export interface BonusRemoval {
  readonly type: BonusType;
  readonly cells: readonly { readonly side: number; readonly index: number }[];
  readonly color?: BlockColor;
}
```

Expose test-only timing/sequence injection through the constructor, never a
browser global:

```ts
export interface CycleDirectorOptions {
  readonly flowMs?: number;
  readonly pressureMs?: number;
  readonly surgeMs?: number;
  readonly forcedAnomaliesByCycle?: Readonly<Record<number, readonly AnomalyType[]>>;
}
```

Add tests that advance exactly across 30, 45, and 55 seconds and assert phase events, `upgradeDue`, frozen snapshots, and no automatic next cycle. Add a long-time difficulty assertion for 780 speed and 320 ms floor.

```ts
it('moves through flow, pressure, surge, then waits for an upgrade', () => {
  const director = new CycleDirector(new SeededRandom(17));
  expect(director.getSnapshot()).toMatchObject({ number: 1, phase: 'flow', elapsedMs: 0 });
  expect(director.update(30_000, NO_MODIFIERS).events).toContainEqual({ type: 'phaseChanged', phase: 'pressure', cycle: 1 });
  expect(director.update(15_000, NO_MODIFIERS).events).toContainEqual({ type: 'phaseChanged', phase: 'surge', cycle: 1 });
  const finish = director.update(10_000, NO_MODIFIERS);
  expect(finish).toMatchObject({ upgradeDue: true });
  expect(finish.events).toContainEqual({ type: 'cycleCompleted', cycle: 1 });
  director.beginNextCycle();
  expect(director.getSnapshot()).toMatchObject({ number: 2, phase: 'flow', elapsedMs: 0 });
});
```

- [ ] **Step 2: Run focused tests and verify the missing-module/API failures**

Run: `npm run test:run -- tests/CycleDirector.test.ts`

Expected: FAIL because `CycleDirector` and the progression contracts do not exist.

- [ ] **Step 3: Implement the cycle clock and difficulty profile**

Add constants with the exact design values:

```ts
export const CYCLE_DURATION_MS = 55_000;
export const FLOW_END_MS = 30_000;
export const PRESSURE_END_MS = 45_000;
export const ANOMALY_WARNING_MS = 1_000;
export const MAX_FALL_SPEED = 780;
export const MIN_WAVE_INTERVAL_MS = 320;
```

`CycleDirector.update` must split a large delta at phase, warning, anomaly,
bonus, and cycle boundaries rather than skipping transitions. Sample each
bonus interval as `28_000 + floor(random.next() * 14_001)`, multiply it by
`DirectorModifiers.bonusIntervalMultiplier`, and then clamp the result to a
16,000 ms floor. When a bonus becomes due during `SURGE`, retain the pending
due flag and emit it on the first playing step of the next `FLOW`; otherwise
return `bonusDue: true` exactly once and schedule the next interval.

Cycle 1 schedules no anomaly. In cycle 2 onward, schedule one warning at
`20_000 + floor(random.next() * 8_001)` cycle milliseconds. From cycle 6
onward, a seeded 45% roll selects two entries from an explicit compatibility
table; otherwise select one. Durations before `ANOMALY SHIELD` are exact:
`reverse` 9,000 ms, `mirage` 10,000 ms, `drift` 12,000 ms, `colorShift`
10,000 ms, and `inertia` 8,000 ms. Never place `reverse` with `inertia`.
Paired anomalies share a warning/start instant but retain independent
`remainingMs` values and emit `anomalyEnded` as each one expires. Return frozen
arrays and objects.

Use the exact continuous curve:

```ts
const activeSeconds = this.totalActiveMs / 1000;
const speed = Math.min(MAX_FALL_SPEED, 150 + activeSeconds * 1.5);
const baseInterval = Math.max(MIN_WAVE_INTERVAL_MS, 2700 * Math.exp(-activeSeconds / 150));
const phaseMultiplier = this.phase === 'pressure' ? 0.78 : this.phase === 'surge' ? 0.52 : 1;
```

Use this exact weight table; after cycle 9, the hard patterns saturate because
speed/cadence and paired anomalies already supply the near-impossible pressure:

```ts
const PATTERN_WEIGHTS: readonly {
  readonly throughCycle: number;
  readonly weights: Readonly<Record<WavePattern, number>>;
}[] = [
  { throughCycle: 2, weights: { single: 6, pair: 4, opposite: 2, halfCircle: 1, circle: 0, spiral: 1 } },
  { throughCycle: 5, weights: { single: 4, pair: 4, opposite: 3, halfCircle: 3, circle: 1, spiral: 3 } },
  { throughCycle: 8, weights: { single: 2, pair: 3, opposite: 4, halfCircle: 4, circle: 2, spiral: 4 } },
  { throughCycle: Infinity, weights: { single: 1, pair: 2, opposite: 4, halfCircle: 5, circle: 3, spiral: 5 } },
];
```

During surge, cycle the forced pattern by spawn beat through `opposite`,
`halfCircle`, `spiral`, and `circle`. The smallest possible scheduled gap is
`320 * 0.52 = 166.4 ms`; never create duplicate lanes within one authored
pattern, preserving a 160 ms minimum lane-reaction budget.

- [ ] **Step 4: Cover scheduling edges and frozen state**

Add focused cases for the exact seeded anomaly instant, all five base
durations, the cycle-6 compatibility roll, rejected `reverse` + `inertia`,
the 16-second SALVAGE interval floor, a bonus deferred across `SURGE`, and a
single large delta split across every boundary. Mutating any returned array or
object must either throw or leave subsequent snapshots unchanged.

- [ ] **Step 5: Run focused and full verification**

Run:

```powershell
npm run test:run -- tests/CycleDirector.test.ts
npm run test:run
npm run typecheck
npm run build
```

Expected: all commands pass; `CycleDirector` is not constructed by the current
game yet, so runtime behavior remains unchanged until Task 4.

- [ ] **Step 6: Record and commit**

Append `Cycle director and externally driven wave pressure verified.` to
`progress.md`.

```powershell
git add src/game/progressionTypes.ts src/game/CycleDirector.ts src/game/constants.ts tests/CycleDirector.test.ts progress.md
git commit -m "feat: add endless cycle director"
```

---

### Task 2: Permanent-for-the-run upgrade system

**Files:**
- Create: `src/game/UpgradeSystem.ts`
- Create: `tests/UpgradeSystem.test.ts`
- Modify: `src/game/progressionTypes.ts`
- Modify: `progress.md`

**Interfaces:**
- Consumes: `UpgradeId`, `RandomSource`.
- Produces: `offer(): UpgradeOffer | null`, `moveSelection(steps)`, `confirm(): UpgradeId | null`, `getSnapshot(): UpgradeSnapshot`, `getModifiers(): UpgradeModifiers`, `consumeLastStand(): boolean`, and `reset()`.

- [ ] **Step 1: Write failing offer, cap, modifier, and reset tests**

Add exact contracts:

```ts
export interface UpgradeChoice {
  readonly id: UpgradeId;
  readonly level: number;
  readonly maxLevel: number;
  readonly label: string;
  readonly description: string;
}

export interface UpgradeSnapshot {
  readonly levels: Readonly<Record<UpgradeId, number>>;
  readonly choices: readonly UpgradeChoice[];
  readonly selectedIndex: number;
}

export interface UpgradeModifiers {
  readonly speedMultiplier: number;
  readonly comboWindowBonusMs: number;
  readonly bonusIntervalMultiplier: number;
  readonly pulseSides: number;
  readonly anomalyDurationMultiplier: number;
  readonly hasLastStand: boolean;
}

export interface UpgradeOffer {
  readonly choices: readonly [UpgradeChoice, UpgradeChoice];
  readonly selectedIndex: 0 | 1;
}
```

Test two distinct choices, wrap-free selection clamped to indices 0/1,
confirmation increasing one level, every exact modifier, maxed entries excluded,
all-maxed `offer()` returning `null`, single consumption of `LAST STAND`, deep
immutability, deterministic seeds, and reset.

- [ ] **Step 2: Run and verify failure**

Run: `npm run test:run -- tests/UpgradeSystem.test.ts`

Expected: FAIL because `UpgradeSystem` is missing.

- [ ] **Step 3: Implement exact definitions and seeded selection**

Use a definition table instead of conditionals scattered through the class:

```ts
const DEFINITIONS: Readonly<Record<UpgradeId, Omit<UpgradeChoice, 'level'>>> = {
  stabilizer: { id: 'stabilizer', maxLevel: 3, label: 'STABILIZER', description: 'FALL SPEED -4%' },
  comboRelay: { id: 'comboRelay', maxLevel: 3, label: 'COMBO RELAY', description: 'COMBO WINDOW +300MS' },
  salvage: { id: 'salvage', maxLevel: 3, label: 'SALVAGE', description: 'BONUS ARRIVAL +15%' },
  deepPulse: { id: 'deepPulse', maxLevel: 2, label: 'DEEP PULSE', description: 'PULSE HITS +1 SIDE' },
  anomalyShield: { id: 'anomalyShield', maxLevel: 3, label: 'ANOMALY SHIELD', description: 'ANOMALY TIME -15%' },
  lastStand: { id: 'lastStand', maxLevel: 1, label: 'LAST STAND', description: 'SURVIVE ONE OVERFLOW' },
};
```

Derive modifiers exactly:

```ts
return Object.freeze({
  speedMultiplier: 1 - levels.stabilizer * 0.04,
  comboWindowBonusMs: levels.comboRelay * 300,
  bonusIntervalMultiplier: 1 - levels.salvage * 0.15,
  pulseSides: 3 + levels.deepPulse,
  anomalyDurationMultiplier: Math.max(4_000 / 8_000, 1 - levels.anomalyShield * 0.15),
  hasLastStand: levels.lastStand > 0,
});
```

`consumeLastStand` sets its level back to zero only when present. Choice order
comes from the seeded random source and cannot contain duplicates. The director
applies SALVAGE to each newly sampled interval and enforces the 16,000 ms floor;
it does not distort the random range inside `UpgradeSystem`.

- [ ] **Step 4: Verify and commit**

Run:

```powershell
npm run test:run -- tests/UpgradeSystem.test.ts
npm run test:run
npm run typecheck
```

Append `Seeded run-only upgrades and modifier caps verified.` to `progress.md`.

```powershell
git add src/game/UpgradeSystem.ts src/game/progressionTypes.ts tests/UpgradeSystem.test.ts progress.md
git commit -m "feat: add run upgrade system"
```

---

### Task 3: One-slot active bonus system

**Files:**
- Create: `src/game/BonusSystem.ts`
- Create: `tests/BonusSystem.test.ts`
- Modify: `src/game/progressionTypes.ts`
- Modify: `progress.md`

**Interfaces:**
- Consumes: immutable six-stack snapshots, `RandomSource`, `BonusType`.
- Produces: `nextToken(id, lane, speed): FallingBonus`, `collect(type): BonusCollection`, `activate(stacks, orientation, pulseSides): BonusActivation | null`, `update(deltaMs)`, `getMotionMultiplier()`, `getSnapshot()`, and `reset()`.

- [ ] **Step 1: Write failing selection and activation tests**

Add types:

```ts
export interface FallingBonus {
  readonly id: number;
  readonly type: BonusType;
  readonly lane: number;
  readonly distance: number;
  readonly speed: number;
}

export interface BonusSnapshot {
  readonly stored: BonusType | null;
  readonly slowRemainingMs: number;
}

export interface BonusCollection {
  readonly collected: BonusType;
  readonly replaced: BonusType | null;
}

export interface BonusActivation extends BonusRemoval {
  readonly scoreDelta: number;
}
```

Use small immutable stacks to verify:

- collecting a second type replaces the first;
- empty activation returns `null`;
- `slow` stores six seconds and returns multiplier 0.55 until expiry;
- `pulse` selects outermost cells on the three tallest sides, or up to five
  with upgrades;
- `cleanse` selects every cell on the tallest side;
- `colorBreak` uses the outermost color of the tallest side and selects that
  color across all sides;
- ties begin at `orientation` and proceed clockwise;
- score is exactly three times removed cells;
- token sequence and reset are deterministic.

- [ ] **Step 2: Run and verify failure**

Run: `npm run test:run -- tests/BonusSystem.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement pure targeting without grid mutation**

`BonusSystem.activate` consumes the stored slot and returns cell references;
it must not splice or mutate the supplied stacks. `GameEngine` will apply the
validated operation in Task 4.

Use weighted token selection with explicit weights:

Screen/event labels are exactly `SLOW`, `PULSE`, `CLEANSE`, and `COLOR BREAK`;
camel-case identifiers never leak into player-facing copy.

```ts
const BONUS_WEIGHTS: Readonly<Record<BonusType, number>> = {
  slow: 4,
  pulse: 4,
  cleanse: 2,
  colorBreak: 1,
};
```

Cell arrays are sorted descending by index inside each side so direct collapse
remains safe. Freeze every returned object and nested array.

- [ ] **Step 4: Verify and commit**

Run:

```powershell
npm run test:run -- tests/BonusSystem.test.ts
npm run test:run
npm run typecheck
```

Append `One-slot deterministic bonus inventory and targeting verified.` to
`progress.md`.

```powershell
git add src/game/BonusSystem.ts src/game/progressionTypes.ts tests/BonusSystem.test.ts progress.md
git commit -m "feat: add active bonus system"
```

---

### Task 4: Integrate cycles, bonus tokens, upgrades, and rescue into GameEngine

**Files:**
- Modify: `src/game/types.ts`
- Modify: `src/game/GameEngine.ts`
- Modify: `src/game/HexGrid.ts`
- Modify: `src/game/WaveSpawner.ts`
- Create: `tests/GameProgression.test.ts`
- Modify: `tests/GameEngine.test.ts`
- Modify: `tests/WaveSpawner.test.ts`
- Modify: `progress.md`

**Interfaces:**
- Consumes: `CycleDirector`, `BonusSystem`, `UpgradeSystem`, `WaveProfile`, and existing match/grid rules.
- Produces: expanded immutable `GameSnapshot`; `activateBonus`, `selectUpgrade`, and `confirmUpgrade` commands; progression `GameEvent` values.

- [ ] **Step 1: Expand types and write failing end-to-end domain tests**

Extend mode and commands exactly:

```ts
export type GameMode = 'menu' | 'playing' | 'paused' | 'upgrade' | 'gameOver';

export type GameCommand =
  | { readonly type: 'rotate'; readonly steps: -1 | 1 }
  | { readonly type: 'togglePause' }
  | { readonly type: 'activateBonus' }
  | { readonly type: 'selectUpgrade'; readonly steps: -1 | 1 }
  | { readonly type: 'confirmUpgrade' };
```

Add `cycle`, `bonus`, `fallingBonuses`, and `upgrades` to `GameSnapshot`. Add
events for phase/cycle, bonus scheduling/collection/replacement/activation and
removal, upgrade offering/selection, and `lastStand` rescue. Every payload and
nested array is readonly and frozen.

Write integration tests using short injected `CycleDirectorOptions` rather
than production debug calls:

```ts
it('freezes at cycle completion until a permanent upgrade is selected', () => {
  const game = progressionGame({ flowMs: 30, pressureMs: 15, surgeMs: 10 });
  game.start();
  const events = game.update(55);
  expect(game.getSnapshot().mode).toBe('upgrade');
  expect(game.getSnapshot().upgrades.choices).toHaveLength(2);
  const frozen = game.getSnapshot().elapsedMs;
  game.update(5_000);
  expect(game.getSnapshot().elapsedMs).toBe(frozen);
  game.enqueue({ type: 'confirmUpgrade' });
  game.update(0);
  expect(game.getSnapshot()).toMatchObject({ mode: 'playing', cycle: { number: 2, phase: 'flow' } });
});
```

Also test token landing into the slot without entering a stack, replacement,
Space-equivalent activation before overflow, score/combo isolation, all-maxed
cycle score fallback, last-stand consumption before game over, pause freezing
all timers, and restart/menu reset.

- [ ] **Step 2: Run and verify type/API failures**

Run: `npm run test:run -- tests/GameProgression.test.ts tests/GameEngine.test.ts`

Expected: FAIL because engine snapshots and commands do not expose progression.

- [ ] **Step 3: Add validated grid removal and engine-owned systems**

Add a single public grid method that reuses `collapse` and returns removed
blocks for event effects:

```ts
public remove(cells: readonly CellRef[]): readonly GridBlock[] {
  const keys = new Set<string>();
  const validated = cells.map(({ side, index }) => {
    if (!Number.isInteger(side) || side < 0 || side >= SIDE_COUNT) throw new RangeError('Invalid side');
    if (!Number.isInteger(index) || index < 0 || index >= this.stacks[side].length) throw new RangeError('Invalid index');
    const key = `${side}:${index}`;
    if (keys.has(key)) throw new Error('Duplicate cell');
    keys.add(key);
    return { side, index };
  });
  const removed = validated.map(({ side, index }) => this.stacks[side][index]);
  this.collapse(validated);
  return Object.freeze(removed.map((block) => Object.freeze({ ...block })));
}
```

Validation completes before `collapse`, so a duplicate or out-of-range
reference cannot partially mutate the grid.

Construct the three systems with independent derived seeds so adding one random
draw does not change the other streams:

```ts
this.director = new CycleDirector(new SeededRandom(this.randomSeed ^ 0x4359434c), options.cycle);
this.bonuses = new BonusSystem(new SeededRandom(this.randomSeed ^ 0x424f4e55));
this.upgrades = new UpgradeSystem(new SeededRandom(this.randomSeed ^ 0x55504752));
```

- [ ] **Step 4: Refactor WaveSpawner and implement fixed-step coordination**

Remove the spawner's elapsed difficulty calculation. Keep pending spiral delays
and seeded color/lane selection. Select a pattern by cumulative positive
weight; when `forcedPattern` is non-null, use it verbatim:

```ts
public update(deltaMs: number, profile: WaveProfile): readonly SpawnRequest[] {
  const ready = this.releaseReady(deltaMs, profile.speed);
  this.intervalElapsedMs += deltaMs;
  while (this.intervalElapsedMs >= profile.intervalMs) {
    this.intervalElapsedMs -= profile.intervalMs;
    this.scheduleWave(profile);
  }
  return Object.freeze(ready.concat(this.releaseReady(0, profile.speed)));
}
```

Update `tests/WaveSpawner.test.ts` so every call supplies a fixed profile. Add
cases for a forced surge pattern and for ignoring zero/negative weights.

For a playing update:

1. Commit pause/resume and current gameplay commands.
2. Advance the director by unscaled active time.
3. Advance active bonus timers.
4. Use bonus slow multiplier for falling movement and WaveSpawner countdown,
   while director difficulty time continues normally.
5. Schedule director token directives outside surge.
6. Move/land normal blocks and bonus tokens.
7. Apply bonus removals before matches and overflow.
8. Resolve natural matches and combo.
9. If overflow remains, consume Last Stand and clear the tallest side before
   emitting game over.
10. If the cycle ended, enter `upgrade`, offer choices, or apply the all-maxed
    cycle score award of `completedCycle * 100` and immediately begin the next
    cycle.

Use `COMBO_WINDOW_MS + upgradeModifiers.comboWindowBonusMs`. Apply stabilizer
after difficulty: `spawnSpeed = profile.speed * speedMultiplier`.

- [ ] **Step 5: Verify immutability, reset, and frame determinism**

Add two engines with the same seed and compare snapshots after equal total time
split into different fixed-size update sequences. Recursively verify all new
snapshot/event values are frozen. Confirm large deltas in domain tests do not
skip the upgrade boundary.

Run:

```powershell
npm run test:run -- tests/GameProgression.test.ts tests/GameEngine.test.ts tests/HexGrid.test.ts tests/WaveSpawner.test.ts
npm run test:run
npm run typecheck
npm run build
```

- [ ] **Step 6: Record and commit**

Append `Engine cycle, token, upgrade, bonus, and rescue integration verified.`
to `progress.md`.

```powershell
git add src/game/types.ts src/game/GameEngine.ts src/game/HexGrid.ts src/game/WaveSpawner.ts tests/GameProgression.test.ts tests/GameEngine.test.ts tests/WaveSpawner.test.ts progress.md
git commit -m "feat: integrate endless progression"
```

---

### Task 5: Implement anomaly mechanics and anomalous falling blocks

**Files:**
- Modify: `src/game/types.ts`
- Modify: `src/game/CycleDirector.ts`
- Modify: `src/game/GameEngine.ts`
- Create: `tests/Anomalies.test.ts`
- Modify: `tests/CycleDirector.test.ts`
- Modify: `progress.md`

**Interfaces:**
- Consumes: director warning/active anomaly state and semantic rotation commands.
- Produces: deterministic falling-block anomaly metadata and `blockColorShifted`/`rotationDelayed` events.

- [ ] **Step 1: Define block metadata and write failing anomaly tests**

Extend `FallingBlock`:

```ts
export interface FallingBlock extends GridBlock {
  readonly lane: number;
  readonly distance: number;
  readonly speed: number;
  readonly driftToLane?: number;
  readonly driftProgress?: number;
  readonly shiftToColor?: BlockColor;
  readonly shiftAtDistance?: number;
  readonly mirageLane?: number;
  readonly mirageVisible?: boolean;
}
```

Test each rule with a forced anomaly sequence in `CycleDirectorOptions`:

- warning lasts 1000 ms before the mechanic applies;
- reverse changes rotation application but not command semantics;
- mirage metadata never creates a grid block, score, or collision;
- drift progresses only between distance 360 and 200 and lands on its revealed
  destination lane;
- color shift is deterministic at distance 260 and emits one event;
- inertia delays rotation 180 ms, preserves the two-command cap, and freezes on
  pause;
- cycle 6 pairs only compatible anomalies and never reverse plus inertia;
- restart clears every anomalous field and delayed command.

- [ ] **Step 2: Run and verify failures**

Run: `npm run test:run -- tests/Anomalies.test.ts tests/CycleDirector.test.ts`

Expected: FAIL because anomalous metadata and delayed rotations are missing.

- [ ] **Step 3: Implement deterministic anomaly scheduling and compatibility**

Use explicit active durations and compatibility:

```ts
export const ANOMALY_DURATION_MS: Readonly<Record<AnomalyType, number>> = {
  reverse: 9_000,
  mirage: 10_000,
  drift: 12_000,
  colorShift: 10_000,
  inertia: 8_000,
};

const incompatible = (a: AnomalyType, b: AnomalyType): boolean =>
  (a === 'reverse' && b === 'inertia') || (a === 'inertia' && b === 'reverse');
```

Scale each selected anomaly's own duration by the anomaly-shield modifier with
a 4000 ms floor. A pair therefore may expire one member before the other;
`CycleSnapshot.anomalies` and end events must reflect that independently.
Select every outcome at scheduling/spawn time; never draw randomness in Canvas
code.

- [ ] **Step 4: Implement block behavior and delayed rotations**

Decorate newly spawned blocks only while the matching anomaly is active.
Mirage chooses one adjacent lane and hides at distance 180. Drift chooses one
adjacent target, exposes it immediately, and interpolates progress from 0 at
360 to 1 at 200; collision uses the target lane after progress reaches 1.
Color shift exposes its target color at spawn and changes logical color once
when crossing 260. Inertia stores `{ steps, remainingMs: 180 }` and applies it
before block movement when the timer reaches zero.

`REVERSE` multiplies the semantic rotation step by `-1` inside `GameEngine`.
Do not swap `InputController` mappings again.

- [ ] **Step 5: Verify and commit**

Run:

```powershell
npm run test:run -- tests/Anomalies.test.ts tests/CycleDirector.test.ts tests/GameProgression.test.ts
npm run test:run
npm run typecheck
```

Append `Telegraphed reverse, mirage, drift, color-shift, and inertia mechanics verified.` to `progress.md`.

```powershell
git add src/game/types.ts src/game/CycleDirector.ts src/game/GameEngine.ts tests/Anomalies.test.ts tests/CycleDirector.test.ts progress.md
git commit -m "feat: add gameplay anomalies"
```

---

### Task 6: Context-sensitive input, compact HUD, and upgrade selection

**Files:**
- Modify: `src/runtime/InputController.ts`
- Modify: `src/ui/ScreenController.ts`
- Modify: `src/main.ts`
- Modify: `src/styles.css`
- Modify: `tests/InputController.test.ts`
- Modify: `tests/ScreenController.test.ts`
- Create: `tests/ProgressionInput.test.ts`
- Modify: `progress.md`

**Interfaces:**
- Consumes: expanded `GameSnapshot` and new commands.
- Produces: `InputController(host, send, getMode)`, `ScreenController.render(snapshot)`, and upgrade UI actions.

- [ ] **Step 1: Write failing context and screen tests**

Change the input constructor contract:

```ts
new InputController(window, command => engine.enqueue(command), () => engine.getSnapshot().mode)
```

Tests must assert:

- left/right send rotation in playing mode but `selectUpgrade` in upgrade mode;
- Space sends `activateBonus` while playing and `confirmUpgrade` while choosing;
- Enter confirms only in upgrade mode;
- Escape still toggles pause outside fullscreen;
- repeat events remain ignored;
- reverse remains invisible to input mappings.

Refactor ScreenController to `render(snapshot: GameSnapshot)`. Test the playing
HUD contains score, cycle rule, bonus slot only when occupied, upgrade glyphs,
transient anomaly text, and the existing pause control. Test upgrade mode
contains exactly two angular actions with selected state and no settings/store
copy.

- [ ] **Step 2: Run and verify signature/UI failures**

Run: `npm run test:run -- tests/InputController.test.ts tests/ScreenController.test.ts tests/ProgressionInput.test.ts`

Expected: FAIL on the old constructor and `render(mode, score)` API.

- [ ] **Step 3: Implement contextual keyboard and semantic upgrade actions**

Input branches on `getMode()` before sending a command. It never mutates the
engine directly. Extend `ScreenActions`:

```ts
export interface ScreenActions {
  start(): void;
  resume(): void;
  restart(): void;
  returnToMenu(): void;
  togglePause(): void;
  selectUpgrade(index: 0 | 1): void;
  confirmUpgrade(): void;
}
```

Clicking an upgrade sends enough `selectUpgrade` steps to reach its index,
flushes, then confirms and flushes. Keyboard commands remain fixed-step driven.

- [ ] **Step 4: Implement authored HUD and choice layout**

Keep score top-center. Place the thin cycle rule beneath it, the bonus glyph
near the lower-right field boundary, and acquired-upgrade marks along a short
left-side rule. Show anomaly warning/active copy only while present.

Upgrade selection freezes the field under two asymmetric clipped regions. Use
native buttons, one display heading, exact labels/descriptions from
`UpgradeChoice`, visible keyboard focus, and `aria-pressed` for selection. Do
not use rounded cards, glass blur, or a third action.

Reduced motion collapses transition duration to 1 ms. Resize at 1280×720 and
1920×1080 must not cover the hub with HUD text.

- [ ] **Step 5: Wire and verify**

Update `main.ts` so render passes the complete snapshot. Extend session reset
and HMR cleanup without adding global debug actions. `render_game_to_text`
already serializes the expanded snapshot and must remain concise enough for QA.

Run:

```powershell
npm run test:run -- tests/InputController.test.ts tests/ScreenController.test.ts tests/ProgressionInput.test.ts
npm run test:run
npm run typecheck
npm run build
```

- [ ] **Step 6: Browser-check the real upgrade path and commit**

Use the installed `develop-web-game` client to click PLAY, deterministically
alternate short real arrow-key bursts with calls to the existing public
`window.advanceTime(ms)` until the first 55-second production cycle completes,
select each upgrade side by keyboard in separate runs, and inspect HUD/upgrade
screenshots at both desktop sizes. This uses real game rules without adding a
debug configuration, menu, or state-mutation hook.

Append paths and observations to `progress.md`.

```powershell
git add src/runtime/InputController.ts src/ui/ScreenController.ts src/main.ts src/styles.css tests/InputController.test.ts tests/ScreenController.test.ts tests/ProgressionInput.test.ts progress.md
git commit -m "feat: add progression controls and HUD"
```

---

### Task 7: Stronger bounded effects for progression events

**Files:**
- Modify: `src/render/EffectsSystem.ts`
- Create: `tests/ProgressionEffects.test.ts`
- Modify: `tests/EffectsSystem.test.ts`
- Modify: `src/main.ts`
- Modify: `progress.md`

**Interfaces:**
- Consumes: new immutable `GameEvent` values and existing effect context.
- Produces: bounded `shockwaves`, `labels`, `screenFlash`, and `hitStopRemainingMs` in `EffectsSnapshot`.

- [ ] **Step 1: Define effect contracts and failing lifecycle tests**

Add exact visual-only snapshot values:

```ts
export interface Shockwave {
  readonly x: number;
  readonly y: number;
  readonly color: BlockColor | 'ivory';
  readonly ageMs: number;
  readonly lifetimeMs: number;
  readonly intensity: number;
}

export interface EffectLabel {
  readonly text: string;
  readonly tone: 'ink' | 'coral' | 'amber';
  readonly ageMs: number;
  readonly lifetimeMs: number;
}

export interface ScreenFlash {
  readonly tone: 'ink' | 'coral' | 'amber';
  readonly intensity: number;
  readonly remainingMs: number;
}
```

Extend snapshot with frozen arrays, flash, and `hitStopRemainingMs`. Test exact
impact hierarchy:

- landing shake is at least 2 and under normal-clear shake;
- normal clear creates 60 ms hit stop and 4–6 shake;
- chain creates `CHAIN ×N`, ring, stronger shake, and more fragments;
- bonus creates 70–100 ms hit stop and a full-field wave;
- anomaly start creates a label/flash but anomaly end removes its persistent
  cue through renderer state, not an unbounded effect;
- surge completion and last stand use the maximum capped shake/flash;
- particle cap remains 180, shockwave cap is 12, label cap is 6;
- all state expires and reset empties everything;
- reduced-motion mode returns zero hit stop and clamps shake to 0 while labels
  remain.

- [ ] **Step 2: Run and verify failing snapshot assertions**

Run: `npm run test:run -- tests/ProgressionEffects.test.ts tests/EffectsSystem.test.ts`

Expected: FAIL because the new effect channels do not exist.

- [ ] **Step 3: Implement event-to-effect mapping and caps**

Replace the positional constructor with this explicit contract and update every
production/test call site:

```ts
export interface EffectsOptions {
  readonly random?: () => number;
  readonly reducedMotion?: boolean;
}

public constructor(options: EffectsOptions = {}) {
  this.random = options.random ?? Math.random;
  this.reducedMotion = options.reducedMotion ?? false;
}
```

In `main.ts`, construct it with
`{ reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches }`.
Tests that currently use `new EffectsSystem(() => 0.5)` become
`new EffectsSystem({ random: () => 0.5 })`. Keep random geometry deterministic
and clamp individual updates to 50 ms as before.

Use a single `impact` helper that merges stronger concurrent impacts rather
than allowing a weak landing to reduce an active chain shake. `snapshot()`
returns defensive frozen copies.

- [ ] **Step 4: Wire visual time and verify**

`main.ts` continues calling `effects.update(ms)` only when simulation mode is
playing. Upgrade mode freezes visual effects just like pause. Reset clears new
channels. Do not modify engine timing for hit stop.

Run:

```powershell
npm run test:run -- tests/ProgressionEffects.test.ts tests/EffectsSystem.test.ts
npm run test:run
npm run typecheck
```

Append `Stronger bounded progression impacts and reduced-motion behavior verified.` to `progress.md`.

```powershell
git add src/render/EffectsSystem.ts tests/ProgressionEffects.test.ts tests/EffectsSystem.test.ts src/main.ts progress.md
git commit -m "feat: amplify progression effects"
```

---

### Task 8: Render anomaly deception, bonuses, visual hold, and cycle pressure

**Files:**
- Modify: `src/render/CanvasRenderer.ts`
- Create: `tests/ProgressionRenderer.test.ts`
- Modify: `tests/CanvasRenderer.test.ts`
- Modify: `src/game/constants.ts`
- Modify: `progress.md`

**Interfaces:**
- Consumes: expanded `GameSnapshot`, `EffectsSnapshot`, anomaly block metadata, and bonus tokens.
- Produces: renderer-only held presentation state; anomalous trajectories/facets/decoys; cycle, token, shockwave, label, and flash layers.

- [ ] **Step 1: Write failing geometry and presentation tests**

Use the existing Canvas recording surface and assert:

- drift plate centers follow a curved interpolation and end at the target lane;
- mirage draws a lower-alpha broken plate only while `mirageVisible`;
- color-shift preview draws both current and target matte colors before the
  logical boundary;
- a falling bonus is an ivory hex token with a deterministic glyph mark;
- reverse changes guide direction but not stack geometry;
- shockwaves grow, screen flashes cover CSS canvas dimensions, labels are
  drawn outside camera shake, and values remain finite;
- during `hitStopRemainingMs`, renderer presents its previous gameplay snapshot
  while state text remains current, then catches up when the hold expires;
- upgrade/menu/reset discards held and anomalous presentation state;
- renderer never mutates either snapshot.

- [ ] **Step 2: Run and verify failures**

Run: `npm run test:run -- tests/ProgressionRenderer.test.ts tests/CanvasRenderer.test.ts`

Expected: FAIL on missing layers and metadata handling.

- [ ] **Step 3: Implement anomaly and token rendering**

Keep every random decision in the engine. Renderer only interpolates supplied
values. Use matte opacity and broken edges for Mirage, quadratic angle
interpolation plus curved trails for Drift, and a restrained secondary facet
for Color Shift. Bonus tokens use ivory fill, dark inset, and one-letter glyph
`S`, `P`, `C`, or `B` at readable sizes.

Cycle pressure affects only guide speed and subtle frame inset. `SURGE` may
compress the outer guide by at most 4%; it must not rescale collision geometry.

- [ ] **Step 4: Implement visual hit stop and stronger effect layers**

Store one immutable `lastPresentedSnapshot`. When hit stop is positive and both
snapshots are gameplay, draw the stored snapshot; continue drawing current DOM
state and effect overlays. Replace the held snapshot as soon as the timer is
zero. Bound this to one snapshot, and clear it on run reset/mode transition.

Draw world-space shockwaves and fragments before screen-space labels/flash.
Shake affects only the world layer. Use strong but short alpha curves; do not
add blur/glow as a primary device.

- [ ] **Step 5: Verify and run authored browser captures**

Run:

```powershell
npm run test:run -- tests/ProgressionRenderer.test.ts tests/CanvasRenderer.test.ts
npm run test:run
npm run typecheck
npm run build
```

Run the supplied web-game client against deterministic scenarios for landing,
normal clear, chain, each bonus, each anomaly, surge, and last stand. Inspect
screenshots with `view_image`; confirm the grid stays readable, effects are
visibly stronger than the current baseline, all matte colors remain distinct,
and no Canvas content is clipped at 1280×720 or 1920×1080. Check console errors
after every burst.

- [ ] **Step 6: Record and commit**

Append exact screenshot paths, scenario seed/time, and visual observations to
`progress.md`.

```powershell
git add src/render/CanvasRenderer.ts src/game/constants.ts tests/ProgressionRenderer.test.ts tests/CanvasRenderer.test.ts progress.md
git commit -m "feat: render endless run events"
```

---

### Task 9: Full progression playthrough, balancing gate, and documentation

**Files:**
- Modify: `README.md`
- Modify: `SOURCE.md`
- Modify: `progress.md`
- Modify: `scripts/package-source.mjs`
- Modify: `tests/Distribution.test.ts`
- Create: `tests/EndlessRun.test.ts`

**Interfaces:**
- Consumes: the completed engine, input, UI, effects, renderer, browser hooks, and source packager.
- Produces: verified static distribution and documented endless-run controls/mechanics.

- [ ] **Step 1: Add a deterministic three-cycle integration test**

Create one engine with short test cycle options and drive it only through public
commands. The test must complete three cycles, select three upgrades, collect
and replace a bonus, activate it, traverse at least one anomaly, pause during
warning and upgrade, consume Last Stand, and reach game over after the rescue.
Assert identical final snapshots for two equivalent fixed-step frame sequences.

- [ ] **Step 2: Run the complete automated gate**

Run:

```powershell
npm run test:run
npm run typecheck
npm run build
git diff --check
```

Expected: zero failed tests, TypeScript exit 0, Vite/source packaging exit 0,
and clean diff check. Verify `dist/source/` contains every new domain module,
renderer/UI source, tests, and the updated plan/spec.

- [ ] **Step 3: Run the supplied develop-web-game client**

Start `npm run dev -- --host 127.0.0.1`. Use the installed client with short
action bursts and pauses. Exercise normal left/right, Space with empty and full
slot, pause/resume, upgrade navigation/confirmation, and fullscreen resize.
After every burst, compare screenshot state with `render_game_to_text()` and
inspect console/page errors.

- [ ] **Step 4: Run deterministic browser scenarios for all new mechanics**

Use the existing production page and its public `window.advanceTime(ms)` hook.
For exact anomaly/bonus scenes, use seeded runs selected by the domain tests and
advance only through public time/input commands; do not add a QA entry, debug
UI, or state mutation hook. Capture and inspect:

1. landing and normal clear with stronger impact;
2. chain clear with typographic strike;
3. bonus token collection, replacement, and each of four activations;
4. warning and active state for all five anomalies;
5. compatible double anomaly after cycle 6;
6. surge and two-choice upgrade selection by keyboard and mouse;
7. Last Stand rescue followed by later game over;
8. paused warning/anomaly/bonus/upgrade exact state freeze;
9. restart and menu with every progression field reset;
10. settled gameplay at 1280×720 and 1920×1080 plus resize during an effect.

The final console error list must be `[]`. If a screenshot or state differs,
fix the first concrete defect, rerun the affected scenario, then rerun the full
critical path.

- [ ] **Step 5: Perform the balance sanity pass**

Using deterministic time advancement, record profiles at cycles 1, 3, 6, 9,
and 12. Confirm speed and interval are monotonic, modifier floors/caps hold,
late play uses denser patterns after mechanical caps, and no authored pattern
duplicates a lane or schedules below the 160 ms reaction budget. Confirm a run
without upgrades is meaningfully harder than one with upgrades but both
ultimately remain losable.

- [ ] **Step 6: Update documentation and source distribution**

Document cycles, anomaly warnings, Space bonus slot, upgrade controls, run-only
reset, reduced motion, and the lack of permanent progression. Update
`scripts/package-source.mjs` only if its explicit allowlist misses a new file;
extend `Distribution.test.ts` to compare every new source file in `dist/source`.

Append exact test count, commands, browser sizes, screenshot paths, scenario
seeds/times, balance profiles, and any consciously deferred polish to
`progress.md`.

- [ ] **Step 7: Commit**

```powershell
git add README.md SOURCE.md progress.md scripts/package-source.mjs tests/Distribution.test.ts tests/EndlessRun.test.ts
git commit -m "feat: complete endless Hextris progression"
```

---

## Final Verification Gate

- [ ] `npm run test:run` passes with the exact test count recorded.
- [ ] `npm run typecheck` exits 0.
- [ ] `npm run build` exits 0 and `dist/index.html` exists.
- [ ] `dist/` includes GPL materials and matching Corresponding Source for every new file.
- [ ] The supplied web-game client completes real input bursts with no errors.
- [ ] A deterministic three-cycle browser path completes with bonuses, upgrades, anomalies, pause, rescue, and game over.
- [ ] Every anomaly is telegraphed before mechanics change and freezes outside playing mode.
- [ ] Space replaces/activates the single bonus slot correctly and bonus clears do not directly extend combo.
- [ ] Upgrade choices are distinct, capped, persist only for the run, and reset completely.
- [ ] Difficulty profiles rise through late cycles and make survival nearly impossible without violating reaction constraints.
- [ ] Screenshots for important impacts are visibly more expressive while the grid remains readable.
- [ ] Reduced-motion checks retain warnings while removing large shake/holds/parallax.
- [ ] Search final source/UI for prohibited persistent progression, store, currency, login, analytics, audio, neon, glass, purple gradient, and pill styling.
- [ ] Compare every design-spec section with shipped behavior and record any deviation in `progress.md`.
