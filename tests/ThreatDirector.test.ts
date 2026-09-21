import { describe, expect, it } from 'vitest';
import { ThreatDirector } from '../src/game/ThreatDirector';
import type { AnomalyType, DirectorModifiers, WaveProfile } from '../src/game/progressionTypes';
import type { RandomSource } from '../src/game/random';
import { SeededRandom } from '../src/game/random';

const NO_MODIFIERS: DirectorModifiers = {
  anomalyDurationMultiplier: 1,
  bonusIntervalMultiplier: 1,
};

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

class SequenceRandom implements RandomSource {
  private index = 0;
  public constructor(private readonly values: readonly number[]) {}
  public next(): number { return this.values[this.index++] ?? 0; }
}

function advanceToCycle(director: ThreatDirector, target: number): void {
  while (director.getSnapshot().number < target) {
    const tick = director.update(75_000, NO_MODIFIERS);
    if (tick.upgradeDue) director.beginNextCycle();
  }
}

describe('ThreatDirector', () => {
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
    expect(profile.intervalMs).toBeCloseTo(intervalMs, 0);
  });

  it('keeps snapshots and profiles immutable while exposing total active time', () => {
    const director = new ThreatDirector(new SeededRandom(1));
    director.update(1_000, NO_MODIFIERS);
    const snapshot = director.getSnapshot();
    const profile = director.getWaveProfile();

    expect(snapshot.totalActiveMs).toBe(1_000);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(profile)).toBe(true);
    expect(Object.isFrozen(profile.patternWeights)).toBe(true);
  });

  it.each([
    ['reverse', 9_000], ['mirage', 10_000], ['drift', 12_000], ['colorShift', 10_000], ['inertia', 8_000],
  ] as const)('gives %s its exact base duration', (anomaly, durationMs) => {
    const director = new ThreatDirector(new SequenceRandom([0, 0]), { forcedAnomaliesByCycle: { 2: [anomaly] } });
    advanceToCycle(director, 2); director.update(22_500, NO_MODIFIERS);
    expect(director.getSnapshot().anomalies).toEqual([{ type: anomaly, remainingMs: durationMs }]);
  });

  it('rejects an injected reverse and inertia pairing', () => {
    expect(() => new ThreatDirector(new SequenceRandom([]), {
      forcedAnomaliesByCycle: { 2: ['reverse', 'inertia'] },
    })).toThrow(RangeError);
  });

  it('ends paired anomalies independently at their own durations', () => {
    const director = new ThreatDirector(new SequenceRandom([0, 0]), {
      forcedAnomaliesByCycle: { 2: ['reverse', 'mirage'] },
    });
    advanceToCycle(director, 2); director.update(22_500, NO_MODIFIERS);
    expect(director.update(9_000, NO_MODIFIERS).events).toContainEqual({ type: 'anomalyEnded', anomalies: ['reverse'] });
    expect(director.getSnapshot().anomalies).toEqual([{ type: 'mirage', remainingMs: 1_000 }]);
  });

  it('floors shield-scaled anomaly durations independently at four seconds', () => {
    const director = new ThreatDirector(new SequenceRandom([0, 0]), {
      forcedAnomaliesByCycle: { 2: ['inertia', 'drift'] },
    });
    const shield = { anomalyDurationMultiplier: 0.1, bonusIntervalMultiplier: 1 };
    advanceToCycle(director, 2); director.update(22_500, shield);
    expect(director.getSnapshot().anomalies).toEqual([
      { type: 'inertia', remainingMs: 4_000 }, { type: 'drift', remainingMs: 4_000 },
    ]);
  });

  it('keeps the salvage-modified bonus interval at its sixteen-second floor', () => {
    const director = new ThreatDirector(new SequenceRandom([0]));
    const salvage = { anomalyDurationMultiplier: 1, bonusIntervalMultiplier: 0.1 };
    expect(director.update(15_999, salvage).bonusDue).toBe(false);
    expect(director.update(1, salvage).bonusDue).toBe(true);
  });

  it('reports immutable director events independently from immutable snapshots', () => {
    const tick = new ThreatDirector(new SeededRandom(1)).update(20_000, NO_MODIFIERS);
    expect(Object.isFrozen(tick)).toBe(true);
    expect(Object.isFrozen(tick.events)).toBe(true);
    expect(Object.isFrozen(tick.events[0]!)).toBe(true);
  });

  it('retains authored pattern-weight tiers across automatic cycle progression', () => {
    const director = new ThreatDirector(new SequenceRandom([]));
    expect(director.getWaveProfile().patternWeights.single).toBe(6);
    advanceToCycle(director, 3); expect(director.getWaveProfile().patternWeights.single).toBe(4);
    advanceToCycle(director, 6); expect(director.getWaveProfile().patternWeights.single).toBe(2);
    advanceToCycle(director, 9); expect(director.getWaveProfile().patternWeights.single).toBe(1);
  });

  it('resets active time, warning state, and anomalies for a fresh deterministic run', () => {
    const director = new ThreatDirector(new SequenceRandom([0, 0]), { forcedAnomaliesByCycle: { 2: ['mirage'] } });
    advanceToCycle(director, 2); director.update(22_500, NO_MODIFIERS); director.reset();
    expect(director.getSnapshot()).toMatchObject({ number: 1, phase: 'settle', elapsedMs: 0, totalActiveMs: 0, warning: [], anomalies: [] });
  });
});
