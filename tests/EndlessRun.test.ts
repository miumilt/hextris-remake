import { describe, expect, it } from 'vitest';
import { ThreatDirector } from '../src/game/ThreatDirector';
import { GameEngine } from '../src/game/GameEngine';
import { SeededRandom } from '../src/game/random';
import type { GameEvent } from '../src/game/types';

const modifiers = { anomalyDurationMultiplier: 1, bonusIntervalMultiplier: 1 };

describe('endless threat pressure', () => {
  it('schedules a Release-deferred bonus when an upgrade resumes at zero elapsed time', () => {
    const game = new GameEngine({ randomSeed: 1, spawning: false });
    game.start();
    game.update(225_000);
    expect(game.getSnapshot().mode).toBe('upgrade');

    game.enqueue({ type: 'confirmUpgrade' });
    const resumed = game.update(0);
    expect(game.getSnapshot().cycle).toMatchObject({ number: 4, phase: 'settle', elapsedMs: 0 });
    expect(resumed.filter(({ type }) => type === 'bonusScheduled')).toHaveLength(1);
    expect(game.getSnapshot().fallingBonuses).toHaveLength(1);
    expect(game.update(0).filter(({ type }) => type === 'bonusScheduled')).toHaveLength(0);
  });

  it('collects falling bonuses in the same order relative to phase changes for 250 and 500 ms chunks', () => {
    const trace = (frameMs: number) => {
      const game = new GameEngine({ randomSeed: 14, spawning: false,
        director: { forcedAnomaliesByCycle: { 2: ['reverse'], 3: ['drift'] } } });
      game.start();
      const events = [];
      for (let elapsed = 0; elapsed < 225_000; elapsed += frameMs) events.push(...game.update(frameMs));
      return events.filter(({ type }) => ['phaseChanged', 'bonusCollected', 'bonusReplaced'].includes(type));
    };
    const fine = trace(250);
    expect(fine.some(({ type }) => type === 'bonusReplaced')).toBe(true);
    expect(trace(500)).toEqual(fine);
  });

  it('keeps a complete seeded three-cycle integration deterministic across frame chunking', () => {
    const run = (frameMs: 250 | 500) => {
      const game = new GameEngine({
        randomSeed: 14,
        spawning: false,
        maxStackDepth: 100,
        director: { forcedAnomaliesByCycle: { 2: ['reverse'], 3: ['drift'] } },
      });
      const events: GameEvent[] = [];
      game.start();
      while (game.getSnapshot().mode === 'playing') events.push(...game.update(frameMs));
      const frozen = JSON.stringify(game.getSnapshot());
      game.update(5_000);
      const upgradeFrozen = JSON.stringify(game.getSnapshot()) === frozen;
      game.enqueue({ type: 'confirmUpgrade' });
      events.push(...game.update(0));
      return { events, upgradeFrozen, snapshot: game.getSnapshot() };
    };

    const coarse = run(500);
    const fine = run(250);
    expect(coarse).toEqual(fine);
    expect(coarse.upgradeFrozen).toBe(true);
    expect(coarse.events.map(({ type }) => type)).toEqual(expect.arrayContaining([
      'cycleCompleted', 'anomalyWarning', 'anomalyStarted', 'upgradeOffered', 'upgradeSelected',
    ]));
    expect(coarse.snapshot).toMatchObject({ mode: 'playing', cycle: { number: 4, phase: 'settle' } });
  });

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
