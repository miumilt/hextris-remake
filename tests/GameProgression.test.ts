import { describe, expect, it } from 'vitest';
import { GameEngine } from '../src/game/GameEngine';

describe('GameEngine threat progression', () => {
  it('continues through the first two cycles and offers an upgrade only after the third', () => {
    const game = new GameEngine({ spawning: false });
    game.start();

    const first = game.update(75_000);
    expect(first).toContainEqual({ type: 'cycleCompleted', cycle: 1 });
    expect(first.some(({ type }) => type === 'upgradeOffered')).toBe(false);
    expect(game.getSnapshot()).toMatchObject({ mode: 'playing', cycle: { number: 2, phase: 'settle' } });

    const second = game.update(75_000);
    expect(second).toContainEqual({ type: 'cycleCompleted', cycle: 2 });
    expect(second.some(({ type }) => type === 'upgradeOffered')).toBe(false);
    expect(game.getSnapshot()).toMatchObject({ mode: 'playing', cycle: { number: 3, phase: 'settle' } });

    const third = game.update(75_000);
    expect(third).toEqual(expect.arrayContaining([
      { type: 'cycleCompleted', cycle: 3 },
      expect.objectContaining({ type: 'upgradeOffered' }),
    ]));
    expect(game.getSnapshot().mode).toBe('upgrade');
  });

  it('resumes exactly once into cycle four when confirming the third-cycle upgrade', () => {
    const game = new GameEngine({ spawning: false });
    game.start();
    game.update(225_000);
    expect(game.getSnapshot()).toMatchObject({ mode: 'upgrade', cycle: { number: 3, elapsedMs: 75_000 } });

    game.enqueue({ type: 'confirmUpgrade' });
    const events = game.update(0);

    expect(events).toContainEqual(expect.objectContaining({ type: 'upgradeSelected' }));
    expect(game.getSnapshot()).toMatchObject({ mode: 'playing', cycle: { number: 4, phase: 'settle', elapsedMs: 0 } });
  });

  it('keeps the deprecated cycle option as a director compatibility alias', () => {
    const game = new GameEngine({
      spawning: false,
      cycle: { forcedAnomaliesByCycle: { 2: ['reverse'] } },
    });
    game.start();
    game.update(75_000);
    for (let elapsedMs = 0; elapsedMs < 30_000 && game.getSnapshot().cycle.warning.length === 0; elapsedMs += 1_000) {
      game.update(1_000);
    }

    expect(game.getSnapshot().cycle.warning).toEqual(['reverse']);
  });
});
