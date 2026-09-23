import { describe, expect, it } from 'vitest';
import { ThreatDirector } from '../src/game/ThreatDirector';
import type { DirectorEvent, DirectorModifiers, ThreatRequest, WaveProfile } from '../src/game/progressionTypes';
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

const collectPlans = (director: ThreatDirector, durationMs: number) =>
  collectEvents(director, durationMs).filter(
    (event): event is Extract<DirectorEvent, { type: 'situationPrepared' }> => event.type === 'situationPrepared',
  );

describe('ThreatDirector', () => {
  it('uses exact 20/35/15/5 second phases and pauses only after cycle three', () => {
    const director = new ThreatDirector(new SeededRandom(17));
    expect(director.getSnapshot()).toMatchObject({ number: 1, phase: 'settle', durationMs: 75_000 });
    expect(director.update(20_000, NO_MODIFIERS).events).toContainEqual(
      { type: 'phaseChanged', phase: 'build', cycle: 1, atActiveMs: 20_000 },
    );
    expect(director.update(35_000, NO_MODIFIERS).events).toContainEqual(
      { type: 'phaseChanged', phase: 'pressure', cycle: 1, atActiveMs: 55_000 },
    );
    expect(director.update(15_000, NO_MODIFIERS).events).toContainEqual(
      { type: 'phaseChanged', phase: 'release', cycle: 1, atActiveMs: 70_000 },
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
    advanceToCycle(director, 2); director.update(44_500, NO_MODIFIERS);
    expect(director.getSnapshot().anomalies).toEqual([{ type: anomaly, remainingMs: durationMs }]);
  });

  it('rejects an injected reverse and inertia pairing', () => {
    expect(() => new ThreatDirector(new SequenceRandom([]), {
      forcedAnomaliesByCycle: { 2: ['reverse', 'inertia'] },
    })).toThrow(RangeError);
  });

  it('ends paired anomalies independently at their own durations', () => {
    const director = new ThreatDirector(new SequenceRandom([0, 0]), {
      forcedAnomaliesByCycle: { 5: [], 6: ['reverse', 'mirage'] },
    });
    advanceToCycle(director, 6); director.update(45_200, NO_MODIFIERS);
    expect(director.update(9_000, NO_MODIFIERS).events).toContainEqual({ type: 'anomalyEnded', anomalies: ['reverse'], atActiveMs: 429_200 });
    expect(director.getSnapshot().anomalies).toEqual([{ type: 'mirage', remainingMs: 1_000 }]);
  });

  it('floors shield-scaled anomaly durations independently at four seconds', () => {
    const director = new ThreatDirector(new SequenceRandom([0, 0]), {
      forcedAnomaliesByCycle: { 5: [], 6: ['inertia', 'drift'] },
    });
    const shield = { anomalyDurationMultiplier: 0.1, bonusIntervalMultiplier: 1 };
    advanceToCycle(director, 6); director.update(45_200, shield);
    expect(director.getSnapshot().anomalies).toEqual([
      { type: 'inertia', remainingMs: 4_000 }, { type: 'drift', remainingMs: 4_000 },
    ]);
  });

  it('keeps salvage bonuses at least thirty-five active seconds apart', () => {
    const director = new ThreatDirector(new SequenceRandom([0]));
    const salvage = { anomalyDurationMultiplier: 1, bonusIntervalMultiplier: 0.1 };
    expect(director.update(34_999, salvage).bonusDue).toBe(false);
    expect(director.update(1, salvage).bonusDue).toBe(true);
  });

  it('looks ahead when a sampled bonus would strand the next 35-50 second window', () => {
    const director = new ThreatDirector(new SequenceRandom([0, 0, 1, 2 / 3]));
    const bonusTimes: number[] = [];
    while (bonusTimes.length < 3) {
      const tick = director.update(director.getNextEventMs(NO_MODIFIERS), NO_MODIFIERS);
      if (tick.bonusDue) bonusTimes.push(director.getSnapshot().totalActiveMs);
    }
    expect(bonusTimes).toEqual([50_000, 100_000, 150_000]);
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
    advanceToCycle(director, 2); director.update(42_500, NO_MODIFIERS);
    expect(director.getSnapshot().warning).toEqual(['mirage']);
    director.reset();
    expect(director.getSnapshot()).toMatchObject({ number: 1, phase: 'settle', elapsedMs: 0, totalActiveMs: 0, warning: [], anomalies: [] });
  });

  it('never starts danger before 90 seconds and requires the full warning', () => {
    const director = new ThreatDirector(new SeededRandom(3));
    expect(collectEvents(director, 89_999).some(({ type }) => type === 'anomalyStarted')).toBe(false);
    const events = collectEvents(director, 30_001);
    const warning = events.find((event) => event.type === 'anomalyWarning');
    const started = events.find((event) => event.type === 'anomalyStarted');
    expect(warning).toMatchObject({ atActiveMs: 117_000, warningMs: 2_500 });
    expect(started).toMatchObject({ atActiveMs: 119_500 });
    expect(started!.atActiveMs - warning!.atActiveMs).toBeGreaterThanOrEqual(2_500);
  });

  it.each([
    [1, { pattern: 'single', anomalies: ['mirage'] }],
    [2, { pattern: 'circle', anomalies: ['reverse', 'inertia'] }],
    [5, { pattern: 'single', anomalies: ['mirage', 'drift'] }],
    [6, { pattern: 'circle', anomalies: ['mirage', 'drift'] }],
    [6, { pattern: 'spiral', anomalies: ['mirage', 'drift'] }],
    [6, { pattern: 'single', anomalies: ['mirage', 'mirage'] }],
    [6, { pattern: 'single', anomalies: ['mirage', 'drift', 'colorShift'] }],
    [6, { pattern: 'single', anchorLane: 1.5, anomalies: [] }],
  ] as const)('rejects an illegal authored request in cycle %i: %j', (cycle, request) => {
    expect(() => new ThreatDirector(new SeededRandom(1), {
      forcedSituationsByCycle: { [cycle]: request },
    })).toThrow(RangeError);
  });

  it('never repeats pressure combinations or anomaly types in consecutive cycles', () => {
    const plans = collectPlans(new ThreatDirector(new SeededRandom(11)), 900_000);
    expect(plans).toHaveLength(12);
    for (let index = 1; index < plans.length; index += 1) {
      const previous = plans[index - 1]!.plan;
      const current = plans[index]!.plan;
      expect(current.evidence.combinationKey).not.toBe(previous.evidence.combinationKey);
      expect(current.anomalies.some((type) => previous.anomalies.includes(type))).toBe(false);
    }
  });

  it('gates double anomalies by prepared event time and extends their warnings', () => {
    const plans = collectPlans(new ThreatDirector(new SeededRandom(9)), 900_000);
    expect(plans.filter(({ atActiveMs }) => atActiveMs < 360_000)).toHaveLength(5);
    expect(plans.filter(({ atActiveMs }) => atActiveMs < 360_000)
      .every(({ plan }) => plan.anomalies.length <= 1)).toBe(true);
    const doubles = plans.filter(({ plan }) => plan.anomalies.length === 2);
    expect(doubles.length).toBeGreaterThan(0);
    for (const { plan } of doubles) {
      expect(plan.warningMs).toBe(3_200);
      expect(['circle', 'spiral']).not.toContain(plan.pattern);
    }
  });

  it.each([
    ['single', [], 1, 0, true], ['pair', ['mirage'], 4, 0, true],
    ['opposite', ['drift'], 4, 0, true], ['halfCircle', ['colorShift'], 5, 0, true],
    ['spiral', ['reverse'], 7, 450, true], ['circle', ['inertia'], 8, 450, true],
    ['halfCircle', ['mirage', 'drift'], 9, 0, true],
  ] as const)('explains the exact cost and fairness accommodations for %s with %j', (pattern, anomalies, spent, entryDelayMs, bonusIncompatible) => {
    const director = new ThreatDirector(new SeededRandom(1), {
      forcedSituationsByCycle: { 5: { pattern: 'pair', anomalies: [] }, 6: { pattern, anomalies } },
    });
    const event = collectPlans(director, 395_000).at(-1)!;
    expect(event).toBeDefined();
    expect(event.plan).toMatchObject({ pattern, anomalies, entryDelayMs, bonusIncompatible,
      evidence: { seedCycle: 6, phase: 'pressure', budget: 11, spent } });
  });

  it('prepares exactly once at Build with real wrapped lanes and immutable evidence', () => {
    const director = new ThreatDirector(new SeededRandom(7), {
      forcedSituationsByCycle: { 2: { pattern: 'halfCircle', anchorLane: 5, anomalies: ['drift'] } },
    });
    collectEvents(director, 75_000);
    expect(collectEvents(director, 19_999).some(({ type }) => type === 'situationPrepared')).toBe(false);
    const event = collectPlans(director, 1)[0]!;
    expect(event).toMatchObject({ atActiveMs: 95_000, plan: { anchorLane: 5, lanes: [5, 0, 1] } });
    expect(director.getSnapshot().threat).toEqual(event.plan);
    for (const value of [event, event.plan, event.plan.lanes, event.plan.anomalies, event.plan.evidence]) {
      expect(Object.isFrozen(value)).toBe(true);
    }
    const warning = collectEvents(director, 22_000).find(({ type }) => type === 'anomalyWarning')!;
    expect(warning).toMatchObject({ lanes: [5, 0, 1], anomalies: ['drift'], warningMs: 2_500, atActiveMs: 117_000 });
    expect(Object.isFrozen((warning as Extract<DirectorEvent, { type: 'anomalyWarning' }>).lanes)).toBe(true);
    expect(collectPlans(director, 28_000)).toEqual([]);
  });

  it('carries the authored plan anchor and delayed entry into its Pressure wave profile', () => {
    const director = new ThreatDirector(new SeededRandom(7), {
      forcedSituationsByCycle: { 2: { pattern: 'spiral', anchorLane: 4, anomalies: ['reverse'] } },
    });
    advanceToCycle(director, 2);
    director.update(55_000, NO_MODIFIERS);
    const plan = director.getSnapshot().threat!;
    expect(plan.lanes).toEqual([4, 5, 0, 1, 2, 3]);
    expect(director.getWaveProfile()).toMatchObject({
      forcedPattern: 'spiral', forcedAnchorLane: 4,
      authoredWaveId: '2:pressure:spiral:4', entryDelayMs: 450,
    });
  });

  it('restricts phase patterns and clears all complications at Release', () => {
    const director = new ThreatDirector(new SeededRandom(1), {
      forcedSituationsByCycle: { 2: { pattern: 'circle', anomalies: ['reverse'] } },
    });
    expect(director.getWaveProfile().patternWeights).toMatchObject({ halfCircle: 0, spiral: 0, circle: 0 });
    director.update(20_000, NO_MODIFIERS);
    expect(director.getWaveProfile().patternWeights).toMatchObject({ circle: 0 });
    expect(director.getWaveProfile().patternWeights.spiral).toBeGreaterThan(0);
    collectEvents(director, 110_000);
    expect(director.getWaveProfile().forcedPattern).toBe('circle');
    director.update(15_000, { ...NO_MODIFIERS, anomalyDurationMultiplier: 10 });
    expect(director.getWaveProfile().forcedPattern).toBe('single');
    expect(director.getSnapshot()).toMatchObject({ threat: null, warning: [], anomalies: [] });
    expect(director.update(4_999, NO_MODIFIERS).events).toEqual([]);
  });

  it('rejects authored adjacent-cycle cooldown and combination violations', () => {
    const request: ThreatRequest = { pattern: 'pair', anomalies: ['mirage'] };
    expect(() => new ThreatDirector(new SeededRandom(1), {
      forcedSituationsByCycle: { 2: request, 3: request },
    })).toThrow(RangeError);
  });

  it('keeps full event evidence deterministic across large and split updates', () => {
    const run = (chunks: readonly number[]) => {
      const director = new ThreatDirector(new SeededRandom(31));
      return { events: chunks.flatMap((chunk) => collectEvents(director, chunk)), snapshot: director.getSnapshot() };
    };
    expect(run([480_000])).toEqual(run(Array.from({ length: 480 }, () => 1_000)));
  });

  it('keeps scheduled bonuses out of Release, including across an upgrade', () => {
    const director = new ThreatDirector(new SequenceRandom([]));
    const modifiers = { ...NO_MODIFIERS, bonusIntervalMultiplier: 2.5 };
    expect(director.update(70_000, modifiers).bonusDue).toBe(true);
    expect(director.update(5_000, modifiers).bonusDue).toBe(false);
    expect(director.update(75_000, modifiers).bonusDue).toBe(true);
    const upgrade = director.update(75_000, modifiers);
    expect(upgrade).toMatchObject({ upgradeDue: true });
    director.beginNextCycle();
    expect(director.update(0, modifiers).bonusDue).toBe(false);
  });

  it('keeps event timestamps exact after fractional motion-sized updates over 48 cycles', () => {
    const director = new ThreatDirector(new SeededRandom(14));
    const completed = [];
    for (let cycle = 0; cycle < 48; cycle += 1) {
      collectEvents(director, 2245.826516416);
      completed.push(...collectEvents(director, 75_000 - 2245.826516416)
        .filter((event) => event.type === 'cycleCompleted'));
    }
    expect(completed).toHaveLength(48);
    expect(completed.at(-1)).toEqual({ type: 'cycleCompleted', cycle: 48, atActiveMs: 3_600_000 });
  });
});
