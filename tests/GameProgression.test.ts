import { describe, expect, it } from 'vitest';
import { GameEngine } from '../src/game/GameEngine';
import { HexGrid } from '../src/game/HexGrid';

function progressionGame(randomSeed = 1): GameEngine {
  return new GameEngine({
    randomSeed,
    spawning: false,
    maxStackDepth: 20,
    cycle: { flowMs: 100_000, pressureMs: 1_000, surgeMs: 1_000 },
  });
}

function assertDeepFrozen(value: unknown): void {
  if (value === null || typeof value !== 'object') return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const nested of Object.values(value)) assertDeepFrozen(nested);
}

describe('GameEngine endless progression', () => {
  it('freezes at cycle completion until a permanent upgrade is selected', () => {
    const game = new GameEngine({
      spawning: false,
      cycle: { flowMs: 30, pressureMs: 15, surgeMs: 10 },
    });
    game.start();

    const events = game.update(55);

    expect(events).toEqual(expect.arrayContaining([
      { type: 'phaseChanged', phase: 'pressure', cycle: 1 },
      { type: 'phaseChanged', phase: 'surge', cycle: 1 },
      { type: 'cycleCompleted', cycle: 1 },
      expect.objectContaining({ type: 'upgradeOffered' }),
    ]));
    expect(game.getSnapshot().mode).toBe('upgrade');
    expect(game.getSnapshot().upgrades.choices).toHaveLength(2);
    const frozen = game.getSnapshot().elapsedMs;
    game.update(5_000);
    expect(game.getSnapshot().elapsedMs).toBe(frozen);
    game.enqueue({ type: 'confirmUpgrade' });
    const selected = game.update(0);
    expect(selected).toContainEqual(expect.objectContaining({ type: 'upgradeSelected' }));
    expect(game.getSnapshot()).toMatchObject({ mode: 'playing', cycle: { number: 2, phase: 'flow' } });
  });

  it('lands a scheduled token in the one-slot inventory without entering a stack', () => {
    const game = progressionGame(1);
    game.start();

    const scheduled = game.update(32_517);

    expect(scheduled).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'bonusScheduled', bonus: expect.objectContaining({ type: 'colorBreak' }) }),
    ]));
    expect(game.getSnapshot().fallingBonuses).toEqual([
      expect.objectContaining({ type: 'colorBreak', distance: 520 }),
    ]);
    const landed = game.update(3_000);
    expect(landed).toContainEqual({ type: 'bonusCollected', bonus: 'colorBreak' });
    expect(game.getSnapshot()).toMatchObject({ bonus: { stored: 'colorBreak' }, fallingBonuses: [] });
    expect(game.getSnapshot().stacks.every((stack) => stack.length === 0)).toBe(true);
  });

  it('replaces the occupied bonus slot when another token lands', () => {
    const game = progressionGame(1);
    game.start();
    game.update(32_517);
    game.update(3_000);
    game.update(26_984);

    const events = game.update(3_000);

    expect(events).toEqual(expect.arrayContaining([
      { type: 'bonusCollected', bonus: 'slow' },
      { type: 'bonusReplaced', previous: 'colorBreak', replacement: 'slow' },
    ]));
    expect(game.getSnapshot().bonus.stored).toBe('slow');
  });

  it('activates a removal bonus before overflow and leaves combo timing isolated', () => {
    const game = new GameEngine({
      randomSeed: 1,
      spawning: false,
      maxStackDepth: 2,
      cycle: { flowMs: 100_000, pressureMs: 1_000, surgeMs: 1_000 },
    });
    game.start();
    game.update(32_517);
    game.update(3_000); // Seed 1 deterministically stores COLOR BREAK.
    game.debugAttachGroup('coral', [{ side: 0, count: 2 }]);
    game.enqueue({ type: 'activateBonus' });

    const events = game.update(0);

    expect(events.map((event) => event.type)).toEqual(['bonusActivated', 'bonusRemoved']);
    expect(game.getSnapshot()).toMatchObject({ mode: 'playing', score: 6, combo: 1 });
    expect(game.getSnapshot().stacks[0]).toEqual([]);
  });

  it('consumes a stored removal bonus even when every stack is empty', () => {
    const game = progressionGame(1);
    game.start();
    game.update(32_517);
    game.update(3_000); // Seed 1 deterministically stores COLOR BREAK.
    expect(game.getSnapshot().stacks.every((stack) => stack.length === 0)).toBe(true);
    game.enqueue({ type: 'activateBonus' });

    const events = game.update(0);

    expect(events).toEqual([{ type: 'bonusActivated', bonus: 'colorBreak' }]);
    expect(game.getSnapshot()).toMatchObject({ bonus: { stored: null }, score: 0, combo: 1 });
  });

  it('slows falling movement while director active time continues normally', () => {
    const game = progressionGame(3);
    game.start();
    game.update(40_845);
    game.update(3_000); // Seed 3 deterministically stores SLOW.
    game.enqueue({ type: 'activateBonus' });
    game.update(0);
    game.debugSpawn({ lane: 0, color: 'coral', speed: 100 });
    const cycleBefore = game.getSnapshot().cycle.elapsedMs;

    game.update(1_000);

    expect(game.getSnapshot().falling[0]?.distance).toBe(465);
    expect(game.getSnapshot().cycle.elapsedMs).toBe(cycleBefore + 1_000);
    expect(game.getSnapshot().bonus.slowRemainingMs).toBe(5_000);
  });

  it('consumes Last Stand and clears the tallest side before the game-over decision', () => {
    const game = new GameEngine({
      randomSeed: 14,
      spawning: false,
      maxStackDepth: 2,
      cycle: { flowMs: 1, pressureMs: 1, surgeMs: 1 },
    });
    game.start();
    game.update(3);
    expect(game.getSnapshot().upgrades.choices[0]?.id).toBe('lastStand');
    game.enqueue({ type: 'confirmUpgrade' });
    game.update(0);
    game.debugAttachGroup('coral', [{ side: 2, count: 2 }]);

    const events = game.update(0);

    expect(events).toContainEqual(expect.objectContaining({ type: 'lastStand', side: 2 }));
    expect(events.some((event) => event.type === 'gameOver')).toBe(false);
    expect(game.getSnapshot()).toMatchObject({ mode: 'playing', upgrades: { levels: { lastStand: 0 } } });
    expect(game.getSnapshot().stacks[2]).toEqual([]);
  });

  it('rechecks overflow after Last Stand when another side is also full', () => {
    const game = new GameEngine({
      randomSeed: 14,
      spawning: false,
      maxStackDepth: 2,
      cycle: { flowMs: 1, pressureMs: 1, surgeMs: 1 },
    });
    game.start();
    game.update(3);
    game.enqueue({ type: 'confirmUpgrade' });
    game.update(0);
    game.debugAttachGroup('coral', [{ side: 0, count: 2 }]);
    game.debugAttachGroup('amber', [{ side: 1, count: 2 }]);

    const events = game.update(0);

    expect(events.map((event) => event.type)).toEqual(['lastStand', 'gameOver']);
    expect(game.getSnapshot().mode).toBe('gameOver');
  });

  it('applies upgrade selection and confirmation commands in queue order', () => {
    const game = new GameEngine({
      randomSeed: 1,
      spawning: false,
      cycle: { flowMs: 1, pressureMs: 1, surgeMs: 1 },
    });
    game.start();
    game.update(3);
    const secondChoice = game.getSnapshot().upgrades.choices[1]!.id;
    game.enqueue({ type: 'selectUpgrade', steps: 1 });
    game.enqueue({ type: 'confirmUpgrade' });

    const events = game.update(0);

    expect(events).toContainEqual({ type: 'upgradeSelectionChanged', selectedIndex: 1 });
    expect(events).toContainEqual({ type: 'upgradeSelected', upgrade: secondChoice, level: 1 });
    expect(game.getSnapshot()).toMatchObject({ mode: 'playing', cycle: { number: 2 } });
  });

  it('does not replace game over with an upgrade when both happen in one step', () => {
    const game = new GameEngine({
      spawning: false,
      maxStackDepth: 2,
      cycle: { flowMs: 1, pressureMs: 1, surgeMs: 1 },
    });
    game.start();
    game.debugAttachGroup('coral', [{ side: 0, count: 2 }]);

    const events = game.update(3);

    expect(events.some((event) => event.type === 'upgradeOffered')).toBe(false);
    expect(events.at(-1)).toEqual({ type: 'gameOver', score: 0 });
    expect(game.getSnapshot().mode).toBe('gameOver');
  });

  it('awards completedCycle * 100 and immediately continues when all upgrades are maxed', () => {
    const game = new GameEngine({
      randomSeed: 1,
      spawning: false,
      maxStackDepth: 100,
      cycle: { flowMs: 1, pressureMs: 1, surgeMs: 1 },
    });
    game.start();
    let sawSingleton = false;
    for (let cycle = 1; cycle <= 15; cycle += 1) {
      game.update(3);
      expect(game.getSnapshot().mode).toBe('upgrade');
      const choices = game.getSnapshot().upgrades.choices;
      expect([1, 2]).toContain(choices.length);
      expect(new Set(choices.map((choice) => choice.id)).size).toBe(choices.length);
      sawSingleton ||= choices.length === 1;
      game.enqueue({ type: 'confirmUpgrade' });
      game.update(0);
    }
    expect(sawSingleton).toBe(true);

    const events = game.update(3);

    expect(events).toContainEqual({ type: 'cycleCompleted', cycle: 16 });
    expect(game.getSnapshot()).toMatchObject({ mode: 'playing', score: 1_600, cycle: { number: 17 } });
  });

  it('applies the permanent combo-window modifier to later natural matches', () => {
    const game = new GameEngine({
      randomSeed: 23,
      spawning: false,
      maxStackDepth: 100,
      cycle: { flowMs: 100_000, pressureMs: 1_000, surgeMs: 1_000 },
    });
    game.start();
    game.update(102_000);
    expect(game.getSnapshot().upgrades.choices[0]?.id).toBe('comboRelay');
    game.enqueue({ type: 'confirmUpgrade' });
    game.update(0);
    game.debugAttachGroup('coral', [{ side: 0, count: 3 }]);
    game.update(0);
    game.update(1_300);
    game.debugAttachGroup('sky', [{ side: 3, count: 3 }]);

    game.update(0);

    expect(game.getSnapshot()).toMatchObject({ combo: 2, score: 27 });
  });

  it('freezes cycle, bonus, and falling state while paused and resets the whole run', () => {
    const game = progressionGame(3);
    game.start();
    game.update(40_845);
    game.update(3_000);
    game.enqueue({ type: 'activateBonus' });
    game.update(0);
    game.debugSpawn({ lane: 0, color: 'coral', speed: 100 });
    game.enqueue({ type: 'togglePause' });
    game.update(0);
    const paused = game.getSnapshot();

    game.update(5_000);

    expect(game.getSnapshot()).toEqual(paused);
    game.restart();
    expect(game.getSnapshot()).toMatchObject({
      mode: 'playing', score: 0, combo: 1, elapsedMs: 0,
      cycle: { number: 1, phase: 'flow', elapsedMs: 0 },
      bonus: { stored: null, slowRemainingMs: 0 },
      fallingBonuses: [],
      upgrades: { choices: [], selectedIndex: 0 },
    });
    expect(Object.values(game.getSnapshot().upgrades.levels).every((level) => level === 0)).toBe(true);
    game.returnToMenu();
    expect(game.getSnapshot()).toMatchObject({ mode: 'menu', elapsedMs: 0, cycle: { number: 1 } });
  });

  it('keeps new snapshots and progression event payloads deeply immutable', () => {
    const game = progressionGame(1);
    game.start();
    const events = game.update(32_517);

    assertDeepFrozen(events);
    assertDeepFrozen(game.getSnapshot());
  });

  it('is deterministic for equal active time split into different fixed-size sequences', () => {
    const run = (steps: readonly number[]) => {
      const game = progressionGame(7);
      game.start();
      game.debugSpawn({ lane: 2, color: 'sky', speed: 100 });
      steps.forEach((step) => game.update(step));
      return game.getSnapshot();
    };

    expect(run([100, 100, 100, 100])).toEqual(run([50, 50, 50, 50, 50, 50, 50, 50]));
  });

  it('consumes only time through the upgrade boundary for large and split updates', () => {
    const run = (steps: readonly number[]) => {
      const game = new GameEngine({
        spawning: false,
        cycle: { flowMs: 30, pressureMs: 15, surgeMs: 10 },
      });
      game.start();
      game.debugSpawn({ lane: 0, color: 'coral', speed: 1_000 });
      steps.forEach((step) => game.update(step));
      return game.getSnapshot();
    };

    const large = run([5_000]);
    const split = run([55, 4_945]);

    expect(large).toEqual(split);
    expect(large.elapsedMs).toBe(55);
    expect(large.falling[0]?.distance).toBe(465);
  });

  it('integrates SLOW motion identically in one update or across its expiry boundary', () => {
    const run = (steps: readonly number[]) => {
      const game = progressionGame(3);
      game.start();
      game.update(40_845);
      game.update(3_000); // Seed 3 stores SLOW.
      game.enqueue({ type: 'activateBonus' });
      game.update(0);
      game.debugSpawn({ lane: 0, color: 'coral', speed: 10 });
      steps.forEach((step) => game.update(step));
      return game.getSnapshot();
    };

    const large = run([6_000]);
    const split = run([2_000, 2_000, 2_000]);

    expect(large).toEqual(split);
    expect(large.falling[0]?.distance).toBe(487);
    expect(large.bonus.slowRemainingMs).toBe(0);
  });

  it('keeps enabled spawning identical for large and split updates without pre-spawn motion', () => {
    const run = (steps: readonly number[]) => {
      const game = new GameEngine({
        randomSeed: 37,
        spawning: true,
        maxStackDepth: 100,
        cycle: { flowMs: 100_000, pressureMs: 1_000, surgeMs: 1_000 },
      });
      game.start();
      const events = steps.flatMap((step) => game.update(step));
      return { events, snapshot: game.getSnapshot() };
    };

    const large = run([8_200]);
    const split = run([1_640, 1_640, 1_640, 1_640, 1_640]);

    expect(large).toEqual(split);
    expect(large.snapshot.elapsedMs).toBe(8_200);
    expect(large.snapshot.falling.length).toBeGreaterThanOrEqual(2);
    const fallingIds = large.snapshot.falling.map((block) => block.id);
    expect(fallingIds).toEqual(
      Array.from({ length: fallingIds.length }, (_, index) => fallingIds[0]! + index),
    );
    expect(new Set(large.snapshot.falling.map((block) => block.distance)).size).toBeGreaterThanOrEqual(2);
  });

  it('schedules a bonus at its director boundary independent of public update chunks', () => {
    const run = (steps: readonly number[]) => {
      const game = progressionGame(1);
      game.start();
      const events = steps.flatMap((step) => game.update(step));
      return { events, snapshot: game.getSnapshot() };
    };

    const large = run([35_517]);
    const split = run([32_517, 3_000]);

    expect(large).toEqual(split);
    expect(large.snapshot).toMatchObject({
      elapsedMs: 35_517,
      bonus: { stored: 'colorBreak' },
      fallingBonuses: [],
    });
  });

  it('validates every explicit grid removal before mutating and freezes returned blocks', () => {
    const grid = new HexGrid();
    grid.attach(0, { id: 1, color: 'coral' });
    grid.attach(1, { id: 2, color: 'amber' });
    const before = grid.snapshot();

    expect(() => grid.remove([{ side: 0, index: 0 }, { side: 0, index: 0 }])).toThrow('Duplicate cell');
    expect(() => grid.remove([{ side: 1, index: 0 }, { side: 6, index: 0 }])).toThrow(RangeError);
    expect(grid.snapshot()).toEqual(before);

    const removed = grid.remove([{ side: 1, index: 0 }]);
    expect(removed).toEqual([{ id: 2, color: 'amber' }]);
    assertDeepFrozen(removed);
  });
});
