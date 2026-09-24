import { describe, expect, it } from 'vitest';
import { ThreatDirector } from '../src/game/ThreatDirector';
import { GameEngine } from '../src/game/GameEngine';
import { SeededRandom } from '../src/game/random';
import type { GameEvent } from '../src/game/types';
import { clampWaveProfile } from '../src/game/UpgradeSystem';

const modifiers = { anomalyDurationMultiplier: 1, bonusIntervalMultiplier: 1 };

describe('endless threat pressure', () => {
  it('spawns a forced Pressure circle once at its authored lanes, then resumes ordinary waves', () => {
    const game = new GameEngine({ randomSeed: 31, maxStackDepth: 100,
      director: { forcedSituationsByCycle: { 1: { pattern: 'circle', anchorLane: 2, anomalies: [] } } } });
    game.start();
    game.update(55_000);
    expect(game.getSnapshot().cycle).toMatchObject({ phase: 'pressure',
      threat: { pattern: 'circle', anchorLane: 2, lanes: [2, 3, 4, 5, 0, 1] } });

    const batches: { atMs: number; lanes: number[] }[] = [];
    for (let index = 1; index <= 100; index += 1) {
      const lanes = game.update(100).filter((event) => event.type === 'blockSpawned')
        .map((event) => event.block.lane);
      if (lanes.length > 0) batches.push({ atMs: index * 100, lanes });
    }
    const authored = batches.filter(({ lanes }) => lanes.length === 6);
    expect(authored).toHaveLength(1);
    expect(authored[0]!.lanes).toEqual([2, 3, 4, 5, 0, 1]);
    expect(authored[0]!.atMs).toBe(1_400);
    expect(batches.some(({ atMs }) => atMs > authored[0]!.atMs)).toBe(true);
  });

  it('keeps modified late spawning inside both practical ceilings', () => {
    const result = clampWaveProfile({ intervalMs: 410, speed: 590,
      patternWeights: { single: 1, pair: 0, opposite: 0, halfCircle: 0, circle: 0, spiral: 0 },
      forcedPattern: null, forcedPatternSequence: null, forcedAnchorLane: null,
      authoredWaveId: null, entryDelayMs: 0 }, 1.4);
    expect(result.speed).toBe(600);
    expect(result.intervalMs).toBe(500);
  });

  it('schedules each bonus 35-50 active seconds apart outside pressure and warnings', () => {
    const director = new ThreatDirector(new SeededRandom(21));
    const moments: { at: number; phase: string; warning: readonly string[] }[] = [];
    const upgradeCycles: number[] = [];
    while (director.getSnapshot().totalActiveMs < 500_000) {
      const tick = director.update(director.getNextEventMs(modifiers), modifiers);
      const snapshot = director.getSnapshot();
      if (tick.bonusDue) moments.push({ at: snapshot.totalActiveMs,
        phase: snapshot.phase, warning: snapshot.warning });
      if (tick.upgradeDue) {
        upgradeCycles.push(snapshot.number);
        director.beginNextCycle();
      }
    }
    expect(moments.length).toBeGreaterThan(8);
    expect(moments[0]!.at).toBeGreaterThanOrEqual(35_000);
    expect(moments[0]!.at).toBeLessThanOrEqual(50_000);
    expect(moments.slice(1).every((moment, index) => {
      const gap = moment.at - moments[index]!.at;
      return gap >= 35_000 && gap <= 50_000;
    })).toBe(true);
    expect(moments.every(({ phase, warning }) =>
      !['pressure', 'release'].includes(phase) && warning.length === 0)).toBe(true);
    expect(upgradeCycles.slice(0, 2)).toEqual([3, 6]);
  });

  it('does not invent a bonus when an upgrade resumes at zero elapsed time', () => {
    const game = new GameEngine({ randomSeed: 1, spawning: false });
    game.start();
    game.update(225_000);
    expect(game.getSnapshot().mode).toBe('upgrade');

    game.enqueue({ type: 'confirmUpgrade' });
    const resumed = game.update(0);
    expect(game.getSnapshot().cycle).toMatchObject({ number: 4, phase: 'settle', elapsedMs: 0 });
    expect(resumed.filter(({ type }) => type === 'bonusScheduled')).toHaveLength(0);
    expect(game.update(0).filter(({ type }) => type === 'bonusScheduled')).toHaveLength(0);
  });

  it('keeps scheduled bonus events and state identical across upgrade-resume chunks', () => {
    const resume = (chunks: readonly number[]) => {
      const game = new GameEngine({ randomSeed: 1, spawning: false });
      game.start();
      game.update(225_000);
      expect(game.getSnapshot().mode).toBe('upgrade');
      game.enqueue({ type: 'confirmUpgrade' });
      const events = chunks.flatMap((chunk) => game.update(chunk));
      return { events, snapshot: game.getSnapshot() };
    };

    const fromZero = resume([0, 500]);
    expect(fromZero.events.filter(({ type }) => type === 'bonusScheduled')).toHaveLength(1);
    expect(resume([500])).toEqual(fromZero);
    expect(resume([250, 250])).toEqual(fromZero);
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
