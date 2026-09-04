import { describe, expect, it } from 'vitest';
import { SeededRandom } from '../src/game/random';
import { WaveSpawner } from '../src/game/WaveSpawner';

describe('WaveSpawner', () => {
  it('creates the original-style lane patterns', () => {
    const spawner = new WaveSpawner(new SeededRandom(7));

    expect(spawner.createPattern('pair', 5, [0, 1]).map((x) => x.lane)).toEqual([5, 0]);
    expect(spawner.createPattern('opposite', 2, [0]).map((x) => x.lane)).toEqual([2, 5]);
    expect(spawner.createPattern('halfCircle', 4, [0, 1, 2]).map((x) => x.lane)).toEqual([4, 5, 0]);
    expect(spawner.createPattern('circle', 0, [0, 1, 2, 3]).map((x) => x.lane)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(spawner.createPattern('spiral', 3, [0, 1]).map((x) => x.lane)).toEqual([3, 4, 5, 0, 1, 2]);
    expect(spawner.createPattern('spiral', 3, [0, 1]).map((x) => x.delayMs)).toEqual([0, 160, 320, 480, 640, 800]);
  });

  it('rejects a pattern with no color indexes', () => {
    const spawner = new WaveSpawner(new SeededRandom(7));

    expect(() => spawner.createPattern('single', 0, [])).toThrow(RangeError);
  });

  it('produces identical waves for identical seeds', () => {
    const first = new WaveSpawner(new SeededRandom(37));
    const second = new WaveSpawner(new SeededRandom(37));
    const firstWaves = [];
    const secondWaves = [];

    for (let i = 0; i < 240; i += 1) {
      firstWaves.push(...first.update(20));
      secondWaves.push(...second.update(20));
    }

    expect(firstWaves).toEqual(secondWaves);
  });

  it('never exceeds the configured speed or minimum interval', () => {
    const spawner = new WaveSpawner(new SeededRandom(11));

    for (let i = 0; i < 20_000; i += 1) spawner.update(16.6667);

    expect(spawner.intervalMs).toBeGreaterThanOrEqual(600);
    expect(spawner.speed).toBeLessThanOrEqual(420);
  });
});
