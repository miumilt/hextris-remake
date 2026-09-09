import { describe, expect, it } from 'vitest';
import { CycleDirector } from '../src/game/CycleDirector';
import { GameEngine } from '../src/game/GameEngine';
import { SeededRandom } from '../src/game/random';

function runThreeCycles(frameMs: 250 | 500) {
  const game = new GameEngine({
    randomSeed: 14,
    spawning: false,
    maxStackDepth: 2,
    cycle: { forcedAnomaliesByCycle: { 2: ['reverse'], 3: ['drift'] } },
  });
  const eventTypes: string[] = [];
  const selectedUpgrades: string[] = [];
  let warningFrozen = false;
  let upgradeFrozen = false;
  game.start();

  for (let expectedCycle = 1; expectedCycle <= 3; expectedCycle += 1) {
    let pausedWarning = false;
    while (game.getSnapshot().mode === 'playing') {
      const events = game.update(frameMs);
      eventTypes.push(...events.map(({ type }) => type));
      const current = game.getSnapshot();
      if (expectedCycle === 2 && !pausedWarning && current.cycle.warning.length > 0) {
        pausedWarning = true;
        game.enqueue({ type: 'togglePause' });
        game.update(0);
        const paused = JSON.stringify(game.getSnapshot());
        game.update(5_000);
        warningFrozen = JSON.stringify(game.getSnapshot()) === paused;
        game.enqueue({ type: 'togglePause' });
        game.update(0);
      }
    }

    const offered = game.getSnapshot();
    expect(offered).toMatchObject({ mode: 'upgrade', cycle: { number: expectedCycle } });
    const beforeFrozenUpdate = JSON.stringify(offered);
    game.update(5_000);
    upgradeFrozen ||= JSON.stringify(game.getSnapshot()) === beforeFrozenUpdate;
    const selected = game.getSnapshot().upgrades.choices[game.getSnapshot().upgrades.selectedIndex]!;
    selectedUpgrades.push(selected.id);
    game.enqueue({ type: 'confirmUpgrade' });
    eventTypes.push(...game.update(0).map(({ type }) => type));

    if (expectedCycle === 2) {
      expect(game.getSnapshot().bonus.stored).not.toBeNull();
      game.enqueue({ type: 'activateBonus' });
      eventTypes.push(...game.update(0).map(({ type }) => type));
      expect(game.getSnapshot().bonus.stored).toBeNull();
    }
  }

  game.debugAttachGroup('coral', [{ side: 2, count: 2 }]);
  eventTypes.push(...game.update(0).map(({ type }) => type));
  const rescued = game.getSnapshot();
  game.debugAttachGroup('amber', [{ side: 2, count: 2 }]);
  eventTypes.push(...game.update(0).map(({ type }) => type));

  return {
    eventTypes,
    selectedUpgrades,
    warningFrozen,
    upgradeFrozen,
    rescued,
    final: game.getSnapshot(),
  };
}

describe('complete endless-run progression', () => {
  it('keeps three cycles deterministic across frame sequences and reaches rescue before game over', () => {
    const coarse = runThreeCycles(500);
    const fine = runThreeCycles(250);

    expect(coarse).toEqual(fine);
    expect(coarse.selectedUpgrades).toHaveLength(3);
    expect(coarse.selectedUpgrades[0]).toBe('lastStand');
    expect(coarse.warningFrozen).toBe(true);
    expect(coarse.upgradeFrozen).toBe(true);
    expect(coarse.eventTypes).toEqual(expect.arrayContaining([
      'bonusCollected', 'bonusReplaced', 'bonusActivated',
      'anomalyWarning', 'anomalyStarted', 'anomalyEnded',
      'upgradeOffered', 'upgradeSelected', 'lastStand', 'gameOver',
    ]));
    expect(coarse.rescued).toMatchObject({
      mode: 'playing',
      upgrades: { levels: { lastStand: 0 } },
      stacks: [[], [], [], [], [], []],
    });
    expect(coarse.final.mode).toBe('gameOver');
  });

  it('keeps late-cycle pressure monotonic until the authored mathematical caps', () => {
    const director = new CycleDirector(new SeededRandom(17));
    const profiles: { cycle: number; speed: number; intervalMs: number }[] = [];
    const modifiers = { anomalyDurationMultiplier: 1, bonusIntervalMultiplier: 1 };
    for (let cycle = 1; cycle <= 12; cycle += 1) {
      if ([1, 3, 6, 9, 12].includes(cycle)) {
        const profile = director.getWaveProfile();
        profiles.push({ cycle, speed: profile.speed, intervalMs: profile.intervalMs });
      }
      director.update(55_000, modifiers);
      director.beginNextCycle();
    }

    expect(profiles).toEqual([
      { cycle: 1, speed: 150, intervalMs: 2700 },
      { cycle: 3, speed: 315, intervalMs: expect.closeTo(1296.824, 3) },
      { cycle: 6, speed: 562.5, intervalMs: expect.closeTo(431.675, 3) },
      { cycle: 9, speed: 780, intervalMs: 320 },
      { cycle: 12, speed: 780, intervalMs: 320 },
    ]);
    expect(320 * 0.52).toBeGreaterThanOrEqual(160);
  });
});
