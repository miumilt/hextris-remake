import { describe, expect, it } from 'vitest';
import { CycleDirector } from '../src/game/CycleDirector';
import type { AnomalyType, DirectorModifiers } from '../src/game/progressionTypes';
import type { RandomSource } from '../src/game/random';
import { SeededRandom } from '../src/game/random';

const NO_MODIFIERS: DirectorModifiers = {
  anomalyDurationMultiplier: 1,
  bonusIntervalMultiplier: 1,
};

class SequenceRandom implements RandomSource {
  private index = 0;

  public constructor(private readonly values: readonly number[]) {}

  public next(): number {
    const value = this.values[this.index];
    this.index += 1;
    return value ?? 0;
  }
}

function advanceToCycle(director: CycleDirector, target: number): void {
  while (director.getSnapshot().number < target) {
    director.update(55_000, NO_MODIFIERS);
    director.beginNextCycle();
  }
}

describe('CycleDirector', () => {
  it('moves through flow, pressure, surge, then waits for an upgrade', () => {
    const director = new CycleDirector(new SeededRandom(17));

    expect(director.getSnapshot()).toMatchObject({ number: 1, phase: 'flow', elapsedMs: 0 });
    expect(director.update(30_000, NO_MODIFIERS).events).toContainEqual({
      type: 'phaseChanged', phase: 'pressure', cycle: 1,
    });
    expect(director.update(15_000, NO_MODIFIERS).events).toContainEqual({
      type: 'phaseChanged', phase: 'surge', cycle: 1,
    });

    const finish = director.update(10_000, NO_MODIFIERS);
    expect(finish).toMatchObject({ upgradeDue: true });
    expect(finish.events).toContainEqual({ type: 'cycleCompleted', cycle: 1 });
    expect(director.update(1_000, NO_MODIFIERS)).toMatchObject({ events: [], bonusDue: false, upgradeDue: true });

    director.beginNextCycle();
    expect(director.getSnapshot()).toMatchObject({ number: 2, phase: 'flow', elapsedMs: 0 });
  });

  it('uses the continuous speed curve and interval floor after long active play', () => {
    const director = new CycleDirector(new SequenceRandom([]));

    advanceToCycle(director, 9);

    expect(director.getWaveProfile()).toMatchObject({ speed: 780, intervalMs: 320 });
  });

  it('warns at the exact seeded anomaly instant and tracks the base duration', () => {
    const director = new CycleDirector(new SeededRandom(17));

    advanceToCycle(director, 2);
    expect(director.update(24_250, NO_MODIFIERS).events).not.toContainEqual(
      expect.objectContaining({ type: 'anomalyWarning' }),
    );
    expect(director.update(1, NO_MODIFIERS).events).toContainEqual({
      type: 'anomalyWarning', anomalies: ['reverse'],
    });
    expect(director.update(999, NO_MODIFIERS).events).toEqual([]);
    expect(director.update(1, NO_MODIFIERS).events).toContainEqual({
      type: 'anomalyStarted', anomalies: ['reverse'],
    });
    expect(director.getSnapshot().anomalies).toEqual([{ type: 'reverse', remainingMs: 9_000 }]);
    expect(director.update(9_000, NO_MODIFIERS).events).toContainEqual({
      type: 'anomalyEnded', anomalies: ['reverse'],
    });
  });

  it.each([
    ['reverse', 9_000],
    ['mirage', 10_000],
    ['drift', 12_000],
    ['colorShift', 10_000],
    ['inertia', 8_000],
  ] as const)('gives %s its exact base duration', (anomaly, durationMs) => {
    const director = new CycleDirector(new SequenceRandom([0, 0]), {
      forcedAnomaliesByCycle: { 2: [anomaly] },
    });

    advanceToCycle(director, 2);
    director.update(21_000, NO_MODIFIERS);

    expect(director.getSnapshot().anomalies).toEqual([{ type: anomaly, remainingMs: durationMs }]);
  });

  it('rolls two compatible anomalies from cycle six onward', () => {
    const director = new CycleDirector(new SequenceRandom(Array.from({ length: 20 }, () => 0)));

    advanceToCycle(director, 6);
    const warning = director.update(20_000, NO_MODIFIERS).events.find((event) => event.type === 'anomalyWarning');

    expect(warning).toMatchObject({ type: 'anomalyWarning' });
    if (warning?.type !== 'anomalyWarning') throw new Error('Expected anomaly warning');
    expect(warning.anomalies).toHaveLength(2);
    expect(new Set(warning.anomalies).size).toBe(2);
    expect(warning.anomalies).not.toEqual(expect.arrayContaining(['reverse', 'inertia']));
  });

  it('rejects an injected reverse and inertia pairing', () => {
    expect(() => new CycleDirector(new SequenceRandom([]), {
      forcedAnomaliesByCycle: { 6: ['reverse', 'inertia'] },
    })).toThrow(RangeError);
  });

  it('ends paired anomalies independently at their own durations', () => {
    const director = new CycleDirector(new SequenceRandom([0, 0]), {
      forcedAnomaliesByCycle: { 2: ['reverse', 'mirage'] },
    });

    advanceToCycle(director, 2);
    director.update(21_000, NO_MODIFIERS);

    expect(director.update(9_000, NO_MODIFIERS).events).toContainEqual({
      type: 'anomalyEnded', anomalies: ['reverse'],
    });
    expect(director.getSnapshot().anomalies).toEqual([{ type: 'mirage', remainingMs: 1_000 }]);
    expect(director.update(1_000, NO_MODIFIERS).events).toContainEqual({
      type: 'anomalyEnded', anomalies: ['mirage'],
    });
  });

  it('keeps the salvage-modified bonus interval at the sixteen-second floor', () => {
    const director = new CycleDirector(new SequenceRandom([0]));
    const salvageModifiers: DirectorModifiers = {
      anomalyDurationMultiplier: 1,
      bonusIntervalMultiplier: 0.1,
    };

    expect(director.update(15_999, salvageModifiers).bonusDue).toBe(false);
    expect(director.update(1, salvageModifiers).bonusDue).toBe(true);
  });

  it('defers a surge bonus until the first playing step of the next flow', () => {
    const intervalRandom = 7_000 / 14_001;
    const director = new CycleDirector(new SequenceRandom([
      intervalRandom, intervalRandom, intervalRandom, intervalRandom,
    ]));

    director.update(55_000, NO_MODIFIERS);
    director.beginNextCycle();
    director.update(15_000, NO_MODIFIERS);
    director.update(34_000, NO_MODIFIERS);
    const surgeTick = director.update(1_000, NO_MODIFIERS);
    expect(surgeTick.bonusDue).toBe(false);
    expect(director.getSnapshot()).toMatchObject({ phase: 'surge', elapsedMs: 50_000 });

    director.update(5_000, NO_MODIFIERS);
    director.beginNextCycle();
    expect(director.getSnapshot()).toMatchObject({ number: 3, phase: 'flow', elapsedMs: 0 });
    expect(director.update(1, NO_MODIFIERS).bonusDue).toBe(true);
    expect(director.update(1, NO_MODIFIERS).bonusDue).toBe(false);
    expect(director.update(27_998, NO_MODIFIERS).bonusDue).toBe(false);
    expect(director.update(1, NO_MODIFIERS).bonusDue).toBe(true);
  });

  it('splits a large delta across phase, warning, anomaly, bonus, and cycle boundaries', () => {
    const director = new CycleDirector(new SequenceRandom([0, 0]), {
      forcedAnomaliesByCycle: { 2: ['inertia'] },
    });

    advanceToCycle(director, 2);
    const tick = director.update(55_000, NO_MODIFIERS);

    expect(tick.events).toEqual(expect.arrayContaining([
      { type: 'anomalyWarning', anomalies: ['inertia'] },
      { type: 'anomalyStarted', anomalies: ['inertia'] },
      { type: 'anomalyEnded', anomalies: ['inertia'] },
      { type: 'phaseChanged', phase: 'pressure', cycle: 2 },
      { type: 'phaseChanged', phase: 'surge', cycle: 2 },
      { type: 'cycleCompleted', cycle: 2 },
    ]));
    expect(tick).toMatchObject({ bonusDue: true, upgradeDue: true });
  });

  it('returns frozen snapshots and wave profiles without leaking mutable state', () => {
    const director = new CycleDirector(new SequenceRandom([0, 0]), {
      forcedAnomaliesByCycle: { 2: ['mirage'] },
    });

    advanceToCycle(director, 2);
    const tick = director.update(20_000, NO_MODIFIERS);
    const snapshot = director.getSnapshot();
    const profile = director.getWaveProfile();

    expect(Object.isFrozen(tick)).toBe(true);
    expect(Object.isFrozen(tick.events)).toBe(true);
    const warningEvent = tick.events[0];
    expect(Object.isFrozen(warningEvent)).toBe(true);
    if (warningEvent?.type !== 'anomalyWarning') throw new Error('Expected anomaly warning');
    expect(Object.isFrozen(warningEvent.anomalies)).toBe(true);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.warning)).toBe(true);
    expect(Object.isFrozen(profile)).toBe(true);
    expect(Object.isFrozen(profile.patternWeights)).toBe(true);
    expect(() => (snapshot.warning as AnomalyType[]).push('drift')).toThrow();
    expect(() => (tick.events as unknown[]).push({ type: 'cycleCompleted', cycle: 99 })).toThrow();
    expect(() => (warningEvent.anomalies as AnomalyType[]).push('drift')).toThrow();
    expect(() => (profile.patternWeights as Record<string, number>).single = 99).toThrow();
    expect(director.getSnapshot().warning).toEqual(['mirage']);
    expect(director.getWaveProfile().patternWeights.single).not.toBe(99);
  });

  it('uses the exact cycle weight tiers and cycles authored surge patterns by spawn beat', () => {
    const director = new CycleDirector(new SequenceRandom([]));

    expect(director.getWaveProfile().patternWeights).toEqual({
      single: 6, pair: 4, opposite: 2, halfCircle: 1, circle: 0, spiral: 1,
    });
    advanceToCycle(director, 3);
    expect(director.getWaveProfile().patternWeights).toEqual({
      single: 4, pair: 4, opposite: 3, halfCircle: 3, circle: 1, spiral: 3,
    });
    advanceToCycle(director, 6);
    expect(director.getWaveProfile().patternWeights).toEqual({
      single: 2, pair: 3, opposite: 4, halfCircle: 4, circle: 2, spiral: 4,
    });
    advanceToCycle(director, 9);
    expect(director.getWaveProfile().patternWeights).toEqual({
      single: 1, pair: 2, opposite: 4, halfCircle: 5, circle: 3, spiral: 5,
    });

    director.update(45_000, NO_MODIFIERS);
    expect(Array.from({ length: 5 }, () => director.getWaveProfile().forcedPattern)).toEqual([
      'opposite', 'halfCircle', 'spiral', 'circle', 'opposite',
    ]);
  });
});
