import { describe, expect, it } from 'vitest';
import { SeededRandom } from '../src/game/random';
import { WaveSpawner } from '../src/game/WaveSpawner';
import type { WaveProfile } from '../src/game/progressionTypes';

const profile = (overrides: Partial<WaveProfile> = {}): WaveProfile => ({
  intervalMs: 100,
  speed: 200,
  patternWeights: { single: 1, pair: 0, opposite: 0, halfCircle: 0, circle: 0, spiral: 0 },
  forcedPattern: null,
  forcedPatternSequence: null,
  ...overrides,
});

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
      firstWaves.push(...first.update(20, profile()));
      secondWaves.push(...second.update(20, profile()));
    }

    expect(firstWaves).toEqual(secondWaves);
  });

  it('uses an externally supplied interval and speed without calculating its own difficulty', () => {
    const spawner = new WaveSpawner(new SeededRandom(11));

    expect(spawner.update(99, profile())).toEqual([]);
    expect(spawner.update(1, profile())).toEqual([
      expect.objectContaining({ speed: 200 }),
    ]);
    expect(spawner.update(100, profile({ speed: 375 }))).toEqual([
      expect.objectContaining({ speed: 375 }),
    ]);
  });

  it('uses a forced surge pattern verbatim', () => {
    const spawner = new WaveSpawner(new SeededRandom(11));

    const spawned = spawner.update(100, profile({ forcedPattern: 'circle' }));

    expect(spawned).toHaveLength(6);
    expect(spawned.map((block) => block.lane).sort()).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('samples only cumulative positive pattern weights', () => {
    const spawner = new WaveSpawner(new SeededRandom(11));

    const spawned = spawner.update(100, profile({
      patternWeights: { single: 0, pair: -10, opposite: 0, halfCircle: 3, circle: 0, spiral: 0 },
    }));

    expect(spawned).toHaveLength(3);
  });

  it('advances an authored surge sequence once per scheduled wave independent of update chunks', () => {
    const surge = profile({
      intervalMs: 160,
      forcedPattern: 'opposite',
      forcedPatternSequence: ['opposite', 'halfCircle', 'spiral', 'circle'],
    });
    const run = (steps: readonly number[]) => {
      const spawner = new WaveSpawner({ next: () => 0 });
      return steps.flatMap((step) => spawner.update(step, surge));
    };

    const expectedLanes = [0, 3, 0, 1, 2, 0, 1, 0, 1, 2, 3, 4, 5];
    expect(run([640])).toEqual(run([160, 160, 160, 160]));
    expect(run([640]).map((request) => request.lane)).toEqual(expectedLanes);
  });
});
