import { describe, expect, it } from 'vitest';
import { GameEngine } from '../src/game/GameEngine';

describe('GameEngine', () => {
  it('describes newly spawned blocks without changing their snapshot', () => {
    const game = new GameEngine({ randomSeed: 11 });
    game.start();

    const events = game.update(2600);
    const spawned = events.find((event) => event.type === 'blockSpawned');

    expect(spawned).toMatchObject({
      type: 'blockSpawned',
      block: {
        id: expect.any(Number), lane: expect.any(Number), color: expect.any(String), distance: 520,
      },
    });
    expect(game.getSnapshot().falling).toContainEqual(spawned?.block);
  });

  it('lands exactly at the occupied stack boundary, but not just before it', () => {
    const game = new GameEngine({ spawning: false });
    game.start();
    game.debugAttachGroup('sky', [{ side: 0, count: 1 }]);
    game.debugSpawn({ lane: 0, color: 'coral', speed: 1000 });
    // Spawn at 520, one existing 24-deep plate beyond the 72-unit hub: contact at 96.
    expect(game.update(423.5)).toEqual([]);
    expect(game.getSnapshot().falling[0]?.distance).toBe(96.5);
    expect(game.getSnapshot().stacks[0]).toHaveLength(1);
    expect(game.update(0.5)).toEqual([
      { type: 'blockLanded', block: { id: 2, color: 'coral' }, cell: { side: 0, index: 1 } },
    ]);
    expect(game.getSnapshot().falling).toEqual([]);
    expect(game.getSnapshot().stacks[0]).toHaveLength(2);
  });

  it('clears a landing at the overflow threshold before deciding game over', () => {
    const game = new GameEngine({ spawning: false, maxStackDepth: 3 });
    game.start();
    game.debugAttachGroup('coral', [{ side: 0, count: 2 }]);
    game.debugSpawn({ lane: 0, color: 'coral', speed: 1000 });
    const events = game.update(400); // 520 - 400 = 72 + 2 * 24: third plate lands.
    expect(events.map(event => event.type)).toEqual(['blockLanded', 'matchCleared', 'comboChanged']);
    expect(game.getSnapshot().mode).toBe('playing');
    expect(game.getSnapshot().score).toBe(9);
    expect(game.getSnapshot().stacks[0]).toEqual([]);
  });

  it('protects nested snapshots and event payloads from consumers and later steps', () => {
    const game = new GameEngine({ spawning: false });
    game.start();
    game.debugAttachGroup('sky', [{ side: 1, count: 1 }]);
    game.debugSpawn({ lane: 0, color: 'coral', speed: 1000 });
    const snapshot = game.getSnapshot();
    const frozenState = JSON.stringify(snapshot);
    const assertDeepFrozen = (value: unknown): void => {
      if (value === null || typeof value !== 'object') return;
      expect(Object.isFrozen(value)).toBe(true);
      for (const nested of Object.values(value)) assertDeepFrozen(nested);
    };
    assertDeepFrozen(snapshot);
    expect(() => Object.assign(snapshot.stacks[1]![0]!, { color: 'amber' })).toThrow(TypeError);
    expect(() => Object.assign(snapshot.falling[0]!, { distance: 0 })).toThrow(TypeError);
    const landed = game.update(448);
    assertDeepFrozen(landed);
    const landing = landed.find(event => event.type === 'blockLanded')!;
    expect(() => Object.assign(landing.cell, { side: 5 })).toThrow(TypeError);
    expect(() => Object.assign(landing.block, { color: 'teal' })).toThrow(TypeError);
    game.debugAttachGroup('coral', [{ side: 0, count: 2 }]);
    const cleared = game.update(0);
    assertDeepFrozen(cleared);
    const match = cleared.find(event => event.type === 'matchCleared')!;
    expect(() => Object.assign(match.cells[0]!, { index: 99 })).toThrow(TypeError);
    expect(() => Object.assign(match.cells, { 0: { side: 5, index: 99 } })).toThrow(TypeError);
    const frozenEvents = JSON.stringify([landed, cleared]);
    game.restart();
    expect(JSON.stringify(snapshot)).toBe(frozenState);
    expect(JSON.stringify([landed, cleared])).toBe(frozenEvents);
  });
  it('rotates only while playing and lands a block on the mapped side', () => {
    const game = new GameEngine({ spawning: false });
    game.enqueue({ type: 'rotate', steps: 1 });
    game.update(0);
    expect(game.getSnapshot().orientation).toBe(0);

    game.start();
    game.enqueue({ type: 'rotate', steps: 1 });
    game.debugSpawn({ lane: 0, color: 'coral', speed: 1000 });
    const events = game.update(1000);
    expect(game.getSnapshot().orientation).toBe(1);
    expect(game.getSnapshot().stacks[1]).toHaveLength(1);
    expect(events).toEqual([
      { type: 'blockLanded', block: { id: 1, color: 'coral' }, cell: { side: 1, index: 0 } },
    ]);
  });

  it('scores squared group size and advances combo inside the window', () => {
    const game = new GameEngine({ spawning: false });
    game.start();
    game.debugAttachGroup('coral', [{ side: 0, count: 3 }]);
    game.update(16.6667);
    expect(game.getSnapshot().score).toBe(9);
    game.debugAttachGroup('sky', [{ side: 1, count: 3 }]);
    const events = game.update(16.6667);
    expect(game.getSnapshot().combo).toBe(2);
    expect(game.getSnapshot().score).toBe(27);
    expect(events.map((event) => event.type)).toEqual(['matchCleared', 'comboChanged']);
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

  it('accepts at most two queued rotations per update', () => {
    const game = new GameEngine({ spawning: false });
    game.start();
    game.enqueue({ type: 'rotate', steps: 1 });
    game.enqueue({ type: 'rotate', steps: 1 });
    game.enqueue({ type: 'rotate', steps: 1 });

    game.update(0);

    expect(game.getSnapshot().orientation).toBe(2);
  });

  it('discards rotations enqueued while paused even when resuming in the same update', () => {
    const game = new GameEngine({ spawning: false });
    game.start();
    game.enqueue({ type: 'togglePause' });
    game.update(0);
    game.enqueue({ type: 'togglePause' });
    game.enqueue({ type: 'rotate', steps: 1 });

    game.update(0);

    expect(game.getSnapshot().mode).toBe('playing');
    expect(game.getSnapshot().orientation).toBe(0);
  });

  it('freezes falling blocks and immutable event output while paused', () => {
    const game = new GameEngine({ spawning: false });
    game.start();
    game.debugSpawn({ lane: 0, color: 'amber', speed: 100 });
    game.enqueue({ type: 'togglePause' });

    const events = game.update(500);

    expect(game.getSnapshot().falling[0]?.distance).toBe(520);
    expect(Object.isFrozen(events)).toBe(true);
  });

  it('resets combo when the next match is outside the combo window', () => {
    const game = new GameEngine({ spawning: false });
    game.start();
    game.debugAttachGroup('coral', [{ side: 0, count: 3 }]);
    game.update(0);
    game.update(1200.1);
    game.debugAttachGroup('sky', [{ side: 1, count: 3 }]);

    game.update(0);

    expect(game.getSnapshot().combo).toBe(1);
    expect(game.getSnapshot().score).toBe(18);
  });

  it('restart and return to menu clear transient match state', () => {
    const game = new GameEngine({ spawning: false });
    game.start();
    game.debugAttachGroup('coral', [{ side: 0, count: 3 }]);
    game.debugSpawn({ lane: 1, color: 'teal', speed: 100 });
    game.update(10);
    game.enqueue({ type: 'rotate', steps: 1 });
    game.update(0);

    game.restart();

    expect(game.getSnapshot()).toEqual({
      mode: 'playing',
      score: 0,
      combo: 1,
      orientation: 0,
      stacks: [[], [], [], [], [], []],
      falling: [],
      cycle: {
        number: 1, phase: 'settle', elapsedMs: 0, totalActiveMs: 0, durationMs: 75_000, progress: 0,
        warning: [], warningRemainingMs: 0, anomalies: [], threat: null,
      },
      bonus: { stored: null, slowRemainingMs: 0 },
      fallingBonuses: [],
      upgrades: {
        levels: {
          stabilizer: 0, comboRelay: 0, salvage: 0, deepPulse: 0,
          anomalyShield: 0, lastStand: 0,
        },
        choices: [],
        selectedIndex: 0,
      },
      elapsedMs: 0,
    });
    game.returnToMenu();
    expect(game.getSnapshot().mode).toBe('menu');
  });
});
