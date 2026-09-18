# HEXTRIS Gameplay Feedback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every bonus acquisition, storage, activation, block arrival, and destruction event immediately understandable and visually satisfying without changing gameplay rules.

**Architecture:** Preserve `GameEngine` as the deterministic source of rules and immutable events. Add a browser-independent `PresentationSystem` for high-level copy and HUD timing, keep physical canvas motion in `EffectsSystem`, and feed immutable presentation/effect snapshots to `ScreenController` and `CanvasRenderer` from `main.ts`.

**Tech Stack:** TypeScript 5.9, Canvas 2D, semantic HTML/CSS, Vite 7, Vitest 4, jsdom.

**Spec:** `docs/superpowers/specs/2026-09-18-hextris-gameplay-feedback-design.md`

## Global Constraints

- Do not change bonus targeting, scoring, probability, duration, difficulty, or deterministic random sequences.
- Do not add dependencies, audio, persistent progression, accounts, analytics, new modes, neon, glass, blur-heavy panels, or continuous shake.
- Every transient collection remains bounded; retain the existing 180-particle and 12-shockwave ceilings unless a stricter cap is introduced.
- Full-motion collection copy lasts 900 ms, transfer motion runs from 240–650 ms, slot attention lasts 2,500 ms, activation copy lasts 620 ms, and block assembly lasts 180 ms.
- `prefers-reduced-motion: reduce` retains copy, glyphs, and controls while replacing travel, assembly, fragments, shake, and visual holds with short fades.
- Restart, retry, menu, HMR, and elapsed-time rollback reset presentation and effects together.
- Presentation may describe engine decisions but must never enqueue a command, choose a target, change score, or mutate a game snapshot.

---

### Task 1: Shared Bonus Presentation Metadata

**Files:**
- Create: `src/presentation/bonusPresentation.ts`
- Create: `tests/BonusPresentation.test.ts`
- Modify: `src/ui/ScreenController.ts`
- Modify: `src/render/CanvasRenderer.ts`

**Interfaces:**
- Consumes: `BonusType` from `src/game/progressionTypes.ts`.
- Produces: `BonusPresentation`, `BONUS_PRESENTATION`, and `getBonusPresentation(type: BonusType): BonusPresentation`.

- [ ] **Step 1: Write the failing exhaustive metadata test**

```ts
import { describe, expect, it } from 'vitest';
import { BONUS_PRESENTATION, getBonusPresentation } from '../src/presentation/bonusPresentation';

describe('bonus presentation metadata', () => {
  it('defines distinct complete copy and glyphs for every bonus', () => {
    expect(Object.keys(BONUS_PRESENTATION).sort()).toEqual(['cleanse', 'colorBreak', 'pulse', 'slow']);
    expect(new Set(Object.values(BONUS_PRESENTATION).map(({ glyph }) => glyph)).size).toBe(4);
    expect(getBonusPresentation('slow')).toMatchObject({
      label: 'SLOW', description: 'SLOWS FALLING BLOCKS FOR 6 SECONDS', glyph: 'Ⅱ', tone: 'sky',
    });
    expect(getBonusPresentation('pulse').description).toBe('KNOCKS BLOCKS FROM OUTER SIDES');
    expect(getBonusPresentation('cleanse').description).toBe('CLEARS THE TALLEST SIDE');
    expect(getBonusPresentation('colorBreak').description).toBe('REMOVES EVERY BLOCK OF ONE COLOR');
    expect(Object.values(BONUS_PRESENTATION).every(Object.isFrozen)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test and verify the module is missing**

Run: `npm run test:run -- tests/BonusPresentation.test.ts`

Expected: FAIL resolving `src/presentation/bonusPresentation.ts`.

- [ ] **Step 3: Implement the exhaustive immutable metadata map**

```ts
import type { BonusType } from '../game/progressionTypes';

export type BonusTone = 'sky' | 'amber' | 'teal' | 'coral';

export interface BonusPresentation {
  readonly label: string;
  readonly description: string;
  readonly glyph: string;
  readonly tone: BonusTone;
}

const entry = (value: BonusPresentation): BonusPresentation => Object.freeze(value);

export const BONUS_PRESENTATION: Readonly<Record<BonusType, BonusPresentation>> = Object.freeze({
  slow: entry({ label: 'SLOW', description: 'SLOWS FALLING BLOCKS FOR 6 SECONDS', glyph: 'Ⅱ', tone: 'sky' }),
  pulse: entry({ label: 'PULSE', description: 'KNOCKS BLOCKS FROM OUTER SIDES', glyph: '⌁', tone: 'amber' }),
  cleanse: entry({ label: 'CLEANSE', description: 'CLEARS THE TALLEST SIDE', glyph: '╱', tone: 'teal' }),
  colorBreak: entry({ label: 'COLOR BREAK', description: 'REMOVES EVERY BLOCK OF ONE COLOR', glyph: '◆', tone: 'coral' }),
});

export const getBonusPresentation = (type: BonusType): BonusPresentation => BONUS_PRESENTATION[type];
```

- [ ] **Step 4: Replace duplicate bonus labels and glyphs**

In `ScreenController.ts`, remove `BONUS_LABELS` and use `getBonusPresentation(snapshot.bonus.stored)`.

In `CanvasRenderer.ts`, remove the local `BONUS_GLYPHS` table and use `getBonusPresentation(bonus.type).glyph`.

- [ ] **Step 5: Run affected and full tests**

Run: `npm run test:run -- tests/BonusPresentation.test.ts tests/ScreenController.test.ts tests/ProgressionRenderer.test.ts`

Expected: all tests pass with no changed engine snapshots.

- [ ] **Step 6: Commit**

```powershell
git add src/presentation/bonusPresentation.ts src/ui/ScreenController.ts src/render/CanvasRenderer.ts tests/BonusPresentation.test.ts
git commit -m "refactor: centralize bonus presentation metadata"
```

---

### Task 2: Deterministic Presentation Timeline

**Files:**
- Create: `src/presentation/PresentationSystem.ts`
- Create: `tests/PresentationSystem.test.ts`

**Interfaces:**
- Consumes: immutable `PresentationEvent[]`, `BonusType`, and collection-origin metadata. `PresentationEvent` temporarily refines the old `bonusCollected` event so this task compiles before Task 3 makes `GameEvent` directly assignable.
- Produces: `PresentationSystem.consume(events)`, `update(deltaMs)`, `snapshot()`, `reset()`, and immutable `PresentationSnapshot`.

- [ ] **Step 1: Write failing acquisition, replacement, activation, priority, freeze, and reset tests**

```ts
import { describe, expect, it } from 'vitest';
import { PresentationSystem } from '../src/presentation/PresentationSystem';

const collected = {
  type: 'bonusCollected' as const,
  bonus: 'pulse' as const,
  token: Object.freeze({ id: 7, type: 'pulse' as const, lane: 2, distance: 72, speed: 150 }),
};

describe('PresentationSystem', () => {
  it('explains acquisition, transfers the glyph, and settles slot attention', () => {
    const presentation = new PresentationSystem();
    presentation.consume([collected]);
    expect(presentation.snapshot()).toMatchObject({
      notice: { title: 'PULSE ACQUIRED', body: 'KNOCKS BLOCKS FROM OUTER SIDES', lifetimeMs: 900 },
      transfer: { bonus: 'pulse', lane: 2, distance: 72, ageMs: 0, lifetimeMs: 650 },
      slotAttentionRemainingMs: 2500,
    });
    presentation.update(650);
    expect(presentation.snapshot().transfer).toBeNull();
    presentation.update(250);
    expect(presentation.snapshot().notice).toBeNull();
    presentation.update(1600);
    expect(presentation.snapshot().slotAttentionRemainingMs).toBe(0);
  });

  it('announces replacement and activation with bounded priority', () => {
    const presentation = new PresentationSystem();
    presentation.consume([
      collected,
      { type: 'bonusReplaced', previous: 'slow', replacement: 'pulse' },
      { type: 'bonusActivated', bonus: 'pulse' },
      { type: 'lastStand', side: 0, cells: [], blocks: [] },
    ]);
    expect(presentation.snapshot().notice?.title).toBe('LAST STAND');
    expect(presentation.snapshot().queuedNotices).toHaveLength(2);
  });

  it('clamps invalid time, freezes immutable snapshots, and clears every channel', () => {
    const presentation = new PresentationSystem();
    presentation.consume([collected]);
    presentation.update(Number.NaN);
    expect(presentation.snapshot().notice?.ageMs).toBe(0);
    expect(Object.isFrozen(presentation.snapshot())).toBe(true);
    presentation.reset();
    expect(presentation.snapshot()).toEqual({
      notice: null, queuedNotices: [], transfer: null, slotAttentionRemainingMs: 0, replacedBonus: null,
    });
  });
});
```

- [ ] **Step 2: Run the test and verify the system is missing**

Run: `npm run test:run -- tests/PresentationSystem.test.ts`

Expected: FAIL resolving `PresentationSystem`.

- [ ] **Step 3: Define immutable presentation types**

```ts
export type NoticePriority = 1 | 2 | 3 | 4;

export type PresentationEvent =
  | Exclude<GameEvent, { readonly type: 'bonusCollected' }>
  | {
      readonly type: 'bonusCollected';
      readonly bonus: BonusType;
      readonly token: FallingBonus;
    };

export interface PresentationNotice {
  readonly title: string;
  readonly body: string;
  readonly tone: 'ivory' | 'sky' | 'amber' | 'teal' | 'coral';
  readonly priority: NoticePriority;
  readonly ageMs: number;
  readonly lifetimeMs: number;
  readonly assertive: boolean;
}

export interface BonusTransfer {
  readonly bonus: BonusType;
  readonly lane: number;
  readonly distance: number;
  readonly ageMs: number;
  readonly lifetimeMs: 650;
}

export interface PresentationSnapshot {
  readonly notice: PresentationNotice | null;
  readonly queuedNotices: readonly PresentationNotice[];
  readonly transfer: BonusTransfer | null;
  readonly slotAttentionRemainingMs: number;
  readonly replacedBonus: BonusType | null;
}
```

- [ ] **Step 4: Implement event-to-notice mapping and a capped queue**

Implement these exact mappings:

```ts
bonusCollected -> priority 3, '<LABEL> ACQUIRED', metadata description, 900 ms
bonusReplaced -> priority 3, '<NEW> REPLACED <OLD>', new description, 950 ms
bonusActivated -> priority 4, '<LABEL> ACTIVATED', metadata description, 620 ms
matchCleared chain > 1 -> priority 1, 'CHAIN ×N', empty body, 620 ms
lastStand -> priority 4, 'LAST STAND', 'OVERFLOW SURVIVED', 900 ms, assertive
gameOver -> priority 4, 'GAME OVER', 'FINAL SCORE <score>', 900 ms, assertive
```

Sort same-batch candidates by priority while preserving event order within a
priority. Show the highest candidate immediately, retain at most two queued
notices, and drop a duplicate title already active or queued. Snapshot every
nested object and array with `Object.freeze`.

- [ ] **Step 5: Implement deterministic update and reset**

`update(deltaMs)` treats non-finite or negative time as zero, advances high-level
presentation timing by the full valid delta, promotes the next queued notice when
the current one expires, removes transfer at 650 ms, and decrements slot attention
to zero. `reset()` returns the exact empty snapshot used in the test.

- [ ] **Step 6: Run tests and commit**

Run: `npm run test:run -- tests/PresentationSystem.test.ts`

Expected: all timeline assertions pass.

```powershell
git add src/presentation/PresentationSystem.ts tests/PresentationSystem.test.ts
git commit -m "feat: add deterministic gameplay presentation timeline"
```

---

### Task 3: Descriptive Spawn and Collection Events

**Files:**
- Modify: `src/game/types.ts`
- Modify: `src/game/GameEngine.ts`
- Modify: `tests/GameEngine.test.ts`
- Modify: `tests/GameProgression.test.ts`
- Modify: event fixtures in `tests/GameRuntime.test.ts`, `tests/ProgressionEffects.test.ts`, and `tests/EndlessRun.test.ts` only where TypeScript requires the new fields.

**Interfaces:**
- Consumes: existing `FallingBlock`, `FallingBonus`, spawn requests, and deterministic engine time.
- Produces: `blockSpawned` events and `bonusCollected.token` metadata for Tasks 2, 5, and 6.

- [ ] **Step 1: Write failing event-contract tests**

Add to `GameEngine.test.ts`:

```ts
it('describes newly spawned blocks without changing their snapshot', () => {
  const game = new GameEngine({ randomSeed: 11 });
  game.start();
  const events = game.update(2700);
  const spawned = events.filter((event) => event.type === 'blockSpawned');
  expect(spawned.length).toBeGreaterThan(0);
  expect(spawned[0]).toMatchObject({
    type: 'blockSpawned',
    block: { id: expect.any(Number), lane: expect.any(Number), color: expect.any(String), distance: 520 },
  });
  expect(game.getSnapshot().falling).toContainEqual(spawned[0]!.block);
});
```

Extend the collection test in `GameProgression.test.ts`:

```ts
expect(landed).toContainEqual({
  type: 'bonusCollected',
  bonus: 'colorBreak',
  token: expect.objectContaining({ id: expect.any(Number), type: 'colorBreak', lane: expect.any(Number), distance: 72 }),
});
```

- [ ] **Step 2: Run focused tests and verify missing event data**

Run: `npm run test:run -- tests/GameEngine.test.ts tests/GameProgression.test.ts`

Expected: FAIL because `blockSpawned` is absent and `bonusCollected.token` is absent.

- [ ] **Step 3: Extend `GameEvent`**

```ts
export type GameEvent =
  | DirectorEvent
  | { readonly type: 'blockSpawned'; readonly block: FallingBlock }
  // existing events
  | { readonly type: 'bonusCollected'; readonly bonus: BonusType; readonly token: FallingBonus };
```

- [ ] **Step 4: Emit spawn descriptions from production spawning only**

Change the helper to:

```ts
private spawn(requests: readonly SpawnRequest[], events?: GameEvent[]): void {
  // build anomaly-decorated block exactly as before
  const frozen = Object.freeze({ ...block });
  this.falling.push(frozen);
  this.fallingBornAt.set(frozen.id, this.motionElapsedMs);
  events?.push(Object.freeze({ type: 'blockSpawned', block: frozen }));
}
```

Call `this.spawn(requests, events)` from the production update loop. Keep
`debugSpawn(request)` on `this.spawn([request])` so a test helper does not leak an
event outside `update()`.

- [ ] **Step 5: Emit the frozen final token on collection**

In `moveAndCollectBonuses`, emit:

```ts
const token = Object.freeze({ ...moved, distance: HEX_APOTHEM });
events.push(Object.freeze({ type: 'bonusCollected', bonus: collection.collected, token }));
```

The collection threshold remains `HEX_APOTHEM`; no timing or inventory code changes.

- [ ] **Step 6: Update exact event fixtures, run the engine gate, and commit**

Run: `npm run test:run -- tests/GameEngine.test.ts tests/GameProgression.test.ts tests/GameRuntime.test.ts tests/EndlessRun.test.ts`

Expected: all tests pass and equivalent frame sequences still match.

```powershell
git add src/game/types.ts src/game/GameEngine.ts tests/GameEngine.test.ts tests/GameProgression.test.ts tests/GameRuntime.test.ts tests/ProgressionEffects.test.ts tests/EndlessRun.test.ts
git commit -m "feat: describe block spawns and bonus collection origins"
```

---

### Task 4: Readable Bonus HUD and Notifications

**Files:**
- Modify: `src/ui/ScreenController.ts`
- Modify: `src/styles.css`
- Modify: `tests/ScreenController.test.ts`

**Interfaces:**
- Consumes: `GameSnapshot`, `PresentationSnapshot`, and shared bonus metadata.
- Produces: `ScreenController.render(snapshot, presentation)` with stable live-region notification, bonus slot, replacement state, and SLOW rule.

- [ ] **Step 1: Add failing semantic HUD tests**

Create an empty presentation helper in `ScreenController.test.ts` and change calls
to pass it. Add:

```ts
it('shows acquisition copy, a readable slot command, attention, and slow time', () => {
  const screen = new ScreenController(root);
  const presentation = {
    notice: Object.freeze({ title: 'SLOW ACQUIRED', body: 'SLOWS FALLING BLOCKS FOR 6 SECONDS', tone: 'sky' as const, priority: 3 as const, ageMs: 0, lifetimeMs: 900, assertive: false }),
    queuedNotices: Object.freeze([]), transfer: null,
    slotAttentionRemainingMs: 2500, replacedBonus: null,
  };
  screen.render(snapshot({ mode: 'playing', bonus: { stored: 'slow', slowRemainingMs: 4200 } }), presentation);
  expect(root.querySelector('[role="status"]')?.textContent).toContain('SLOW ACQUIRED');
  expect(root.querySelector('[role="status"]')?.textContent).toContain('SLOWS FALLING BLOCKS FOR 6 SECONDS');
  expect(root.querySelector('.bonus-slot')?.textContent).toContain('SPACE');
  expect(root.querySelector('.bonus-slot')?.textContent).toContain('ACTIVATE');
  expect(root.querySelector('.bonus-slot')?.classList.contains('attention')).toBe(true);
  expect(root.querySelector('[aria-label="Slow remaining"]')?.getAttribute('aria-valuenow')).toBe('4200');
});
```

Add a second test that renders the same presentation twice and asserts the same
`.presentation-notice` and `.bonus-slot` element objects are preserved. Then
render empty inventory/presentation and assert both are removed without moving
focus from the pause button.

- [ ] **Step 2: Run the UI test and verify the old signature/markup fails**

Run: `npm run test:run -- tests/ScreenController.test.ts`

Expected: FAIL on the second render argument and missing copy/key/timer markup.

- [ ] **Step 3: Change the render contract and create stable hosts**

```ts
public render(snapshot: GameSnapshot, presentation: PresentationSnapshot): void
```

On entry to playing mode, create these stable hosts once:

```html
<div class="bonus-host"></div>
<div class="anomaly-host"></div>
<div class="presentation-host" aria-live="polite" aria-atomic="true"></div>
```

Render critical notices with `role="alert"`; ordinary notices use
`role="status"`. Update hosts only when their exact serialized markup changes.

- [ ] **Step 4: Render the horizontal bonus slot and SLOW rule**

Occupied slot markup contains the shared glyph, full label, description-free
command `SPACE — ACTIVATE`, `data-tone`, and `attention` only while
`slotAttentionRemainingMs > 0`. For SLOW, render a progressbar with `max=6000`,
`aria-valuenow=slowRemainingMs`, and a CSS custom property computed as
`slowRemainingMs / 6000`.

- [ ] **Step 5: Replace the old vertical slot CSS**

Use a clipped matte horizontal slot at the lower-right safe area, with a 34 px
glyph, full label, and mono command. Add keyframes for one restrained scale/rule
pulse and notice entrance/exit. Under reduced motion set animation duration to
1 ms and remove translation.

- [ ] **Step 6: Run UI tests and commit**

Run: `npm run test:run -- tests/ScreenController.test.ts`

Expected: all semantic, focus, stable-DOM, and upgrade tests pass.

```powershell
git add src/ui/ScreenController.ts src/styles.css tests/ScreenController.test.ts
git commit -m "feat: make bonus inventory and activation readable"
```

---

### Task 5: Spawn Assembly and Authored Fracture Effects

**Files:**
- Modify: `src/render/EffectsSystem.ts`
- Modify: `tests/EffectsSystem.test.ts`
- Modify: `tests/ProgressionEffects.test.ts`

**Interfaces:**
- Consumes: `blockSpawned`, `matchCleared`, `bonusActivated`, `bonusRemoved`, and `bonusCollected` events plus orientation context.
- Produces: bounded `assemblies`, deterministic polygon `fragments`, `bonusImpact`, and existing impact channels in `EffectsSnapshot`.

- [ ] **Step 1: Write failing effect-model tests**

```ts
it('assembles a spawned block for 180ms and expires it', () => {
  const effects = new EffectsSystem({ random: () => 0.5 });
  effects.consume([{ type: 'blockSpawned', block: { id: 9, lane: 2, color: 'teal', distance: 520, speed: 150 } }]);
  expect(effects.snapshot().assemblies).toEqual([
    { blockId: 9, lane: 2, color: 'teal', ageMs: 0, lifetimeMs: 180 },
  ]);
  effects.update(180);
  expect(effects.snapshot().assemblies).toEqual([]);
});

it('creates deterministic fracture fragments after anticipation', () => {
  const effects = new EffectsSystem({ random: () => 0.5 });
  effects.consume([{ type: 'matchCleared', cells: [{ side: 0, index: 0 }], color: 'coral', chain: 1 }]);
  expect(effects.snapshot().fragments).toHaveLength(8);
  expect(effects.snapshot().fragments[0]).toMatchObject({
    color: 'coral', ageMs: 0, lifetimeMs: 700, anticipationMs: 70,
  });
});

it('distinguishes empty activation from removal and keeps all channels bounded', () => {
  const effects = new EffectsSystem({ random: () => 0.5 });
  effects.consume([{ type: 'bonusActivated', bonus: 'cleanse' }]);
  expect(effects.snapshot().bonusImpact).toMatchObject({ bonus: 'cleanse', removedCount: 0 });
  expect(effects.snapshot().fragments).toEqual([]);
  effects.consume(Array.from({ length: 40 }, () => ({ type: 'matchCleared' as const, cells: [{ side: 0, index: 0 }], color: 'sky' as const, chain: 4 })));
  expect(effects.snapshot().fragments.length).toBeLessThanOrEqual(180);
});
```

- [ ] **Step 2: Run focused tests and verify new channels are absent**

Run: `npm run test:run -- tests/EffectsSystem.test.ts tests/ProgressionEffects.test.ts`

Expected: FAIL on `assemblies`, `fragments`, and `bonusImpact`.

- [ ] **Step 3: Add immutable bounded effect types**

```ts
export interface BlockAssembly {
  readonly blockId: number;
  readonly lane: number;
  readonly color: BlockColor;
  readonly ageMs: number;
  readonly lifetimeMs: 180;
}

export interface FractureFragment {
  readonly x: number; readonly y: number;
  readonly vx: number; readonly vy: number;
  readonly rotation: number; readonly spin: number;
  readonly size: number; readonly color: BlockColor;
  readonly ageMs: number; readonly lifetimeMs: number;
  readonly anticipationMs: 70;
}

export interface BonusImpact {
  readonly bonus: BonusType;
  readonly removedCount: number;
  readonly ageMs: number;
  readonly lifetimeMs: 620;
}
```

Add `assemblies`, `fragments`, and `bonusImpact` to `EffectsSnapshot`. Cap
assemblies at 36 and fragments at 180. Freeze all nested snapshot values.

- [ ] **Step 4: Implement assembly and deterministic fracture creation**

On `blockSpawned`, append a 180 ms assembly. On `matchCleared`, generate eight
fragments per cell for chain 1 and `Math.min(12, 8 + chain)` for later chains.
Use the injected random function for angle variance and fragment size. During
the 70 ms anticipation, update only age; after anticipation, integrate velocity,
rotation, and a small outward acceleration. Replace the old square-particle
creation for normal matches so one clear does not draw two fragment systems.
Update legacy tests that assert `particles` for a clear to assert the equivalent
`fragments`; bonus and Last Stand channels that still intentionally use existing
particles retain their original assertions.

- [ ] **Step 5: Implement bonus identities without changing removed cells**

`bonusActivated` creates `bonusImpact` even when no `bonusRemoved` follows.
`bonusRemoved` generates fragments from its exact `cells` and `blocks` in their
existing array order:

- PULSE: fragment velocity points radially away from the hub.
- CLEANSE: add `index * 28 ms` to anticipation for outside-to-inside sequence.
- COLOR BREAK: add `(arrayIndex % 4) * 24 ms` to release in deterministic waves.
- SLOW: no fragments; create only its cool screen/ring impact.

- [ ] **Step 6: Implement reduced motion, update, expiry, and reset**

Reduced motion returns no assemblies/fragments, retains `bonusImpact` identity,
and suppresses hit stop/shake. Update caps each time step at 50 ms and expires
all channels. Reset produces empty arrays and null bonus impact.

- [ ] **Step 7: Run affected tests and commit**

Run: `npm run test:run -- tests/EffectsSystem.test.ts tests/ProgressionEffects.test.ts`

Expected: all legacy impact contracts and new bounded channels pass.

```powershell
git add src/render/EffectsSystem.ts tests/EffectsSystem.test.ts tests/ProgressionEffects.test.ts
git commit -m "feat: add block assembly and fracture effect models"
```

---

### Task 6: Render Assembly, Transfer, and Bonus-Specific Destruction

**Files:**
- Modify: `src/render/CanvasRenderer.ts`
- Modify: `tests/CanvasRenderer.test.ts`
- Modify: `tests/ProgressionRenderer.test.ts`

**Interfaces:**
- Consumes: `EffectsSnapshot` from Task 5, `PresentationSnapshot` from Task 2, shared bonus metadata, and current `GameSnapshot`.
- Produces: `CanvasRenderer.render(snapshot, effects, presentation, alpha)` with no inferred game rules.

- [ ] **Step 1: Add failing draw-operation contracts**

Extend the mock canvas context to record `lineTo`, `arc`, `rotate`, `scale`,
`globalAlpha`, and `fillText`. Add tests that:

```ts
renderer.render(gameSnapshotWithSpawnedBlock, effectsWithAssembly, emptyPresentation, 0);
expect(context.scale).toHaveBeenCalledWith(expect.closeTo(0.72, 2), expect.closeTo(0.72, 2));

renderer.render(gameSnapshotWithPulseRemoval, pulseEffects, emptyPresentation, 0);
expect(context.stroke).toHaveBeenCalled();
expect(context.fillRect.mock.calls.length).toBeGreaterThan(0);

renderer.render(gameSnapshotWithBonus, effects, presentationWithTransfer, 0);
expect(context.fillText).toHaveBeenCalledWith('⌁', expect.any(Number), expect.any(Number));
```

Also assert a reduced-motion effect snapshot performs no assembly transform or
fragment translation. Update every existing renderer call with a shared frozen
empty `PresentationSnapshot` fixture so the new signature remains explicit.

- [ ] **Step 2: Run renderer tests and verify the signature/effects are missing**

Run: `npm run test:run -- tests/CanvasRenderer.test.ts tests/ProgressionRenderer.test.ts`

Expected: FAIL on the fourth render argument and missing assembly/fragment calls.

- [ ] **Step 3: Render 180 ms block assembly**

For a falling block with an active assembly, draw two or three faceted pieces
converging toward the normal `blockQuad`; interpolate scale from 0.72 to 1 and
opacity from 0 to 1 with the existing easing function. Draw one thin spawn-edge
guide line and a short trail. When no assembly exists, call the existing plate
path unchanged.

- [ ] **Step 4: Render bonus tokens and collection transfer**

Use shared glyphs and distinct token facet arrangements. For transfer age
240–650 ms, map progress to a quadratic curve from the collected lane/distance
world point to the center of the bonus slot safe area. Fade the world copy out
over the last 120 ms. The DOM slot appears independently from the game snapshot,
so a missing transfer never hides inventory.

- [ ] **Step 5: Render anticipation, fractures, and bonus identities**

Before a fragment's `anticipationMs`, draw each source plate once at contracting
scale with one deterministic seam. Afterwards draw a 3–5 point matte polygon
at fragment position/rotation with a light leading edge and dark trailing edge.
Use `bonusImpact` to select only these visual overlays:

- SLOW: cool hex wave and lengthened falling trails.
- PULSE: expanding concentric central hexes.
- CLEANSE: narrow traveling cut line on the target side.
- COLOR BREAK: synchronized color-tone flash before fragment release.

- [ ] **Step 6: Run renderer and full visual-model tests, then commit**

Run: `npm run test:run -- tests/CanvasRenderer.test.ts tests/ProgressionRenderer.test.ts tests/ProgressionEffects.test.ts`

Expected: bounded draw contracts pass with unchanged world geometry assertions.

```powershell
git add src/render/CanvasRenderer.ts tests/CanvasRenderer.test.ts tests/ProgressionRenderer.test.ts
git commit -m "feat: render expressive arrivals and destruction"
```

---

### Task 7: Runtime Integration, Documentation, and Browser QA

**Files:**
- Modify: `src/main.ts`
- Modify: `tests/GameRuntime.test.ts`
- Modify: `README.md`
- Modify: `progress.md`
- Modify: `tests/Distribution.test.ts` only if explicit file fixtures need new presentation paths.

**Interfaces:**
- Consumes: completed `PresentationSystem`, `EffectsSystem`, renderer, screen controller, engine events, and runtime callbacks.
- Produces: reset-safe production composition and verified static distribution.

- [ ] **Step 1: Add a failing production-composition contract**

Add a focused integration test around the callback order used by `main.ts`:

```ts
expect(order).toEqual([
  'engine-events', 'presentation-consume', 'effects-consume',
  'engine-snapshot', 'presentation-update', 'effects-update',
  'canvas-render', 'screen-render',
]);
```

Extend the reset test to populate a collection notice, transfer, fragments, and
slot attention, call the shared reset path, and expect both system snapshots to
be empty before the immediate flush render.

- [ ] **Step 2: Run the integration test and verify presentation is not composed**

Run: `npm run test:run -- tests/GameRuntime.test.ts`

Expected: FAIL because production composition does not own a presentation system.

- [ ] **Step 3: Compose and reset `PresentationSystem` in `main.ts`**

```ts
const presentation = new PresentationSystem();
let presentationSnapshot = presentation.snapshot();

onEvents: (events) => {
  // preserve existing reset detection
  presentation.consume(events);
  effects.consume(events, { orientation: snapshot.orientation });
  presentationSnapshot = presentation.snapshot();
  effectsSnapshot = effects.snapshot();
},
onStep: (ms) => {
  snapshot = engine.getSnapshot();
  if (snapshot.mode === 'playing') {
    presentation.update(ms);
    effects.update(ms);
  }
  presentationSnapshot = presentation.snapshot();
  effectsSnapshot = effects.snapshot();
},
render: (alpha) => {
  renderer.render(snapshot, effectsSnapshot, presentationSnapshot, alpha);
  screens.render(snapshot, presentationSnapshot);
},
```

Reset presentation beside effects in `resetSession` and on elapsed/menu rollback.
Pause and upgrade modes skip both updates.

- [ ] **Step 4: Update documentation and distribution coverage**

README must explain the visible bonus token, acquisition notice, stable
`SPACE — ACTIVATE` slot, SLOW timer, and reduced-motion behavior. Extend the
distribution fixture to compare:

```ts
'src/presentation/bonusPresentation.ts'
'src/presentation/PresentationSystem.ts'
'tests/BonusPresentation.test.ts'
'tests/PresentationSystem.test.ts'
'docs/superpowers/specs/2026-09-18-hextris-gameplay-feedback-design.md'
'docs/superpowers/plans/2026-09-18-hextris-gameplay-feedback.md'
```

- [ ] **Step 5: Run the complete automated gate**

Run:

```powershell
npm run test:run
npm run typecheck
npm run build
git diff --check
```

Expected: zero failed tests, TypeScript exit 0, Vite/source packaging exit 0,
and all new source/spec/plan files present under `dist/source/`.

- [ ] **Step 6: Run browser QA with real controls and deterministic stepping**

Start `npm run dev -- --host 127.0.0.1`. At 1280×720 and 1920×1080 capture and
inspect normal assembly, bonus token, acquisition/transfer, occupied slot,
replacement, all four activations, normal clear, chain, empty removal, pause
freeze, retry/menu reset, and dense late-cycle play. Repeat acquisition,
activation, and destruction with reduced motion. Use only normal controls and
the existing public `window.advanceTime(ms)` hook. Final console warning/error
list must be `[]`.

- [ ] **Step 7: Record evidence and commit**

Append exact test counts, commands, viewport sizes, capture paths, console
result, and consciously deferred polish to `progress.md`.

```powershell
git add src/main.ts tests/GameRuntime.test.ts README.md progress.md tests/Distribution.test.ts
git commit -m "feat: integrate readable gameplay feedback"
```

---

## Final Verification Gate

- [ ] Every bonus type has shared label, description, glyph, and tone metadata.
- [ ] A first-time player can follow token → acquisition → slot → SPACE → effect → empty slot.
- [ ] Replacement explicitly names both old and new bonuses.
- [ ] Spawn assembly and fracture motion are bounded and deterministic.
- [ ] Empty removals never create fake fragments.
- [ ] Pause/upgrade freeze and menu/retry reset every transient channel.
- [ ] Reduced motion retains all essential copy and controls.
- [ ] Full tests, typecheck, build, source packaging, diff check, and browser console pass.
