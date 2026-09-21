# HEXTRIS Premium Arcade Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the existing matte HEXTRIS remake into a lively, readable, endlessly replayable arcade game with a fair deterministic pressure curve, staged motion, clear bonuses, and a strong first 30 seconds.

**Architecture:** Replace the 55-second `CycleDirector` with a deterministic 75-second `ThreatDirector` that owns pacing, budgets, cooldowns, and legal authored situations while `GameEngine` remains the only gameplay authority. Keep all flourish in `PresentationSystem`, `EffectsSystem`, `CanvasRenderer`, and stable semantic DOM owned by `ScreenController`; those layers consume immutable engine events and snapshots but never change outcomes.

**Tech Stack:** TypeScript 5.9, Canvas 2D, semantic HTML/CSS, Vite 7, Vitest 4 with jsdom, existing Playwright/Edge QA harnesses; no new runtime dependency.

**Spec:** `docs/superpowers/specs/2026-09-21-hextris-premium-arcade-redesign.md`

## Global Constraints

- Preserve the six-sided matching rule, deterministic seeded engine, one-slot active bonuses, run-only upgrades, and disruptive anomalies.
- Use 75-second cycles: Settle 20 s, Build 35 s, Pressure 15 s, Release 5 s.
- Opening targets: 150 world units/second and 2.4–2.7 seconds between authored arrivals.
- Two-minute targets: 250–300 units/second and 1.3–1.6 seconds between authored arrivals.
- Five-to-seven-minute targets: 420–500 units/second and 0.7–0.9 seconds between authored arrivals.
- Late soft ceilings: at most 600 units/second and at least 0.5 seconds between authored arrivals.
- No dangerous anomaly before 90 active seconds; single warnings last at least 2.5 seconds; double anomalies start only after six active minutes and use a longer warning.
- Schedule bonuses deterministically every 35–50 active seconds and defer them out of incompatible pressure moments.
- Offer two run-only upgrades after every third completed cycle; never add permanent progression, currency, shop, unlock track, account, or analytics.
- Collection uses an 80–100 ms visual hold, one origin ring, a 0.8-second glyph flight, and 1.6–1.8 seconds of acquisition copy; activation copy lasts at least 0.9 seconds.
- The 1.2-second opening runs inside `playing`; rotation and pause work immediately, and both fixed-step runtime and `window.advanceTime(ms)` advance it.
- Keep the existing matte graphite palette; no neon glow, glass panels, bloom-heavy rendering, continuous shake, or particle saturation.
- Canvas remains dependency-free Canvas 2D plus CSS UI; do not migrate to WebGL or add a rendering framework.
- No audio, music, mobile-specific controls, new game mode, or change to the fundamental matching rule in this pass.
- `prefers-reduced-motion` must preserve names, warnings, destinations, bonus meaning, and controls while replacing travel, stretch, strong shake, and long holds with short local fades.
- Update `progress.md` after every completed task and preserve GPL/source-package coverage in `scripts/package-source.mjs` and distribution tests.

## Review Focus

- A large `deltaMs` crossing multiple phase and cycle boundaries must auto-advance non-upgrade cycles, stop exactly at the third-cycle upgrade boundary, and report only consumed active time; pinned in Task 1.
- Pause, upgrade mode, and session reset must freeze or clear opening, warning, bonus-transfer, hit-stop, and first-seen timers without a one-frame stale presentation; pinned in Tasks 4 and 8.
- Late-run upgrade modifiers must not push actual spawn speed above 600 or authored arrival cadence below 500 ms; pinned in Task 3.
- Forced/test situations and ordinary seeded selection must both obey budget, cooldown, compatibility, warning, and no-repeat rules; pinned in Task 2.
- Restarting with the same seed after partial opening or bonus transfer must reproduce preview lanes, director output, and event order while clearing all visual state; pinned in Task 8.

---

## File Map

- `src/game/progressionTypes.ts`: phase, threat-plan, opening-preview, event, and snapshot contracts shared by game and presentation.
- `src/game/constants.ts`: exact phase durations, opening timing, balance ceilings, warning floors, and visual caps.
- `src/game/ThreatDirector.ts`: deterministic cycle clock, difficulty curves, threat budget, cooldowns, legal situation selection, bonus clock, and third-cycle upgrade boundary.
- `src/game/WaveSpawner.ts`: authored pattern construction, cached opening wave, exact lane preview, and interval scheduling.
- `src/game/GameEngine.ts`: integrates director/spawner/bonus/upgrade output and remains authoritative for gameplay.
- `src/presentation/bonusPresentation.ts`: Russian bonus names, persistent descriptions, activation copy, glyphs, and tones.
- `src/presentation/PresentationSystem.ts`: opening choreography, notice queue, first-seen anomaly explanations, collection/transfer/replacement timing.
- `src/render/EffectsSystem.ts`: bounded anticipation, landing, fracture, collection, activation, warning, and recovery channels.
- `src/render/CanvasRenderer.ts`: explicit six-layer Canvas composition and phase/opening/anomaly rendering.
- `src/ui/ScreenController.ts` and `src/styles.css`: stable semantic HUD, attached danger/warning cues, bonus slot, notices, and reduced-motion CSS.
- `src/runtime/GameRuntime.ts` and `src/main.ts`: fixed-step composition, reset ordering, public QA state, and pause-safe visual clocks.
- `tests/*.test.ts`: deterministic model, presentation, renderer, UI, runtime, integration, and distribution contracts.
- `test-artifacts/run-premium-arcade-qa.mjs`: reproducible browser capture and console-check script for the approved scenarios.

### Task 1: Replace the cycle clock with the 75-second ThreatDirector

**Files:**
- Rename: `src/game/CycleDirector.ts` → `src/game/ThreatDirector.ts`
- Rename: `tests/CycleDirector.test.ts` → `tests/ThreatDirector.test.ts`
- Modify: `src/game/progressionTypes.ts`
- Modify: `src/game/constants.ts`
- Modify: `src/game/GameEngine.ts`
- Modify: `tests/GameProgression.test.ts`

**Interfaces:**
- Produces: `GamePhase = 'settle' | 'build' | 'pressure' | 'release'`.
- Produces: `ThreatDirector.update(deltaMs, modifiers): DirectorTick`, `getWaveProfile(): WaveProfile`, `getNextEventMs(modifiers): number`, `beginNextCycle(): void`, `reset(): void`.
- Produces: `CycleSnapshot.durationMs: 75_000` and `CycleSnapshot.totalActiveMs: number`.
- Preserves: `GameEngineOptions.cycle`, renamed to `director?: ThreatDirectorOptions`; retain `cycle` as a deprecated read-only alias for one migration task only, then remove it in Task 3.

- [ ] **Step 1: Write failing phase, curve, and large-delta tests**

```ts
it('uses exact 20/35/15/5 second phases and pauses only after cycle three', () => {
  const director = new ThreatDirector(new SeededRandom(17));
  expect(director.getSnapshot()).toMatchObject({ number: 1, phase: 'settle', durationMs: 75_000 });
  expect(director.update(20_000, NO_MODIFIERS).events).toContainEqual(
    { type: 'phaseChanged', phase: 'build', cycle: 1 },
  );
  expect(director.update(35_000, NO_MODIFIERS).events).toContainEqual(
    { type: 'phaseChanged', phase: 'pressure', cycle: 1 },
  );
  expect(director.update(15_000, NO_MODIFIERS).events).toContainEqual(
    { type: 'phaseChanged', phase: 'release', cycle: 1 },
  );
  const finish = director.update(5_000, NO_MODIFIERS);
  expect(finish.upgradeDue).toBe(false);
  expect(director.getSnapshot()).toMatchObject({ number: 2, phase: 'settle', elapsedMs: 0 });
});

it('crosses two cycles but consumes only through the third-cycle upgrade boundary', () => {
  const director = new ThreatDirector(new SeededRandom(17));
  const tick = director.update(999_000, NO_MODIFIERS);
  expect(tick.consumedMs).toBe(225_000);
  expect(tick.upgradeDue).toBe(true);
  expect(director.getSnapshot()).toMatchObject({ number: 3, phase: 'release', elapsedMs: 75_000 });
  expect(director.update(1_000, NO_MODIFIERS).consumedMs).toBe(0);
});

it.each([
  [0, 150, 2600],
  [120_000, 298.4, 1578.5],
  [300_000, 434.5, 896.5],
  [420_000, 489.0, 703.6],
  [3_600_000, 600, 500],
])('matches the endless profile at %i ms', (activeMs, speed, intervalMs) => {
  const profile = profileAt(activeMs);
  expect(profile.speed).toBeCloseTo(speed, 1);
  expect(profile.intervalMs).toBeCloseTo(intervalMs, 1);
});
```

- [ ] **Step 2: Run the focused tests and confirm the old 55-second vocabulary fails**

Run: `npm.cmd run test:run -- tests/ThreatDirector.test.ts tests/GameProgression.test.ts`

Expected: FAIL because `ThreatDirector` and the four new phase names do not exist and the old director stops after every 55-second cycle.

- [ ] **Step 3: Add exact constants and shared types**

```ts
export const OPENING_DURATION_MS = 1_200;
export const CYCLE_DURATION_MS = 75_000;
export const SETTLE_END_MS = 20_000;
export const BUILD_END_MS = 55_000;
export const PRESSURE_END_MS = 70_000;
export const SINGLE_ANOMALY_WARNING_MS = 2_500;
export const DOUBLE_ANOMALY_WARNING_MS = 3_200;
export const MAX_FALL_SPEED = 600;
export const MIN_WAVE_INTERVAL_MS = 500;

export type GamePhase = 'settle' | 'build' | 'pressure' | 'release';

export interface CycleSnapshot {
  readonly number: number;
  readonly phase: GamePhase;
  readonly elapsedMs: number;
  readonly totalActiveMs: number;
  readonly durationMs: 75_000;
  readonly progress: number;
  readonly warning: readonly AnomalyType[];
  readonly warningRemainingMs: number;
  readonly anomalies: readonly ActiveAnomaly[];
  readonly threat: ThreatPlan | null;
}
```

- [ ] **Step 4: Rename and implement the deterministic clock and soft curves**

```ts
const phaseAt = (elapsedMs: number): GamePhase => {
  if (elapsedMs < SETTLE_END_MS) return 'settle';
  if (elapsedMs < BUILD_END_MS) return 'build';
  if (elapsedMs < PRESSURE_END_MS) return 'pressure';
  return 'release';
};

const baseSpeedAt = (activeMs: number): number => {
  const seconds = activeMs / 1000;
  return Math.min(MAX_FALL_SPEED, 150 + 450 * (1 - Math.exp(-seconds / 300)));
};

const baseIntervalAt = (activeMs: number): number => {
  const seconds = activeMs / 1000;
  return Math.max(MIN_WAVE_INTERVAL_MS, 500 + 2100 * Math.exp(-seconds / 180));
};

const PHASE_INTERVAL_MULTIPLIER: Readonly<Record<GamePhase, number>> = {
  settle: 1,
  build: 1,
  pressure: 0.9,
  release: 1.8,
};

public getWaveProfile(): WaveProfile {
  const intervalMs = Math.max(
    MIN_WAVE_INTERVAL_MS,
    baseIntervalAt(this.totalActiveMs) * PHASE_INTERVAL_MULTIPLIER[this.phase],
  );
  return Object.freeze({
    intervalMs,
    speed: baseSpeedAt(this.totalActiveMs),
    patternWeights: this.patternWeights(),
    forcedPattern: this.currentThreat?.pattern ?? null,
    forcedPatternSequence: null,
  });
}
```

The test helper advances through upgrade boundaries without changing active-time accounting:

```ts
function profileAt(activeMs: number): WaveProfile {
  const director = new ThreatDirector(new SeededRandom(1));
  let remainingMs = activeMs;
  while (remainingMs > 0) {
    const tick = director.update(remainingMs, NO_MODIFIERS);
    remainingMs -= tick.consumedMs;
    if (tick.upgradeDue) director.beginNextCycle();
  }
  return director.getWaveProfile();
}
```

At a cycle end, emit `cycleCompleted`. If `cycleNumber % 3 !== 0`, increment the cycle and continue consuming the same `deltaMs`. If it is divisible by three, set `awaitingUpgrade = true` and return without consuming post-boundary time.

- [ ] **Step 5: Update GameEngine imports and third-cycle flow**

```ts
import { ThreatDirector, type ThreatDirectorOptions } from './ThreatDirector';

export interface GameEngineOptions {
  readonly randomSeed?: number;
  readonly maxStackDepth?: number;
  readonly spawning?: boolean;
  readonly director?: ThreatDirectorOptions;
}

private director: ThreatDirector;
```

Make `enterUpgrade` reachable only when `DirectorTick.upgradeDue` is true. `confirmUpgrade` calls `beginNextCycle()` exactly once and resumes into cycle 4, 7, 10, and so on.

- [ ] **Step 6: Run focused tests, typecheck, and commit**

Run: `npm.cmd run test:run -- tests/ThreatDirector.test.ts tests/GameProgression.test.ts tests/EndlessRun.test.ts`

Expected: PASS with exact boundaries and caps.

Run: `npm.cmd run typecheck`

Expected: exit 0.

```bash
git add src/game/constants.ts src/game/progressionTypes.ts src/game/ThreatDirector.ts src/game/GameEngine.ts tests/ThreatDirector.test.ts tests/GameProgression.test.ts tests/EndlessRun.test.ts progress.md
git rm src/game/CycleDirector.ts tests/CycleDirector.test.ts
git commit -m "feat: add 75 second threat director rhythm"
```

### Task 2: Add deterministic threat budgets and fairness gates

**Files:**
- Modify: `src/game/progressionTypes.ts`
- Modify: `src/game/ThreatDirector.ts`
- Modify: `tests/ThreatDirector.test.ts`
- Modify: `tests/Anomalies.test.ts`

**Interfaces:**
- Consumes: Task 1 `ThreatDirector` clock and four phases.
- Produces: immutable `ThreatPlan`, `ThreatEvidence`, and `situationPrepared` events.
- Produces: `ThreatDirectorOptions.forcedSituationsByCycle?: Readonly<Record<number, ThreatRequest>>` for deterministic tests only.

- [ ] **Step 1: Define costed plans and write failing fairness tests**

```ts
export interface ThreatEvidence {
  readonly seedCycle: number;
  readonly phase: GamePhase;
  readonly budget: number;
  readonly spent: number;
  readonly combinationKey: string;
}

export interface ThreatPlan {
  readonly pattern: WavePattern;
  readonly anchorLane: number;
  readonly lanes: readonly number[];
  readonly anomalies: readonly AnomalyType[];
  readonly warningMs: number;
  readonly entryDelayMs: number;
  readonly bonusIncompatible: boolean;
  readonly evidence: ThreatEvidence;
}

export interface ThreatRequest {
  readonly pattern: WavePattern;
  readonly anchorLane?: number;
  readonly anomalies: readonly AnomalyType[];
}
```

```ts
it('never starts an anomaly before 90 active seconds and warns for at least 2500 ms', () => {
  const director = new ThreatDirector(new SeededRandom(3));
  expect(collectEvents(director, 89_999)).not.toContainEqual(
    expect.objectContaining({ type: 'anomalyStarted' }),
  );
  const events = collectEvents(director, 10_000);
  const warning = events.find((event) => event.type === 'anomalyWarning');
  const started = events.find((event) => event.type === 'anomalyStarted');
  if (warning && started) expect(started.atActiveMs - warning.atActiveMs).toBeGreaterThanOrEqual(2_500);
});

it('rejects a forced plan that exceeds budget or combines reverse with inertia', () => {
  expect(() => new ThreatDirector(new SeededRandom(1), {
    forcedSituationsByCycle: { 2: { pattern: 'circle', anomalies: ['reverse', 'inertia'] } },
  })).toThrow(RangeError);
});

it('does not repeat a high-pressure combination in consecutive cycles', () => {
  const plans = collectPlans(new ThreatDirector(new SeededRandom(11)), 900_000)
    .filter(({ evidence }) => evidence.phase === 'pressure');
  for (let index = 1; index < plans.length; index += 1) {
    expect(plans[index]!.evidence.combinationKey).not.toBe(plans[index - 1]!.evidence.combinationKey);
  }
});

it('does not select a double anomaly before six active minutes', () => {
  const plans = collectPlans(new ThreatDirector(new SeededRandom(9)), 480_000);
  expect(plans.filter((plan) => plan.evidence.seedCycle * 75_000 < 360_000)
    .every((plan) => plan.anomalies.length <= 1)).toBe(true);
  expect(plans.filter((plan) => plan.anomalies.length === 2)
    .every((plan) => plan.warningMs >= 3_200 && !['circle', 'spiral'].includes(plan.pattern))).toBe(true);
});
```

Add these exact test helpers above the suite; director events carry `atActiveMs` so warning distance is asserted without guessing update chunk boundaries:

```ts
function collectEvents(director: ThreatDirector, durationMs: number): DirectorEvent[] {
  const events: DirectorEvent[] = [];
  let remainingMs = durationMs;
  while (remainingMs > 0) {
    const tick = director.update(remainingMs, NO_MODIFIERS);
    events.push(...tick.events);
    remainingMs -= tick.consumedMs;
    if (tick.upgradeDue) director.beginNextCycle();
    if (tick.consumedMs === 0 && !tick.upgradeDue) break;
  }
  return events;
}

const collectPlans = (director: ThreatDirector, durationMs: number): ThreatPlan[] =>
  collectEvents(director, durationMs)
    .filter((event): event is Extract<DirectorEvent, { type: 'situationPrepared' }> =>
      event.type === 'situationPrepared')
    .map(({ plan }) => plan);
```

- [ ] **Step 2: Run the director tests and confirm the missing contracts fail**

Run: `npm.cmd run test:run -- tests/ThreatDirector.test.ts tests/Anomalies.test.ts`

Expected: FAIL on missing `ThreatPlan`, early warnings, repeated combinations, and old cycle-based double anomalies.

- [ ] **Step 3: Implement exact costs, budgets, compatibility, and cooldowns**

```ts
const PATTERN_COST: Readonly<Record<WavePattern, number>> = {
  single: 1, pair: 2, opposite: 2, halfCircle: 3, spiral: 4, circle: 5,
};
const ANOMALY_COST: Readonly<Record<AnomalyType, number>> = {
  mirage: 2, drift: 2, colorShift: 2, reverse: 3, inertia: 3,
};
const PHASE_BUDGET: Readonly<Record<GamePhase, number>> = {
  settle: 3, build: 6, pressure: 9, release: 0,
};
const WEAK_ANOMALIES = new Set<AnomalyType>(['mirage', 'drift', 'colorShift']);

const planCost = (pattern: WavePattern, anomalies: readonly AnomalyType[]): number =>
  PATTERN_COST[pattern]
  + anomalies.reduce((sum, anomaly) => sum + ANOMALY_COST[anomaly], 0)
  + (anomalies.length === 2 ? 2 : 0);

private isLegal(request: ThreatRequest, phase: GamePhase): boolean {
  const anomalies = request.anomalies;
  if (phase === 'release') return anomalies.length === 0 && request.pattern === 'single';
  if (this.totalActiveMs < 90_000 && anomalies.length > 0) return false;
  if (this.totalActiveMs < 360_000 && anomalies.length > 1) return false;
  if (anomalies.includes('reverse') && anomalies.includes('inertia')) return false;
  if (anomalies.length === 2 && ['circle', 'spiral'].includes(request.pattern)) return false;
  if (anomalies.some((value) => this.anomalyCooldowns.get(value) === this.cycleNumber - 1)) return false;
  const lateBand = Math.min(3, Math.floor(this.totalActiveMs / 180_000));
  return planCost(request.pattern, anomalies) <= PHASE_BUDGET[phase] + lateBand;
}
```

Select only from a stable ordered candidate list and use the seeded random source to choose among legal candidates. A pattern cost of 4+ with `reverse` or `inertia` receives `entryDelayMs: 450`; a double threat receives `warningMs: 3_200`; all other anomaly plans receive `warningMs: 2_500`. Store the last pressure `combinationKey` and exclude it next cycle. Store each selected anomaly's cycle in `anomalyCooldowns`.

Prepare one cycle plan when Settle starts, emit `situationPrepared` at the 20-second Build boundary, start its warning at cycle elapsed 42 seconds, and start the anomaly after its exact warning duration. Cycle 1 uses no anomaly, so the first possible start is cycle 2 at 119.5 active seconds. Pressure uses the planned pattern; Release forces `single`, clears `currentThreat`, and schedules no warning or complication. Settle weights only `single`, `pair`, and `opposite`; Build adds `halfCircle` and `spiral`; Pressure may use every legal pattern subject to budget.

- [ ] **Step 4: Emit self-explaining immutable events**

```ts
export type DirectorEvent =
  | { readonly type: 'phaseChanged'; readonly phase: GamePhase; readonly cycle: number; readonly atActiveMs: number }
  | { readonly type: 'situationPrepared'; readonly plan: ThreatPlan; readonly atActiveMs: number }
  | { readonly type: 'anomalyWarning'; readonly anomalies: readonly AnomalyType[]; readonly lanes: readonly number[]; readonly warningMs: number; readonly atActiveMs: number }
  | { readonly type: 'anomalyStarted'; readonly anomalies: readonly AnomalyType[]; readonly lanes: readonly number[]; readonly atActiveMs: number }
  | { readonly type: 'anomalyEnded'; readonly anomalies: readonly AnomalyType[]; readonly atActiveMs: number }
  | { readonly type: 'cycleCompleted'; readonly cycle: number; readonly atActiveMs: number };
```

Derive `anchorLane` from the director RNG and `lanes` from the pattern offsets before calculating cost. Reject any authored plan that places more than two zero-delay requests on the same lane. Deep-freeze `plan`, `lanes`, `anomalies`, and `evidence` in both event output and `CycleSnapshot`. The snapshot and event may share values but neither may expose mutable arrays.

- [ ] **Step 5: Run focused tests and commit**

Run: `npm.cmd run test:run -- tests/ThreatDirector.test.ts tests/Anomalies.test.ts`

Expected: PASS, including forced invalid inputs and seeded no-repeat runs.

```bash
git add src/game/progressionTypes.ts src/game/ThreatDirector.ts tests/ThreatDirector.test.ts tests/Anomalies.test.ts progress.md
git commit -m "feat: enforce deterministic threat budgets"
```

### Task 3: Prime the opening wave and integrate capped spawning, bonuses, and upgrades

**Files:**
- Modify: `src/game/WaveSpawner.ts`
- Modify: `src/game/GameEngine.ts`
- Modify: `src/game/progressionTypes.ts`
- Modify: `src/game/types.ts`
- Modify: `src/game/UpgradeSystem.ts`
- Modify: `tests/WaveSpawner.test.ts`
- Modify: `tests/GameProgression.test.ts`
- Modify: `tests/EndlessRun.test.ts`

**Interfaces:**
- Consumes: `ThreatDirector.getWaveProfile()` and `ThreatPlan` from Tasks 1–2.
- Produces: `WaveSpawner.prime(profile, delayMs): readonly number[]`, `getPreviewLanes(): readonly number[]`.
- Produces: `GameSnapshot.opening: { readonly remainingMs: number; readonly previewLanes: readonly number[] }`.
- Produces: `WaveProfile.forcedAnchorLane: number | null` and `entryDelayMs: number`, sourced from the selected `ThreatPlan` so preview lines, warnings, and delayed complex entries describe the real situation.
- Produces: `WaveProfile.authoredWaveId: string | null`; the spawner consumes a costed forced wave once rather than repeating it for an entire phase.
- Produces: `clampWaveProfile(profile, speedMultiplier): WaveProfile`.
- Guarantees: actual spawn speed is at most 600 and authored arrival cadence is at least 500 ms after modifiers.

- [ ] **Step 1: Write failing opening, bonus-window, modifier-cap, and replay tests**

```ts
it('previews the exact cached first wave and releases it after 1200 ms', () => {
  const spawner = new WaveSpawner(new SeededRandom(7));
  const lanes = spawner.prime(profile({
    forcedPattern: 'halfCircle', forcedAnchorLane: 0, entryDelayMs: 0,
  }), 1_200);
  expect(lanes).toEqual([0, 1, 2]);
  expect(spawner.update(1_199, profile())).toEqual([]);
  expect(spawner.update(1, profile()).map(({ lane }) => lane)).toEqual(lanes);
});

it('spends one authored threat wave once, then returns to weighted patterns', () => {
  const spawner = new WaveSpawner({ next: () => 0 });
  const authored = profile({
    intervalMs: 100, forcedPattern: 'circle', forcedAnchorLane: 0,
    authoredWaveId: '2:pressure:circle:0', entryDelayMs: 0,
    patternWeights: { single: 1, pair: 0, opposite: 0, halfCircle: 0, circle: 0, spiral: 0 },
  });
  expect(spawner.update(100, authored)).toHaveLength(6);
  expect(spawner.update(100, authored)).toHaveLength(1);
});

it('keeps upgraded late spawning inside both practical ceilings', () => {
  const result = clampWaveProfile(profile({ speed: 590, intervalMs: 410 }), 1.4);
  expect(result.speed).toBe(600);
  expect(result.intervalMs).toBe(500);
});

it('schedules each bonus 35-50 active seconds apart and never inside pressure or warning', () => {
  const trace = traceDirector(new ThreatDirector(new SeededRandom(21)), 420_000);
  expect(trace.bonusGaps.every((gap) => gap >= 35_000 && gap <= 50_000)).toBe(true);
  expect(trace.bonusMoments.every(({ phase, warning }) =>
    !['pressure', 'release'].includes(phase) && warning.length === 0)).toBe(true);
});

it('offers upgrades only after cycles three and six', () => {
  const offers = traceDirector(new ThreatDirector(new SeededRandom(8)), 500_000).upgradeCycles;
  expect(offers.slice(0, 2)).toEqual([3, 6]);
});
```

Update every `WaveProfile` test factory with these neutral defaults: `forcedAnchorLane: null`, `authoredWaveId: null`, and `entryDelayMs: 0`. This keeps ordinary weighted-wave tests unchanged.

`traceDirector` advances to each `getNextEventMs`, records `totalActiveMs` whenever `bonusDue` or `upgradeDue` is returned, captures that moment's immutable snapshot, and calls `beginNextCycle` after upgrade boundaries. It computes `bonusGaps` from consecutive absolute bonus times.

- [ ] **Step 2: Run the focused tests and verify red**

Run: `npm.cmd run test:run -- tests/WaveSpawner.test.ts tests/GameProgression.test.ts tests/EndlessRun.test.ts`

Expected: FAIL because the first wave is not cached, bonuses use 28–42 seconds with a 16-second floor, and speed modifiers can bypass the new caps.

- [ ] **Step 3: Cache a seeded opening wave without consuming the seed twice**

```ts
interface ScheduledWave {
  readonly requests: readonly SpawnRequest[];
  remainingMs: number;
}

public prime(profile: WaveProfile, delayMs: number): readonly number[] {
  if (this.scheduled !== null || this.pending.length > 0) throw new Error('WaveSpawner is already primed');
  const requests = Object.freeze(this.buildWave(profile));
  this.scheduled = { requests, remainingMs: delayMs };
  this.untilNextWaveMs = profile.intervalMs;
  return Object.freeze(requests.map(({ lane }) => lane));
}

public getPreviewLanes(): readonly number[] {
  return Object.freeze(this.scheduled?.requests.map(({ lane }) => lane) ?? []);
}
```

`buildWave` uses `profile.forcedAnchorLane ?? Math.floor(random.next() * SIDE_COUNT)` and adds `profile.entryDelayMs` to every request's existing per-pattern delay. Track `consumedAuthoredWaveIds: Set<string>`; use the forced pattern/anchor only when a non-null ID has not been consumed, add it immediately, and use weighted selection afterward. Clear the set on spawner reconstruction. `update` decrements `scheduled.remainingMs` before normal interval scheduling, releases each cached request once, and preserves per-pattern internal delays. Equal total elapsed time split into different chunks must produce the same requests and ordering.

- [ ] **Step 4: Prime and expose the opening from GameEngine**

```ts
private openingRemainingMs = OPENING_DURATION_MS;
private openingPreviewLanes: readonly number[] = [];

private resetState(): void {
  this.spawner = new WaveSpawner(new SeededRandom(this.randomSeed));
  this.director = new ThreatDirector(
    new SeededRandom(this.randomSeed ^ 0x4359434c),
    this.directorOptions,
  );
  this.openingRemainingMs = OPENING_DURATION_MS;
  this.openingPreviewLanes = this.spawner.prime(this.director.getWaveProfile(), OPENING_DURATION_MS);
}
```

Decrease `openingRemainingMs` only by consumed active time while `mode === 'playing'`. Include a frozen `opening` object in `GameSnapshot`. Rotation and pause continue through the ordinary command queue during this period.

- [ ] **Step 5: Clamp final profiles and replace the bonus scheduler**

```ts
export const clampWaveProfile = (profile: WaveProfile, speedMultiplier: number): WaveProfile =>
  Object.freeze({
    ...profile,
    speed: Math.min(MAX_FALL_SPEED, profile.speed * speedMultiplier),
    intervalMs: Math.max(MIN_WAVE_INTERVAL_MS, profile.intervalMs),
  });

private scheduleNextBonus(modifiers: DirectorModifiers): void {
  const minAt = this.lastBonusAtMs + 35_000;
  const maxAt = this.lastBonusAtMs + 50_000;
  const sampled = Math.min(maxAt, Math.max(
    minAt,
    this.lastBonusAtMs + (35_000 + Math.floor(this.random.next() * 15_001))
      * modifiers.bonusIntervalMultiplier,
  ));
  const legalForward = this.findLegalBonusTime(sampled, maxAt, 250);
  this.nextBonusAtMs = legalForward ?? this.findLegalBonusTime(maxAt, minAt, -250);
  if (this.nextBonusAtMs === null) throw new Error('No legal bonus slot in the 35-50 second window');
}

private findLegalBonusTime(fromMs: number, toMs: number, stepMs: 250 | -250): number | null {
  for (
    let candidateMs = fromMs;
    stepMs > 0 ? candidateMs <= toMs : candidateMs >= toMs;
    candidateMs += stepMs
  ) {
    const elapsedMs = candidateMs % CYCLE_DURATION_MS;
    const phase = elapsedMs < SETTLE_END_MS ? 'settle'
      : elapsedMs < BUILD_END_MS ? 'build'
        : elapsedMs < PRESSURE_END_MS ? 'pressure' : 'release';
    const insideWarning = this.plannedWarningIntervals.some(({ startMs, endMs }) =>
      candidateMs >= startMs && candidateMs < endMs);
    const incompatible = this.plannedThreats.some(({ startMs, endMs, plan }) =>
      plan.bonusIncompatible && candidateMs >= startMs && candidateMs < endMs);
    if ((phase === 'settle' || phase === 'build') && !insideWarning && !incompatible) return candidateMs;
  }
  return null;
}
```

`findLegalBonusTime` maps an absolute active time to its cycle phase and known warning interval. It accepts only Settle/Build with no warning, searches forward first in 250 ms steps, then backward, and therefore never leaves the inclusive 35–50 second window. An active anomaly suppresses a bonus only when its `ThreatPlan` is marked `bonusIncompatible`. Remove the Task 1 compatibility alias `GameEngineOptions.cycle` and update all tests to `director`.

`ThreatDirector` stores the schedules used by that method as `plannedWarningIntervals: { startMs: number; endMs: number }[]` and `plannedThreats: { startMs: number; endMs: number; plan: ThreatPlan }[]`; Task 2 appends to them when a situation is prepared and removes entries whose `endMs < totalActiveMs - 50_000`. A double anomaly and any Pressure-phase plan set `bonusIncompatible: true`; other plans set it to `false`.

- [ ] **Step 6: Run integration tests and commit**

Run: `npm.cmd run test:run -- tests/WaveSpawner.test.ts tests/GameProgression.test.ts tests/EndlessRun.test.ts tests/UpgradeSystem.test.ts`

Expected: PASS with identical event traces across chunk sizes.

```bash
git add src/game/WaveSpawner.ts src/game/GameEngine.ts src/game/progressionTypes.ts src/game/types.ts src/game/UpgradeSystem.ts tests/WaveSpawner.test.ts tests/GameProgression.test.ts tests/EndlessRun.test.ts tests/UpgradeSystem.test.ts progress.md
git commit -m "feat: integrate fair endless spawn pacing"
```

### Task 4: Rebuild opening, bonus, and anomaly presentation timelines

**Files:**
- Modify: `src/presentation/PresentationSystem.ts`
- Modify: `src/presentation/bonusPresentation.ts`
- Modify: `tests/PresentationSystem.test.ts`
- Modify: `tests/BonusPresentation.test.ts`

**Interfaces:**
- Consumes: `GameMode`, opening preview lanes, `anomalyWarning`, `anomalyStarted`, and bonus events.
- Produces: `beginRun(previewLanes: readonly number[]): void`.
- Produces: `update(deltaMs: number, mode: GameMode): void`.
- Produces: `PresentationSnapshot.opening`, `transfer`, `slotAttentionRemainingMs`, `replacedBonus`, and notices.

- [ ] **Step 1: Write failing exact-timeline tests**

```ts
it('runs a 1200 ms opening only while playing', () => {
  const system = new PresentationSystem();
  system.beginRun([1, 2]);
  expect(system.snapshot().opening).toMatchObject({ stage: 'assemble', ageMs: 0, previewLanes: [1, 2] });
  system.update(320, 'playing');
  expect(system.snapshot().opening?.stage).toBe('guides');
  system.update(500, 'paused');
  expect(system.snapshot().opening?.ageMs).toBe(320);
  system.update(880, 'playing');
  expect(system.snapshot().opening).toBeNull();
});

it('holds collection for 90 ms, flies for 800 ms, and explains it for 1700 ms', () => {
  const system = new PresentationSystem();
  system.consume([collected]);
  expect(system.snapshot().transfer).toMatchObject({ delayMs: 90, lifetimeMs: 800, ageMs: 0 });
  expect(system.snapshot().notice).toMatchObject({ title: 'БОНУС: ИМПУЛЬС', lifetimeMs: 1700 });
  system.update(889, 'playing');
  expect(system.snapshot().transfer).not.toBeNull();
  system.update(1, 'playing');
  expect(system.snapshot().transfer).toBeNull();
});

it('explains each anomaly for 1800 ms only on its first appearance in the run', () => {
  const system = new PresentationSystem();
  system.consume([{ type: 'anomalyStarted', anomalies: ['reverse'], lanes: [0], atActiveMs: 95_000 }]);
  expect(system.snapshot().notice).toMatchObject({ title: 'РЕВЕРС', lifetimeMs: 1800 });
  system.update(1800, 'playing');
  system.consume([{ type: 'anomalyStarted', anomalies: ['reverse'], lanes: [0], atActiveMs: 170_000 }]);
  expect(system.snapshot().notice?.body ?? '').toBe('');
});

it('keeps activation copy visible for at least 900 ms', () => {
  const system = new PresentationSystem();
  system.consume([{ type: 'bonusActivated', bonus: 'cleanse' }]);
  expect(system.snapshot().notice).toMatchObject({ lifetimeMs: 900 });
});

it('announces Pressure once but lets Release stay visually quiet', () => {
  const system = new PresentationSystem();
  system.consume([{ type: 'phaseChanged', phase: 'pressure', cycle: 2, atActiveMs: 130_000 }]);
  expect(system.snapshot().notice?.title).toBe('ДАВЛЕНИЕ');
  system.consume([{ type: 'phaseChanged', phase: 'release', cycle: 2, atActiveMs: 145_000 }]);
  expect(system.snapshot().queuedNotices.some(({ title }) => title === 'ПЕРЕДЫШКА')).toBe(false);
});

it('falls back to a readable static cue for invalid runtime metadata', () => {
  expect(getBonusPresentation('unknown-at-runtime')).toMatchObject({
    label: 'БОНУС', description: 'ПРОБЕЛ — ИСПОЛЬЗОВАТЬ', glyph: '◇', tone: 'ivory',
  });
});
```

- [ ] **Step 2: Run presentation tests and verify red**

Run: `npm.cmd run test:run -- tests/PresentationSystem.test.ts tests/BonusPresentation.test.ts`

Expected: FAIL on missing opening, absent transfer, 1400 ms collection, and 620 ms activation.

- [ ] **Step 3: Add exact opening and transfer snapshots**

```ts
export type OpeningStage = 'assemble' | 'guides' | 'ready';

export interface OpeningPresentation {
  readonly stage: OpeningStage;
  readonly ageMs: number;
  readonly lifetimeMs: 1200;
  readonly previewLanes: readonly number[];
}

export interface BonusTransfer {
  readonly bonus: BonusType;
  readonly lane: number;
  readonly distance: number;
  readonly ageMs: number;
  readonly delayMs: 90;
  readonly lifetimeMs: 800;
}

const openingStageAt = (ageMs: number): OpeningStage =>
  ageMs < 320 ? 'assemble' : ageMs < 760 ? 'guides' : 'ready';
```

`beginRun` resets the first-seen anomaly set and starts opening at age 0. `update` advances opening, notices, transfer, and slot attention only in `playing`; `paused`, `upgrade`, `gameOver`, and `menu` do not advance them. `reset` clears all state and does not start an opening.

- [ ] **Step 4: Add readable Russian anomaly metadata and final lifetimes**

```ts
export const ANOMALY_PRESENTATION: Readonly<Record<AnomalyType, { label: string; explanation: string }>> = {
  reverse: { label: 'РЕВЕРС', explanation: 'УПРАВЛЕНИЕ МЕНЯЕТСЯ МЕСТАМИ' },
  mirage: { label: 'МИРАЖ', explanation: 'СЛЕДУЙ ЗА САМЫМ ПЛОТНЫМ СЛЕДОМ' },
  drift: { label: 'ДРЕЙФ', explanation: 'КОНТУР ПОКАЗЫВАЕТ МЕСТО ПРИЗЕМЛЕНИЯ' },
  colorShift: { label: 'СМЕНА ЦВЕТА', explanation: 'ВНУТРЕННЯЯ ГРАНЬ ПОКАЗЫВАЕТ БУДУЩИЙ ЦВЕТ' },
  inertia: { label: 'ИНЕРЦИЯ', explanation: 'ПОВОРОТ СРАБАТЫВАЕТ С ЗАДЕРЖКОЙ' },
};

export type BonusTone = 'sky' | 'amber' | 'teal' | 'coral' | 'ivory';

const FALLBACK_BONUS_PRESENTATION = Object.freeze({
  label: 'БОНУС',
  description: 'ПРОБЕЛ — ИСПОЛЬЗОВАТЬ',
  activationCopy: 'БОНУС АКТИВИРОВАН',
  glyph: '◇',
  tone: 'ivory' as const,
});

export const getBonusPresentation = (type: string): BonusPresentation =>
  BONUS_PRESENTATION[type as BonusType] ?? FALLBACK_BONUS_PRESENTATION;

const COLLECTION_LIFETIME_MS = 1700;
const REPLACEMENT_LIFETIME_MS = 1700;
const ACTIVATION_LIFETIME_MS = 900;
const FIRST_ANOMALY_LIFETIME_MS = 1800;
```

On collection, create `transfer` from the real token lane and distance. On replacement, retain the outgoing glyph for 800 ms and name both bonuses. Add `firstSeenAnomalies: Set<AnomalyType>` and clear it in both `beginRun` and `reset`.

- [ ] **Step 5: Run tests and commit**

Run: `npm.cmd run test:run -- tests/PresentationSystem.test.ts tests/BonusPresentation.test.ts`

Expected: PASS with immutable nested arrays and pause-frozen timers.

```bash
git add src/presentation/PresentationSystem.ts src/presentation/bonusPresentation.ts tests/PresentationSystem.test.ts tests/BonusPresentation.test.ts progress.md
git commit -m "feat: stage opening and bonus presentation"
```

### Task 5: Give EffectsSystem one bounded physical motion language

**Files:**
- Modify: `src/render/EffectsSystem.ts`
- Modify: `tests/EffectsSystem.test.ts`
- Modify: `tests/ProgressionEffects.test.ts`

**Interfaces:**
- Consumes: immutable `GameEvent[]` plus `EffectsContext`.
- Produces: bounded `anticipations`, `assemblies`, `landings`, `fragments`, `shockwaves`, `anomalyCues`, `bonusImpact`, `shake`, and `hitStopRemainingMs`.
- Guarantees: reduced motion keeps static cues and labels while suppressing travel, stretch, strong shake, and long holds.

- [ ] **Step 1: Write failing grammar, cap, and reduced-motion tests**

```ts
it('stages a clear as 80 ms contraction, impact, then recovery under one second', () => {
  const effects = new EffectsSystem({ random: () => 0.5 });
  effects.consume([{
    type: 'matchCleared', cells: [{ side: 0, index: 0 }], color: 'teal', chain: 1,
  }]);
  expect(effects.snapshot().fragments[0]).toMatchObject({ anticipationMs: 80 });
  effects.update(79);
  expect(effects.snapshot().fragments.every(({ x, y, originX, originY }) =>
    x === originX && y === originY)).toBe(true);
  effects.update(1);
  effects.update(919);
  expect(effects.snapshot().fragments).toEqual([]);
});

it('uses one 90 ms collection hold and one origin ring', () => {
  const effects = new EffectsSystem();
  effects.consume([{
    type: 'bonusCollected', bonus: 'pulse',
    token: { id: 7, type: 'pulse', lane: 2, distance: 72, speed: 150 },
  }]);
  expect(effects.snapshot().hitStopRemainingMs).toBe(90);
  expect(effects.snapshot().shockwaves.filter(({ kind }) => kind === 'collection')).toHaveLength(1);
});

it.each(['slow', 'pulse', 'cleanse', 'colorBreak'] as const)(
  'keeps a distinct %s identity even when removal is empty',
  (bonus) => {
    const effects = new EffectsSystem();
    effects.consume([{ type: 'bonusActivated', bonus }]);
    expect(effects.snapshot().bonusImpact).toMatchObject({ bonus, removedCount: 0 });
  },
);

it('caps every effect channel during dense late play', () => {
  const effects = new EffectsSystem({ random: () => 0.5 });
  for (let index = 0; index < 500; index += 1) {
    effects.consume([{
      type: 'matchCleared', cells: [{ side: index % 6, index: 0 }], color: 'coral', chain: 4,
    }, {
      type: 'anomalyWarning', anomalies: ['drift'], lanes: [index % 6],
      warningMs: 2_500, atActiveMs: index * 100,
    }]);
  }
  const state = effects.snapshot();
  expect(state.fragments.length).toBeLessThanOrEqual(180);
  expect(state.shockwaves.length).toBeLessThanOrEqual(12);
  expect(state.labels.length).toBeLessThanOrEqual(6);
  expect(state.anomalyCues.length).toBeLessThanOrEqual(4);
});
```

- [ ] **Step 2: Run the focused effect tests and verify red**

Run: `npm.cmd run test:run -- tests/EffectsSystem.test.ts tests/ProgressionEffects.test.ts`

Expected: FAIL on 100 ms fracture anticipation, 70 ms collection hold, missing cue kind/channel, and new recovery assertions.

- [ ] **Step 3: Add explicit bounded motion records**

```ts
export interface Anticipation {
  readonly kind: 'landing' | 'clear' | 'bonus';
  readonly x: number;
  readonly y: number;
  readonly ageMs: number;
  readonly lifetimeMs: number;
}

export interface AnomalyCue {
  readonly anomaly: AnomalyType;
  readonly ageMs: number;
  readonly lifetimeMs: number;
  readonly warning: boolean;
}

export interface Shockwave {
  readonly kind: 'clear' | 'collection' | 'slow' | 'pulse' | 'rescue';
  readonly x: number;
  readonly y: number;
  readonly color: BlockColor | 'ivory';
  readonly ageMs: number;
  readonly lifetimeMs: number;
  readonly intensity: number;
}
```

Use `FRACTURE_ANTICIPATION_MS = 80`, `BONUS_COLLECTION_HOLD_MS = 90`, landing squash 110 ms, and hard expiry at 980 ms for ordinary-event channels. Keep caps explicit: 180 fragments, 12 shockwaves, 6 labels, 36 assemblies, 4 anomaly cues, and one bonus impact.

- [ ] **Step 4: Encode each bonus and anomaly identity without gameplay mutation**

`SLOW` emits one cool contour wave and a six-second trail flag; `PULSE` emits three staggered hex shockwaves; `CLEANSE` exposes the selected side/cells as a narrow inward cut; `COLOR BREAK` stores the removed colors and deterministic 24 ms fracture groups. `REVERSE` exposes rotation direction, `MIRAGE` a fragmented cue, `DRIFT` a destination contour, `COLOR SHIFT` a future-color facet cue, and `INERTIA` direction plus remaining impulse. Empty bonus removals keep `bonusImpact` and labels but add no fragments.

- [ ] **Step 5: Implement reduced-motion preservation and reset**

For reduced motion, set all hit stops and shake magnitude to zero, omit assemblies/fragments, replace moving shockwaves with one 140 ms local contour, and keep labels/anomaly cues. `reset()` must clear every array, singleton, timer, and cue.

- [ ] **Step 6: Run tests and commit**

Run: `npm.cmd run test:run -- tests/EffectsSystem.test.ts tests/ProgressionEffects.test.ts`

Expected: PASS with deep-frozen snapshots and zero stale channels after reset.

```bash
git add src/render/EffectsSystem.ts tests/EffectsSystem.test.ts tests/ProgressionEffects.test.ts progress.md
git commit -m "feat: strengthen bounded arcade motion"
```

### Task 6: Render the opening and effects through an explicit six-layer Canvas pipeline

**Files:**
- Modify: `src/render/CanvasRenderer.ts`
- Modify: `tests/CanvasRenderer.test.ts`
- Modify: `tests/ProgressionRenderer.test.ts`

**Interfaces:**
- Consumes: `GameSnapshot`, `EffectsSnapshot`, `PresentationSnapshot`, and interpolation alpha.
- Produces: the unchanged public `render(snapshot, effects, presentation, alpha): void` API.
- Produces: optional constructor observers `onLayer(layer)` and `onOpeningStage(stage)` used only by deterministic renderer tests.
- Guarantees layer order: background/grain → phase guides → hub/stacks → falling blocks/tokens → world effects → screen-space accents.

- [ ] **Step 1: Write failing layer-order and opening-frame tests**

```ts
it('draws the six named layers in order', () => {
  const { canvas } = surface();
  const layers: RenderLayer[] = [];
  const renderer = new CanvasRenderer(canvas, { onLayer: (layer) => layers.push(layer) });
  renderer.render(snapshot(), baseEffects(), presentation(), 0);
  expect(layers).toEqual([
    'background', 'guides', 'field', 'falling', 'world-effects', 'screen-effects',
  ]);
});

it.each([
  [0, 'assemble'], [320, 'guides'], [760, 'ready'], [1199, 'ready'],
] as const)('renders the opening stage at %i ms', (ageMs, stage) => {
  const { canvas } = surface();
  const stages: OpeningStage[] = [];
  const renderer = new CanvasRenderer(canvas, { onOpeningStage: (value) => stages.push(value) });
  const system = new PresentationSystem();
  system.beginRun([1, 2]);
  system.update(ageMs, 'playing');
  renderer.render(snapshot({ opening: { remainingMs: 1_200 - ageMs, previewLanes: [1, 2] } }),
    baseEffects(), system.snapshot(), 0);
  expect(stages).toEqual([stage]);
});

it('keeps routine phase response inside graphite guide geometry', () => {
  const { renderer, strokes } = surface();
  const current = snapshot();
  renderer.render({ ...current, cycle: { ...current.cycle, phase: 'pressure' } },
    baseEffects(), presentation(), 0);
  expect(strokes.map(({ style }) => style)).not.toContain('#ff0000');
  expect(Math.max(...strokes.map(({ alpha }) => alpha))).toBeLessThanOrEqual(0.22);
});
```

- [ ] **Step 2: Run renderer tests and verify red**

Run: `npm.cmd run test:run -- tests/CanvasRenderer.test.ts tests/ProgressionRenderer.test.ts`

Expected: FAIL because opening stages and named layer instrumentation do not exist and current drawing interleaves trails/field/effects.

- [ ] **Step 3: Refactor render into explicit layers without changing geometry math**

```ts
export type RenderLayer = 'background' | 'guides' | 'field' | 'falling' | 'world-effects' | 'screen-effects';
export interface CanvasRendererOptions {
  readonly onLayer?: (layer: RenderLayer) => void;
  readonly onOpeningStage?: (stage: OpeningStage) => void;
}

public constructor(
  private readonly canvas: HTMLCanvasElement,
  private readonly options: CanvasRendererOptions = {},
) {
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D is unavailable');
  this.ctx = context;
  let seed = 0x483358;
  for (let index = 0; index < this.grain.length; index += 1) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    this.grain[index] = seed / 4294967296;
  }
}

private drawBackgroundLayer(): void { this.background(); }
private drawGuideLayer(snapshot: GameSnapshot, presentation: PresentationSnapshot, time: number): void {
  this.guides(snapshot, time);
  this.openingGuides(presentation.opening);
}
private drawFieldLayer(snapshot: GameSnapshot, effects: EffectsSnapshot, orientation: number, time: number): void {
  this.hubAndStacks(snapshot, effects, orientation, time);
}
private drawFallingLayer(snapshot: GameSnapshot, effects: EffectsSnapshot, fraction: number): void {
  this.fallingObjects(snapshot, effects, fraction);
}
private drawWorldEffectsLayer(effects: EffectsSnapshot, presentation: PresentationSnapshot): void {
  this.worldEffects(effects);
  this.bonusTransfer(presentation, effects.reducedMotion);
}
private drawScreenEffectsLayer(effects: EffectsSnapshot): void {
  this.screenEffects(effects);
  this.combo(effects);
}

private layer(layer: RenderLayer, draw: () => void): void {
  this.options.onLayer?.(layer);
  draw();
}
```

`render` invokes `layer` exactly six times in the order asserted by the test. `openingGuides` calls `options.onOpeningStage?.(opening.stage)` once when opening is non-null.

Move existing helpers into these callers without duplicating block iteration. Keep menu decoration independent of game state and preserve `worldToScreen` in CSS pixels.

- [ ] **Step 4: Draw the 1.2-second opening and phase-responsive background**

At 0–320 ms, interpolate six hub facets from radius 118 to `HEX_APOTHEM` with one 4% overshoot. At 320–760 ms, converge guide lines onto `opening.previewLanes`. At 760–1200 ms, render `ГОТОВ` once at center and fade it before the first block appears. Guide density/velocity multipliers are Settle `0.75`, Build `1`, Pressure `1.25`, Release `0.55`; routine alpha remains at or below `0.22`.

- [ ] **Step 5: Render clearer tokens, transfers, cues, and recovery**

Use a faceted token silhouette 1.35× ordinary plate height, an inset glyph, one slow orbit, and a 1.6× trail. For `BonusTransfer`, hold at origin through `delayMs`, then travel on a quadratic curve for exactly 800 ms toward the stable lower-right slot anchor. Render outgoing replacement glyph outward/rotated while the new glyph overshoots by at most 6%. Draw anomaly evidence beside affected geometry; never cover the hub or incoming lane.

The cue contract is exact: REVERSE draws a clockwise/counter-clockwise arrow ring during warning; MIRAGE draws the decoy at 42% alpha with a dashed trail while the real route stays solid at 86% alpha; DRIFT draws the destination lane contour before curvature begins; COLOR SHIFT draws the future color as a 35%-scale inset facet; INERTIA draws the queued rotation direction and a shrinking delay arc on the hub. For a double threat, place the two glyphs on opposite ends of one side-attached rule so neither cue occludes the other.

- [ ] **Step 6: Pin reduced-motion output and commit**

In reduced motion, opening facets use a 140 ms crossfade, transfer is a destination crossfade, guides retain lane endpoints, and warning labels/cues remain present.

Run: `npm.cmd run test:run -- tests/CanvasRenderer.test.ts tests/ProgressionRenderer.test.ts`

Expected: PASS including finite-number guards and reset/hold behavior.

```bash
git add src/render/CanvasRenderer.ts tests/CanvasRenderer.test.ts tests/ProgressionRenderer.test.ts progress.md
git commit -m "feat: render premium arcade choreography"
```

### Task 7: Recompose the HUD and persistent bonus slot without dashboard UI

**Files:**
- Modify: `src/ui/ScreenController.ts`
- Modify: `src/styles.css`
- Modify: `tests/ScreenController.test.ts`
- Modify: `tests/IndexLocalization.test.ts`

**Interfaces:**
- Consumes: full `GameSnapshot` and `PresentationSnapshot`.
- Preserves: one delegated click listener and stable DOM nodes across same-mode animation frames.
- Produces: lower-right semantic bonus slot with glyph, full name, one-line description, and `ПРОБЕЛ` key; attached side warning; top-center score/multiplier/phase rule.

- [ ] **Step 1: Write failing semantic HUD tests**

```ts
it('keeps complete bonus meaning in the slot after acquisition copy expires', () => {
  const screen = new ScreenController(root);
  screen.render(snapshot({ bonus: { stored: 'pulse', slowRemainingMs: 0 } }), emptyPresentation());
  const slot = root.querySelector('.bonus-slot');
  expect(slot?.textContent).toContain('ИМПУЛЬС');
  expect(slot?.textContent).toContain('СБРАСЫВАЕТ КРАЙНИЕ БЛОКИ');
  expect(slot?.textContent).toContain('ПРОБЕЛ');
});

it('attaches danger and anomaly cues to the affected side', () => {
  const screen = new ScreenController(root);
  const current = snapshot();
  screen.render({
    ...current,
    cycle: {
      ...current.cycle,
      warning: ['drift'],
      warningRemainingMs: 2_500,
      threat: {
        pattern: 'pair', anchorLane: 4, lanes: [4, 5], anomalies: ['drift'],
        warningMs: 2_500, entryDelayMs: 0, bonusIncompatible: false,
        evidence: { seedCycle: 2, phase: 'build', budget: 6, spent: 4, combinationKey: 'pair:drift:4' },
      },
    },
  }, emptyPresentation());
  expect(root.querySelector('[data-side="4"].field-warning')?.textContent).toContain('ДРЕЙФ');
  expect(root.querySelector('.danger-panel')).toBeNull();
});

it('preserves the notice and focused pause button across same-mode frames', () => {
  const screen = new ScreenController(root);
  const presentationSystem = new PresentationSystem();
  presentationSystem.consume([{ type: 'bonusActivated', bonus: 'slow' }]);
  const noticeState = presentationSystem.snapshot();
  screen.render(snapshot(), noticeState);
  const notice = root.querySelector('.presentation-notice');
  const pause = root.querySelector<HTMLButtonElement>('[data-action="pause"]')!;
  pause.focus();
  screen.render(snapshot({ score: 99 }), noticeState);
  expect(root.querySelector('.presentation-notice')).toBe(notice);
  expect(document.activeElement).toBe(pause);
});
```

- [ ] **Step 2: Run UI tests and verify red**

Run: `npm.cmd run test:run -- tests/ScreenController.test.ts tests/IndexLocalization.test.ts`

Expected: FAIL because the slot lacks the persistent description and warnings are detached generic status text.

- [ ] **Step 3: Add stable semantic hosts and exact slot copy**

Create the playing DOM once on mode entry with `.score`, `.multiplier`, `.phase-rule`, `.field-warning-host`, `.bonus-host`, `.presentation-host`, and `.upgrade-rail`. Update text, data attributes, ARIA values, and CSS custom properties in place. The bonus markup is:

```html
<div class="bonus-slot" data-tone="amber" aria-label="Сохранённый бонус: ИМПУЛЬС. Сбрасывает крайние блоки. Пробел — использовать">
  <span class="bonus-glyph current" aria-hidden="true">⌁</span>
  <span class="bonus-copy">
    <strong>ИМПУЛЬС</strong>
    <span class="bonus-description">СБРАСЫВАЕТ КРАЙНИЕ БЛОКИ</span>
    <small><kbd>ПРОБЕЛ</kbd><span aria-hidden="true"> — </span>ИСПОЛЬЗОВАТЬ</small>
  </span>
</div>
```

- [ ] **Step 4: Style clipped matte geometry and attached warnings**

Use `clip-path: polygon(0 10px, 10px 0, 100% 0, 100% calc(100% - 10px), calc(100% - 10px) 100%, 0 100%)`, opaque graphite surfaces, one 1 px accent rule, and no blur/backdrop-filter. Keep the bonus slot within 300 px at 1280×720, use `max-width: min(300px, 28vw)`, and let long Russian copy wrap to two lines without covering the field. Position side warnings from `data-side` using six CSS transforms around the field rather than a red panel.

- [ ] **Step 5: Preserve information under reduced motion and commit**

The reduced-motion media query sets travel/overshoot animations to 1 ms but keeps slot attention as an accent-rule fade, warning text, all descriptions, and native focus outlines.

Run: `npm.cmd run test:run -- tests/ScreenController.test.ts tests/IndexLocalization.test.ts`

Expected: PASS with unchanged keyboard/click action routing.

```bash
git add src/ui/ScreenController.ts src/styles.css tests/ScreenController.test.ts tests/IndexLocalization.test.ts progress.md
git commit -m "feat: clarify the premium in-game HUD"
```

### Task 8: Wire clocks, reset ordering, QA text, and deterministic replay

**Files:**
- Modify: `src/main.ts`
- Modify: `src/runtime/GameRuntime.ts`
- Modify: `src/game/types.ts`
- Modify: `tests/GameRuntime.test.ts`
- Modify: `tests/EndlessRun.test.ts`
- Modify: `tests/ProgressionInput.test.ts`

**Interfaces:**
- Consumes: Tasks 1–7 systems.
- Preserves: `window.advanceTime(ms)` and `window.render_game_to_text()`.
- Guarantees: presentation/effects advance after engine events on each consumed fixed step, freeze outside `playing`, and reset before the first frame of a new session.

- [ ] **Step 1: Write failing composition and reset-replay tests**

```ts
it('advances the in-engine opening through the public fixed-step hook', () => {
  const engine = new GameEngine({ spawning: false, randomSeed: 31 });
  const presentation = new PresentationSystem();
  engine.start();
  presentation.beginRun(engine.getSnapshot().opening.previewLanes);
  const runtime = new GameRuntime(engine, {
    onStep: (ms) => presentation.update(ms, engine.getSnapshot().mode),
  });
  runtime.advanceTime(600);
  expect(engine.getSnapshot().opening.remainingMs).toBeCloseTo(600);
  expect(presentation.snapshot().opening?.stage).toBe('guides');
});

it('freezes every visual clock while paused and clears it before restart flush', () => {
  const presentation = new PresentationSystem();
  const effects = new EffectsSystem();
  presentation.beginRun([1, 2]);
  presentation.update(500, 'playing');
  presentation.consume([{
    type: 'bonusCollected', bonus: 'pulse',
    token: { id: 7, type: 'pulse', lane: 2, distance: 72, speed: 150 },
  }]);
  effects.consume([{
    type: 'bonusCollected', bonus: 'pulse',
    token: { id: 7, type: 'pulse', lane: 2, distance: 72, speed: 150 },
  }]);
  const before = { presentation: presentation.snapshot(), effects: effects.snapshot() };
  presentation.update(5_000, 'paused');
  expect(presentation.snapshot()).toEqual(before.presentation);
  effects.reset();
  presentation.reset();
  presentation.beginRun([1, 2]);
  expect(presentation.snapshot()).toMatchObject({ transfer: null, opening: { ageMs: 0 } });
  expect(effects.snapshot().hitStopRemainingMs).toBe(0);
});

it('replays the same seed after a partial opening and bonus transfer', () => {
  const run = () => {
    const engine = new GameEngine({ randomSeed: 31 });
    const presentation = new PresentationSystem();
    engine.start();
    presentation.beginRun(engine.getSnapshot().opening.previewLanes);
    const opening = engine.update(600);
    presentation.consume([{
      type: 'bonusCollected', bonus: 'pulse',
      token: { id: 7, type: 'pulse', lane: 2, distance: 72, speed: 150 },
    }]);
    presentation.update(300, 'playing');
    engine.restart();
    presentation.reset();
    presentation.beginRun(engine.getSnapshot().opening.previewLanes);
    return {
      previewLanes: engine.getSnapshot().opening.previewLanes,
      events: [...opening.map(({ type }) => type), ...engine.update(90_000)],
      presentation: presentation.snapshot(),
    };
  };
  expect(run()).toEqual(run());
});
```

- [ ] **Step 2: Run runtime/integration tests and verify red**

Run: `npm.cmd run test:run -- tests/GameRuntime.test.ts tests/EndlessRun.test.ts tests/ProgressionInput.test.ts`

Expected: FAIL because presentation currently updates without mode context, `beginRun` is not composed, and QA text excludes presentation/threat detail.

- [ ] **Step 3: Enforce event/update/render order**

```ts
const runtime = new GameRuntime(engine, {
  onEvents: (events) => {
    const snapshot = engine.getSnapshot();
    presentation.consume(events);
    effects.consume(events, { orientation: snapshot.orientation });
  },
  onStep: (ms) => {
    const mode = engine.getSnapshot().mode;
    presentation.update(ms, mode);
    if (mode === 'playing') effects.update(ms);
  },
  render: (alpha) => {
    const snapshot = engine.getSnapshot();
    const presentationSnapshot = presentation.snapshot();
    renderer.render(snapshot, effects.snapshot(), presentationSnapshot, alpha);
    screens.render(snapshot, presentationSnapshot);
  },
});
```

Do not advance presentation/effects in `paused`, `upgrade`, `gameOver`, or `menu`. Engine `elapsedMs` remains the gameplay clock and is not replaced by a visual wall clock.

- [ ] **Step 4: Reset in one ordered transaction**

```ts
const resetSession = (action: () => void, beginsRun: boolean): void => {
  effects.reset();
  presentation.reset();
  action();
  if (beginsRun) presentation.beginRun(engine.getSnapshot().opening.previewLanes);
  runtime.resetTiming();
  runtime.flush();
};
```

Use `beginsRun: true` for play/restart/retry and `false` for menu. Detect elapsed rollback defensively in the renderer and runtime tests, but never rely on it instead of this explicit reset.

- [ ] **Step 5: Expand concise QA state**

`render_game_to_text()` must serialize mode, elapsed time, opening remaining/preview lanes, cycle number/phase/progress, threat evidence, warnings, active anomalies and timers, stored bonus/slow timer, upgrade levels/offer, stacks/falling objects, plus concise presentation fields (`openingStage`, notice title, transfer bonus/age) and effect fields (`hitStopRemainingMs`, active cue kinds). It must remain JSON and omit particle coordinates.

- [ ] **Step 6: Run focused and full tests, then commit**

Run: `npm.cmd run test:run -- tests/GameRuntime.test.ts tests/EndlessRun.test.ts tests/ProgressionInput.test.ts`

Expected: PASS.

Run: `npm.cmd run test:run`

Expected: all tests PASS.

```bash
git add src/main.ts src/runtime/GameRuntime.ts src/game/types.ts tests/GameRuntime.test.ts tests/EndlessRun.test.ts tests/ProgressionInput.test.ts progress.md
git commit -m "feat: integrate premium run presentation"
```

### Task 9: Update distribution docs and run complete browser QA

**Files:**
- Create: `test-artifacts/run-premium-arcade-qa.mjs`
- Modify: `README.md`
- Modify: `SOURCE.md`
- Modify: `scripts/package-source.mjs`
- Modify: `tests/Distribution.test.ts`
- Modify: `progress.md`

**Interfaces:**
- Consumes: public controls only: DOM click/keyboard, `window.advanceTime(ms)`, and `window.render_game_to_text()`.
- Produces: screenshots and JSON under `test-artifacts/premium-arcade-qa/` plus `console-errors.json` and `run-report.json`.

- [ ] **Step 1: Write the distribution regression before changing packaging**

```ts
it('packages the premium redesign source, spec, plan, and tests but excludes QA captures', () => {
  const expected = [
    'src/game/ThreatDirector.ts',
    'src/presentation/PresentationSystem.ts',
    'tests/ThreatDirector.test.ts',
    'docs/superpowers/specs/2026-09-21-hextris-premium-arcade-redesign.md',
    'docs/superpowers/plans/2026-09-21-hextris-premium-arcade-redesign.md',
  ];
  for (const file of expected) expect(readFileSync(join(fixture, 'dist/source', file))).toBeTruthy();
  expect(readdirSync(join(fixture, 'dist/source'), { recursive: true })
    .some((file) => String(file).includes('test-artifacts'))).toBe(false);
});
```

- [ ] **Step 2: Run the distribution test and verify red**

Run: `npm.cmd run test:run -- tests/Distribution.test.ts`

Expected: FAIL until the renamed director, spec, plan, and regression tests are included in Corresponding Source; `test-artifacts` remains deliberately excluded.

- [ ] **Step 3: Create the public-control QA script**

The script must launch the existing Edge/Playwright adapter, open `http://127.0.0.1:5173/`, collect `pageerror` and console warning/error entries, and capture these exact named states at both 1280×720 and 1920×1080 where applicable:

```js
const scenarios = [
  '01-menu', '02-opening-assemble', '03-opening-guides', '04-opening-ready',
  '05-first-wave', '06-first-90-seconds', '07-anomaly-warning', '08-anomaly-active',
  '09-bonus-falling', '10-bonus-collected', '11-bonus-stored', '12-bonus-replaced',
  '13-slow', '14-pulse', '15-cleanse', '16-color-break', '17-clear', '18-chain',
  '19-pressure', '20-release', '21-third-cycle-upgrade', '22-five-minute-profile',
  '23-late-cap', '24-last-stand', '25-game-over', '26-retry-reset',
  '27-reduced-motion-opening', '28-reduced-motion-bonus', '29-paused-transient',
];
```

For each capture, write the PNG and the parsed `render_game_to_text` JSON with the same basename. Assert no anomaly start before 90, warning time at least 2500, double anomaly time at least 360000, late speed at most 600, late interval at least 500, upgrade cycle exactly 3, pause snapshots equal, and reset state empty. The final script throws if console errors/warnings are non-empty.

- [ ] **Step 4: Update README, source packaging, and progress log**

Document the four-phase cycle, Space bonus flow, anomaly warnings, third-cycle upgrades, deterministic QA hooks, reduced motion, and unchanged no-persistence scope. Replace `CycleDirector` references with `ThreatDirector`. Add the new source, plan, spec, and tests to the explicit packager allowlist; keep `test-artifacts` excluded from Corresponding Source.

- [ ] **Step 5: Run every automated gate**

Run: `npm.cmd run test:run`

Expected: all tests PASS.

Run: `npm.cmd run typecheck`

Expected: exit 0.

Run: `npm.cmd run build`

Expected: Vite build succeeds, `dist/index.html` exists, and Corresponding Source contains `ThreatDirector.ts`, this spec, this plan, and the QA script.

Run: `git diff --check`

Expected: exit 0, ignoring only already-established CRLF normalization notices if Git prints them as warnings rather than errors.

- [ ] **Step 6: Run browser QA and inspect every image**

Start: `npm.cmd run dev -- --host 127.0.0.1`

Run in a second terminal: `node test-artifacts/run-premium-arcade-qa.mjs`

Expected: exit 0; `test-artifacts/premium-arcade-qa/console-errors.json` is `[]`; `run-report.json` records all 29 scenarios.

Open every PNG. Confirm the field is centered and unclipped, ordinary play returns to clarity within one second, the opening has no empty dead air, bonus travel is followable, copy is readable before expiring, warnings attach to affected geometry, no routine full-screen wash appears, and 1920×1080 does not look like a stretched 1280×720 layout.

- [ ] **Step 7: Commit the verified release pass**

```bash
git add README.md SOURCE.md scripts/package-source.mjs tests/Distribution.test.ts test-artifacts/run-premium-arcade-qa.mjs test-artifacts/premium-arcade-qa progress.md
git commit -m "test: verify premium arcade redesign"
```

## Final Whole-Branch Review Gate

- [ ] Run `npm.cmd run test:run`, `npm.cmd run typecheck`, `npm.cmd run build`, and `git diff --check` again from a clean shell.
- [ ] Compare `git diff a13f4c9..HEAD` against every Acceptance Criterion and Explicit Non-Goal in the spec.
- [ ] Search `src`, `index.html`, and `README.md` for accidental scope: `rg -n -i "localStorage|sessionStorage|account|login|currency|shop|store|analytics|audio|music|neon|glass|bloom|mobile" src index.html README.md`.
- [ ] Re-run `node test-artifacts/run-premium-arcade-qa.mjs` after the final review fixes and inspect the replaced captures.
- [ ] Ask one fresh reviewer to report only Critical, Important, and Minor findings against commit `a13f4c9`; resolve Critical and Important findings with failing regressions before declaring completion.
