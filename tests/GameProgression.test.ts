import { describe, expect, it } from 'vitest';
import { GameEngine } from '../src/game/GameEngine';
import { HexGrid } from '../src/game/HexGrid';
import type { GameEvent } from '../src/game/types';

function progressionGame(randomSeed = 1): GameEngine {
  return new GameEngine({ randomSeed, spawning: false, maxStackDepth: 20 });
}

function assertDeepFrozen(value: unknown): void {
  if (value === null || typeof value !== 'object') return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const nested of Object.values(value)) assertDeepFrozen(nested);
}

function untilEvent(game: GameEngine, type: GameEvent['type']): readonly GameEvent[] {
  for (let elapsed = 0; elapsed < 90_000; elapsed += 50) {
    const events = game.update(50);
    if (events.some((event) => event.type === type)) return events;
  }
  throw new Error(`No ${type} event within 90 active seconds`);
}

describe('GameEngine threat progression', () => {
  it('keeps seeded gameplay, landings, and combo scoring independent of public update chunks', () => {
    const run = (steps: readonly number[]) => {
      const game = new GameEngine({ randomSeed: 6 });
      game.start();
      for (const step of steps) game.update(step);
      return game.getSnapshot();
    };

    const large = run([20_000]);
    const split = run(Array.from({ length: 200 }, () => 100));
    expect(large.score).toBe(split.score);
    expect(large.combo).toBe(split.combo);
    expect(large.stacks).toEqual(split.stacks);
  });

  it('continues through the first two cycles and offers an upgrade only after the third', () => {
    const game = new GameEngine({ spawning: false });
    game.start();

    const first = game.update(75_000);
    expect(first).toContainEqual({ type: 'cycleCompleted', cycle: 1, atActiveMs: 75_000 });
    expect(first.some(({ type }) => type === 'upgradeOffered')).toBe(false);
    expect(game.getSnapshot()).toMatchObject({ mode: 'playing', cycle: { number: 2, phase: 'settle' } });

    const second = game.update(75_000);
    expect(second).toContainEqual({ type: 'cycleCompleted', cycle: 2, atActiveMs: 150_000 });
    expect(second.some(({ type }) => type === 'upgradeOffered')).toBe(false);
    expect(game.getSnapshot()).toMatchObject({ mode: 'playing', cycle: { number: 3, phase: 'settle' } });

    const third = game.update(75_000);
    expect(third).toEqual(expect.arrayContaining([
      { type: 'cycleCompleted', cycle: 3, atActiveMs: 225_000 },
      expect.objectContaining({ type: 'upgradeOffered' }),
    ]));
    expect(game.getSnapshot().mode).toBe('upgrade');
  });

  it('resumes exactly once into cycle four when confirming the third-cycle upgrade', () => {
    const game = new GameEngine({ spawning: false });
    game.start();
    game.update(225_000);
    expect(game.getSnapshot()).toMatchObject({ mode: 'upgrade', cycle: { number: 3, elapsedMs: 75_000 } });

    game.enqueue({ type: 'confirmUpgrade' });
    const events = game.update(0);

    expect(events).toContainEqual(expect.objectContaining({ type: 'upgradeSelected' }));
    expect(game.getSnapshot()).toMatchObject({ mode: 'playing', cycle: { number: 4, phase: 'settle', elapsedMs: 0 } });
  });

  it('keeps the deprecated cycle option as a director compatibility alias', () => {
    const game = new GameEngine({
      spawning: false,
      cycle: { forcedAnomaliesByCycle: { 2: ['reverse'] } },
    });
    game.start();
    game.update(75_000);
    for (let elapsedMs = 0; elapsedMs < 42_000 && game.getSnapshot().cycle.warning.length === 0; elapsedMs += 1_000) {
      game.update(1_000);
    }

    expect(game.getSnapshot().cycle.warning).toEqual(['reverse']);
  });

  it('lands scheduled bonus tokens into the one-slot inventory without adding a stack block', () => {
    const game = progressionGame(1); game.start();
    expect(untilEvent(game, 'bonusScheduled')).toContainEqual(expect.objectContaining({ type: 'bonusScheduled' }));
    expect(untilEvent(game, 'bonusCollected')).toContainEqual(expect.objectContaining({ type: 'bonusCollected', bonus: 'colorBreak' }));
    expect(game.getSnapshot()).toMatchObject({ bonus: { stored: 'colorBreak' }, fallingBonuses: [] });
    expect(game.getSnapshot().stacks.every((stack) => stack.length === 0)).toBe(true);
  });

  it('replaces an occupied bonus slot when the next scheduled token lands', () => {
    const game = progressionGame(1); game.start();
    untilEvent(game, 'bonusCollected');
    expect(untilEvent(game, 'bonusReplaced')).toContainEqual({ type: 'bonusReplaced', previous: 'colorBreak', replacement: 'slow' });
    expect(game.getSnapshot().bonus.stored).toBe('slow');
  });

  it('activates a removal bonus before overflow and consumes an empty removal bonus', () => {
    const game = progressionGame(1); game.start(); untilEvent(game, 'bonusCollected');
    game.debugAttachGroup('coral', [{ side: 0, count: 2 }]); game.enqueue({ type: 'activateBonus' });
    expect(game.update(0).map(({ type }) => type)).toEqual(['bonusActivated', 'bonusRemoved']);
    expect(game.getSnapshot().stacks[0]).toEqual([]);
    untilEvent(game, 'bonusCollected'); game.enqueue({ type: 'activateBonus' });
    expect(game.update(0)).toEqual([{ type: 'bonusActivated', bonus: 'slow' }]);
  });

  it('keeps director active time moving while SLOW reduces falling motion', () => {
    const game = progressionGame(3); game.start(); game.update(40_845); game.update(3_000);
    game.enqueue({ type: 'activateBonus' }); game.update(0); game.debugSpawn({ lane: 0, color: 'coral', speed: 100 });
    const before = game.getSnapshot().cycle.elapsedMs; game.update(1_000);
    expect(game.getSnapshot().falling[0]?.distance).toBe(465);
    expect(game.getSnapshot().cycle.elapsedMs).toBe(before + 1_000);
    expect(game.getSnapshot().bonus.slowRemainingMs).toBe(5_000);
  });

  it('consumes Last Stand before deciding game over', () => {
    const game = new GameEngine({ randomSeed: 14, spawning: false, maxStackDepth: 2 });
    game.start(); game.update(225_000); expect(game.getSnapshot().upgrades.choices[0]?.id).toBe('lastStand');
    game.enqueue({ type: 'confirmUpgrade' }); game.update(0); game.debugAttachGroup('coral', [{ side: 2, count: 2 }]);
    expect(game.update(0)).toContainEqual(expect.objectContaining({ type: 'lastStand', side: 2 }));
    expect(game.getSnapshot()).toMatchObject({ mode: 'playing', upgrades: { levels: { lastStand: 0 } } });
  });

  it('still ends the game if Last Stand leaves another overflowing side', () => {
    const game = new GameEngine({ randomSeed: 14, spawning: false, maxStackDepth: 2 });
    game.start(); game.update(225_000); game.enqueue({ type: 'confirmUpgrade' }); game.update(0);
    game.debugAttachGroup('coral', [{ side: 0, count: 2 }]); game.debugAttachGroup('amber', [{ side: 1, count: 2 }]);
    expect(game.update(0).map(({ type }) => type)).toEqual(['lastStand', 'gameOver']);
  });

  it('applies queued upgrade selection before queued confirmation', () => {
    const game = new GameEngine({ randomSeed: 1, spawning: false }); game.start(); game.update(225_000);
    const second = game.getSnapshot().upgrades.choices[1]!.id;
    game.enqueue({ type: 'selectUpgrade', steps: 1 }); game.enqueue({ type: 'confirmUpgrade' });
    const events = game.update(0);
    expect(events).toContainEqual({ type: 'upgradeSelectionChanged', selectedIndex: 1 });
    expect(events).toContainEqual({ type: 'upgradeSelected', upgrade: second, level: 1 });
    expect(game.getSnapshot()).toMatchObject({ mode: 'playing', cycle: { number: 4 } });
  });

  it('does not replace immediate game over with an upgrade offer', () => {
    const game = new GameEngine({ spawning: false, maxStackDepth: 2 }); game.start();
    game.debugAttachGroup('coral', [{ side: 0, count: 2 }]);
    const events = game.update(1);
    expect(events.some(({ type }) => type === 'upgradeOffered')).toBe(false);
    expect(events.at(-1)).toEqual({ type: 'gameOver', score: 0 });
  });

  it('awards cycle value and auto-continues after all upgrades are exhausted', () => {
    const game = new GameEngine({ randomSeed: 1, spawning: false, maxStackDepth: 100 }); game.start();
    for (let offer = 1; offer <= 15; offer += 1) {
      game.update(225_000);
      expect(game.getSnapshot().mode).toBe('upgrade');
      game.enqueue({ type: 'confirmUpgrade' }); game.update(0);
    }
    const events = game.update(225_000);
    expect(events).toContainEqual({ type: 'cycleCompleted', cycle: 48, atActiveMs: 3_600_000 });
    expect(game.getSnapshot()).toMatchObject({ mode: 'playing', score: 4_800, cycle: { number: 49 } });
  });

  it('applies the permanent combo-window modifier to later natural matches', () => {
    const game = new GameEngine({ randomSeed: 23, spawning: false, maxStackDepth: 100 }); game.start();
    game.update(225_000); expect(game.getSnapshot().upgrades.choices[0]?.id).toBe('comboRelay');
    game.enqueue({ type: 'confirmUpgrade' }); game.update(0); game.debugAttachGroup('coral', [{ side: 0, count: 3 }]);
    game.update(0); game.update(1_300); game.debugAttachGroup('sky', [{ side: 3, count: 3 }]); game.update(0);
    expect(game.getSnapshot()).toMatchObject({ combo: 2, score: 27 });
  });

  it('freezes progression while paused and resets all run state', () => {
    const game = progressionGame(3); game.start(); game.update(40_845); game.update(3_000);
    game.enqueue({ type: 'togglePause' }); game.update(0); const paused = game.getSnapshot(); game.update(5_000);
    expect(game.getSnapshot()).toEqual(paused); game.restart();
    expect(game.getSnapshot()).toMatchObject({ mode: 'playing', score: 0, elapsedMs: 0, cycle: { number: 1, phase: 'settle', elapsedMs: 0 } });
    game.returnToMenu(); expect(game.getSnapshot().mode).toBe('menu');
  });

  it('keeps progression snapshots and event payloads deeply immutable', () => {
    const game = progressionGame(1); game.start(); const events = game.update(32_517);
    assertDeepFrozen(events); assertDeepFrozen(game.getSnapshot());
  });

  it('keeps SLOW expiry deterministic across one large or split update', () => {
    const run = (steps: readonly number[]) => {
      const game = progressionGame(3); game.start(); game.update(40_845); game.update(3_000);
      game.enqueue({ type: 'activateBonus' }); game.update(0); game.debugSpawn({ lane: 0, color: 'coral', speed: 10 });
      steps.forEach((step) => game.update(step)); return game.getSnapshot();
    };
    expect(run([6_000])).toEqual(run([2_000, 2_000, 2_000]));
  });

  it('keeps spawning and bonus scheduling deterministic across caller chunks', () => {
    const run = (steps: readonly number[]) => {
      const game = new GameEngine({ randomSeed: 37, spawning: true, maxStackDepth: 100 }); game.start();
      return { events: steps.flatMap((step) => game.update(step)), snapshot: game.getSnapshot() };
    };
    expect(run([8_200])).toEqual(run([1_640, 1_640, 1_640, 1_640, 1_640]));
  });

  it('validates grid removals before mutation and freezes removed blocks', () => {
    const grid = new HexGrid(); grid.attach(0, { id: 1, color: 'coral' }); grid.attach(1, { id: 2, color: 'amber' });
    const before = grid.snapshot();
    expect(() => grid.remove([{ side: 0, index: 0 }, { side: 0, index: 0 }])).toThrow('Duplicate cell');
    expect(grid.snapshot()).toEqual(before); const removed = grid.remove([{ side: 1, index: 0 }]);
    expect(removed).toEqual([{ id: 2, color: 'amber' }]); assertDeepFrozen(removed);
  });
});
