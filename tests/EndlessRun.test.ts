import { describe, expect, it } from 'vitest';
import { ThreatDirector } from '../src/game/ThreatDirector';
import { SeededRandom } from '../src/game/random';

const modifiers = { anomalyDurationMultiplier: 1, bonusIntervalMultiplier: 1 };

describe('endless threat pressure', () => {
  it('keeps speed rising and cadence falling only to the soft 600/500 ceilings', () => {
    const director = new ThreatDirector(new SeededRandom(17));
    const profiles: { speed: number; intervalMs: number }[] = [];
    for (let activeMs = 0; activeMs <= 3_600_000; activeMs += 600_000) {
      let remaining = activeMs;
      director.reset();
      while (remaining > 0) {
        const tick = director.update(remaining, modifiers);
        remaining -= tick.consumedMs;
        if (tick.upgradeDue) director.beginNextCycle();
      }
      profiles.push(director.getWaveProfile());
    }

    expect(profiles.map(({ speed }) => speed)).toEqual([...profiles.map(({ speed }) => speed)].sort((a, b) => a - b));
    expect(profiles.map(({ intervalMs }) => intervalMs)).toEqual([...profiles.map(({ intervalMs }) => intervalMs)].sort((a, b) => b - a));
    expect(profiles.at(-1)?.speed).toBeCloseTo(600, 1);
    expect(profiles.at(-1)?.intervalMs).toBeCloseTo(500, 1);
  });
});
