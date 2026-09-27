import { describe, expect, it } from 'vitest';
import { GameEngine } from '../src/game/GameEngine';
import type { AnomalyType, DirectorEvent, ThreatRequest } from '../src/game/progressionTypes';
import type { GameEvent } from '../src/game/types';

function gameFor(anomalies: readonly AnomalyType[]): GameEngine {
  const cycle = anomalies.length > 1 ? 6 : 2;
  const forcedSituationsByCycle: Record<number, ThreatRequest> = {
    [cycle]: { pattern: 'single', anchorLane: 0, anomalies },
  };
  if (cycle === 6) forcedSituationsByCycle[5] = { pattern: 'pair', anomalies: [] };
  const game = new GameEngine({
    randomSeed: 73,
    spawning: false,
    maxStackDepth: 20,
    director: { forcedSituationsByCycle },
  });
  game.start();
  while (game.getSnapshot().cycle.number < cycle) {
    game.update(75_000);
    if (game.getSnapshot().mode === 'upgrade') {
      game.enqueue({ type: 'confirmUpgrade' });
      game.update(0);
    }
  }
  expect(game.getSnapshot()).toMatchObject({ mode: 'playing', cycle: { number: cycle } });
  return game;
}

function reachWarning(game: GameEngine): DirectorEvent[] {
  const events: DirectorEvent[] = [...game.update(42_000).filter(isDirectorEvent)];
  expect(events).toContainEqual(expect.objectContaining({ type: 'anomalyWarning' }));
  expect(game.getSnapshot().cycle.warningRemainingMs).toBe(game.getSnapshot().cycle.warning.length === 2 ? 3_200 : 2_500);
  return events;
}

function activate(game: GameEngine): void {
  reachWarning(game);
  expect(game.update(game.getSnapshot().cycle.warningRemainingMs - 1)).not.toContainEqual(expect.objectContaining({ type: 'anomalyStarted' }));
  expect(game.update(1)).toContainEqual(expect.objectContaining({ type: 'anomalyStarted' }));
}

function driftWithTallStack(stackSide: number): GameEngine {
  const game = new GameEngine({
    randomSeed: 1,
    spawning: false,
    maxStackDepth: 20,
    director: { forcedSituationsByCycle: { 2: { pattern: 'single', anchorLane: 0, anomalies: ['drift'] } } },
  });
  game.start();
  game.update(75_000);
  game.update(42_000);
  game.update(2_500);
  expect(game.getSnapshot().cycle.anomalies.map(({ type }) => type)).toContain('drift');
  for (const color of ['coral', 'amber', 'teal', 'sky', 'coral', 'amber'] as const) {
    game.debugAttachGroup(color, [{ side: stackSide, count: 1 }]);
  }
  game.debugSpawn({ lane: 2, color: 'sky', speed: 100 });
  expect(game.getSnapshot().falling[0]?.driftToLane).toBe(1);
  return game;
}

function isDirectorEvent(event: GameEvent): event is DirectorEvent {
  return event.type === 'phaseChanged'
    || event.type === 'situationPrepared'
    || event.type === 'anomalyWarning'
    || event.type === 'anomalyStarted'
    || event.type === 'anomalyEnded'
    || event.type === 'cycleCompleted';
}

describe('telegraphed anomalies', () => {
  it('keeps the warning mechanical-free for exactly 2500 ms', () => {
    const game = gameFor(['reverse']);
    reachWarning(game);
    game.debugSpawn({ lane: 0, color: 'coral', speed: 100 });
    game.enqueue({ type: 'rotate', steps: 1 });

    game.update(2_499);

    expect(game.getSnapshot()).toMatchObject({
      orientation: 1,
      falling: [{ lane: 0, color: 'coral' }],
      cycle: { warning: ['reverse'], anomalies: [] },
    });
    expect(game.update(1)).toContainEqual({ type: 'anomalyStarted', anomalies: ['reverse'], lanes: [0], atActiveMs: 119_500 });
  });

  it('reverses application of a semantic rotation only while active', () => {
    const game = gameFor(['reverse']);
    activate(game);
    game.enqueue({ type: 'rotate', steps: 1 });

    game.update(0);

    expect(game.getSnapshot().orientation).toBe(5);
  });

  it('keeps a mirage adjacent, non-logical, and hidden at distance 180', () => {
    const game = gameFor(['mirage']);
    activate(game);
    game.debugSpawn({ lane: 0, color: 'amber', speed: 100 });
    const spawned = game.getSnapshot().falling[0]!;

    expect([1, 5]).toContain(spawned.mirageLane);
    expect(spawned.mirageVisible).toBe(true);
    expect(game.update(3_399)).toEqual([]);
    expect(game.getSnapshot().falling[0]?.distance).toBeCloseTo(180.1);
    expect(game.getSnapshot().falling[0]?.mirageVisible).toBe(true);
    expect(game.update(1)).toEqual([]);
    expect(game.getSnapshot().falling[0]).toMatchObject({ distance: 180, mirageVisible: false });

    const landed = game.update(1_080);
    expect(landed).toEqual([
      { type: 'blockLanded', block: { id: spawned.id, color: 'amber' }, cell: { side: 0, index: 0 } },
    ]);
    expect(game.getSnapshot().score).toBe(0);
    expect(game.getSnapshot().stacks[spawned.mirageLane!]).toEqual([]);
  });

  it('reveals drift immediately and interpolates from 360 to 200 before landing there', () => {
    const game = gameFor(['drift']);
    activate(game);
    game.debugSpawn({ lane: 2, color: 'sky', speed: 100 });
    const spawned = game.getSnapshot().falling[0]!;

    expect([1, 3]).toContain(spawned.driftToLane);
    expect(spawned.driftProgress).toBe(0);
    game.update(1_600);
    expect(game.getSnapshot().falling[0]).toMatchObject({ distance: 360, driftProgress: 0 });
    game.update(800);
    expect(game.getSnapshot().falling[0]).toMatchObject({ distance: 280, driftProgress: 0.5 });
    game.update(800);
    expect(game.getSnapshot().falling[0]).toMatchObject({ distance: 200, driftProgress: 1 });

    expect(game.update(1_280)).toEqual([
      {
        type: 'blockLanded',
        block: { id: spawned.id, color: 'sky' },
        cell: { side: spawned.driftToLane, index: 0 },
      },
    ]);
    expect(game.getSnapshot().stacks[2]).toEqual([]);
  });

  it('lands a drifting block on a tall origin stack regardless of update chunk size', () => {
    const run = (chunks: readonly number[]) => {
      const game = driftWithTallStack(2);
      const events = chunks.flatMap((chunk) => game.update(chunk));
      return { events, snapshot: game.getSnapshot() };
    };

    const large = run([4_000]);
    const split = run(Array.from({ length: 40 }, () => 100));
    expect(large).toEqual(split);
    expect(large.events).toContainEqual(expect.objectContaining({
      type: 'blockLanded', cell: { side: 2, index: 6 },
    }));
    expect(large.snapshot.falling).toEqual([]);
  });

  it('uses the target stack only when drift reaches distance 200', () => {
    const game = driftWithTallStack(1);

    expect(game.update(3_199)).toEqual([]);
    expect(game.getSnapshot().falling[0]).toMatchObject({ distance: 200.1 });
    expect(game.update(1)).toContainEqual(expect.objectContaining({
      type: 'blockLanded', cell: { side: 1, index: 6 },
    }));
    expect(game.getSnapshot().falling).toEqual([]);
    expect(game.getSnapshot().stacks[2]).toEqual([]);
  });

  it('shifts logical color once when crossing distance 260', () => {
    const game = gameFor(['colorShift']);
    activate(game);
    game.debugSpawn({ lane: 0, color: 'teal', speed: 100 });
    const spawned = game.getSnapshot().falling[0]!;

    expect(spawned.shiftAtDistance).toBe(260);
    expect(spawned.shiftToColor).not.toBe('teal');
    expect(game.update(2_599)).toEqual([]);
    expect(game.getSnapshot().falling[0]).toMatchObject({ distance: 260.1, color: 'teal' });

    const shifted = game.update(1);
    expect(shifted).toEqual([{
      type: 'blockColorShifted',
      blockId: spawned.id,
      fromColor: 'teal',
      toColor: spawned.shiftToColor,
    }]);
    expect(Object.isFrozen(shifted)).toBe(true);
    expect(Object.isFrozen(shifted[0])).toBe(true);
    expect(game.getSnapshot().falling[0]).toMatchObject({ distance: 260, color: spawned.shiftToColor });
    expect(Object.isFrozen(game.getSnapshot().falling[0])).toBe(true);
    expect(game.update(100).filter((event) => event.type === 'blockColorShifted')).toEqual([]);
  });

  it('delays at most two inertia rotations for 180 active ms and freezes them on pause', () => {
    const game = gameFor(['inertia']);
    activate(game);
    game.enqueue({ type: 'rotate', steps: 1 });
    game.enqueue({ type: 'rotate', steps: 1 });
    game.enqueue({ type: 'rotate', steps: 1 });

    expect(game.update(0)).toEqual([
      { type: 'rotationDelayed', steps: 1, remainingMs: 180 },
      { type: 'rotationDelayed', steps: 1, remainingMs: 180 },
    ]);
    expect(game.getSnapshot().orientation).toBe(0);
    game.update(179);
    const anomalyRemainingMs = game.getSnapshot().cycle.anomalies[0]?.remainingMs;
    game.enqueue({ type: 'togglePause' });
    game.update(1_000);
    expect(game.getSnapshot()).toMatchObject({ mode: 'paused', orientation: 0 });
    expect(game.getSnapshot().cycle.anomalies[0]?.remainingMs).toBe(anomalyRemainingMs);
    game.enqueue({ type: 'togglePause' });
    game.update(0);
    expect(game.getSnapshot().orientation).toBe(0);
    game.update(1);
    expect(game.getSnapshot().orientation).toBe(2);
  });

  it('counts inertia rotations pending across separate zero-time batches toward the cap', () => {
    const game = gameFor(['inertia']);
    activate(game);
    game.enqueue({ type: 'rotate', steps: 1 });
    game.enqueue({ type: 'rotate', steps: 1 });
    const firstBatch = game.update(0);
    game.enqueue({ type: 'rotate', steps: 1 });
    game.enqueue({ type: 'rotate', steps: 1 });
    const secondBatch = game.update(0);

    game.update(180);
    const orientationAfterFirstBatch = game.getSnapshot().orientation;
    game.enqueue({ type: 'rotate', steps: 1 });
    game.enqueue({ type: 'rotate', steps: 1 });
    game.enqueue({ type: 'rotate', steps: 1 });
    const batchAfterCapacityReturns = game.update(0);

    expect({ firstBatch, secondBatch, orientationAfterFirstBatch, batchAfterCapacityReturns }).toEqual({
      firstBatch: [
        { type: 'rotationDelayed', steps: 1, remainingMs: 180 },
        { type: 'rotationDelayed', steps: 1, remainingMs: 180 },
      ],
      secondBatch: [],
      orientationAfterFirstBatch: 2,
      batchAfterCapacityReturns: [
        { type: 'rotationDelayed', steps: 1, remainingMs: 180 },
        { type: 'rotationDelayed', steps: 1, remainingMs: 180 },
      ],
    });
  });

  it('resets anomalous block metadata and pending inertia commands on restart', () => {
    const decorated = gameFor(['drift', 'colorShift']);
    activate(decorated);
    decorated.debugSpawn({ lane: 4, color: 'coral', speed: 100 });
    expect(decorated.getSnapshot().falling[0]).toMatchObject({
      driftProgress: 0,
      shiftAtDistance: 260,
    });
    decorated.restart();
    expect(decorated.getSnapshot()).toMatchObject({ falling: [], cycle: { warning: [], anomalies: [] } });
    decorated.debugSpawn({ lane: 4, color: 'coral', speed: 100 });
    expect(decorated.getSnapshot().falling[0]).toEqual({
      id: 1, lane: 4, color: 'coral', distance: 520, speed: 100,
    });

    const delayed = gameFor(['inertia']);
    activate(delayed);
    delayed.enqueue({ type: 'rotate', steps: -1 });
    delayed.update(0);
    delayed.restart();
    delayed.update(180);
    expect(delayed.getSnapshot()).toMatchObject({ orientation: 0, cycle: { warning: [], anomalies: [] } });
    delayed.start();
    delayed.update(75_000);
    activate(delayed);
    delayed.enqueue({ type: 'rotate', steps: 1 });
    delayed.update(0);
    delayed.returnToMenu();
    delayed.update(180);
    expect(delayed.getSnapshot()).toMatchObject({ mode: 'menu', orientation: 0, falling: [] });
  });

  it('keeps anomaly results identical for one large or several split updates', () => {
    const run = (steps: readonly number[]) => {
      const game = gameFor(['drift', 'colorShift']);
      activate(game);
      game.debugSpawn({ lane: 3, color: 'amber', speed: 100 });
      const events = steps.flatMap((step) => game.update(step));
      return { events, snapshot: game.getSnapshot() };
    };

    expect(run([3_200])).toEqual(run([800, 800, 800, 800]));
  });

  it('applies inertia on the same chronological boundary for large and split updates', () => {
    const run = (steps: readonly number[]) => {
      const game = gameFor(['inertia']);
      activate(game);
      game.debugSpawn({ lane: 0, color: 'coral', speed: 100 });
      game.enqueue({ type: 'rotate', steps: -1 });
      const events = [...game.update(0), ...steps.flatMap((step) => game.update(step))];
      return { events, snapshot: game.getSnapshot() };
    };

    expect(run([200])).toEqual(run([90, 90, 20]));
  });
});
