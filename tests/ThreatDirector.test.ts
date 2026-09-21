import { describe, expect, it } from 'vitest';
import { ThreatDirector } from '../src/game/ThreatDirector';
import type { DirectorModifiers, WaveProfile } from '../src/game/progressionTypes';
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
});
