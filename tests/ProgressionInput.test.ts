import { afterEach, describe, expect, it } from 'vitest';
import { GameEngine } from '../src/game/GameEngine';
import { InputController } from '../src/runtime/InputController';
import { ScreenController } from '../src/ui/ScreenController';
import { PresentationSystem } from '../src/presentation/PresentationSystem';

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()));

function progressionInput(randomSeed = 1) {
  const game = new GameEngine({ randomSeed, spawning: false });
  game.start();
  const input = new InputController(window, (command) => game.enqueue(command), () => game.getSnapshot().mode);
  input.start();
  cleanups.push(() => input.stop());
  return game;
}

function key(game: GameEngine, value: string) {
  const event = new KeyboardEvent('keydown', { key: value, cancelable: true });
  window.dispatchEvent(event);
  const events = game.update(0);
  return { event, events };
}

describe('progression keyboard input', () => {
  it('uses arrows for rotation while playing and selection while choosing', () => {
    const game = progressionInput();
    key(game, 'ArrowRight');
    expect(game.getSnapshot().orientation).toBe(5);
    game.update(225_000);
    expect(game.getSnapshot().mode).toBe('upgrade');
    expect(game.getSnapshot().upgrades.selectedIndex).toBe(0);
    key(game, 'ArrowRight');
    expect(game.getSnapshot()).toMatchObject({ mode: 'upgrade', orientation: 5, upgrades: { selectedIndex: 1 } });
    key(game, 'ArrowLeft');
    expect(game.getSnapshot().upgrades.selectedIndex).toBe(0);
  });

  it('transfers visible focus after an arrow changes the selected upgrade', () => {
    const game = progressionInput();
    game.update(225_000);
    document.body.innerHTML = '<main id="ui-root"></main>';
    const screen = new ScreenController(document.getElementById('ui-root')!);
    const presentation = new PresentationSystem().snapshot();
    cleanups.push(() => screen.destroy());
    screen.render(game.getSnapshot(), presentation);
    const choices = [...document.querySelectorAll<HTMLButtonElement>('[data-action="upgrade"]')];
    expect(document.activeElement).toBe(choices[0]);
    key(game, 'ArrowRight');
    screen.render(game.getSnapshot(), presentation);
    expect(document.activeElement).toBe(choices[1]);
  });

  it.each([' ', 'Space', 'Enter'])(`confirms an upgrade with %s`, (button) => {
    const game = progressionInput();
    game.update(225_000);
    const selected = game.getSnapshot().upgrades.choices[0]!.id;
    const { event, events } = key(game, button);
    expect(event.defaultPrevented).toBe(true);
    expect(events).toContainEqual({ type: 'upgradeSelected', upgrade: selected, level: 1 });
    expect(game.getSnapshot()).toMatchObject({ mode: 'playing', cycle: { number: 4 } });
  });

  it('does not map Enter while playing and keeps reverse inside the engine', () => {
    const game = new GameEngine({
      spawning: false,
      cycle: { forcedAnomaliesByCycle: { 2: ['reverse'] } },
    });
    game.start();
    const commands: unknown[] = [];
    const input = new InputController(window, (command) => { commands.push(command); game.enqueue(command); }, () => game.getSnapshot().mode);
    input.start();
    cleanups.push(() => input.stop());
    const enter = key(game, 'Enter').event;
    expect(enter.defaultPrevented).toBe(false);
    expect(commands).toEqual([]);
    game.update(75_000);
    key(game, 'Enter');
    for (let attempt = 0; attempt < 30 && game.getSnapshot().cycle.warning.length === 0; attempt += 1) {
      game.update(1_000);
    }
    expect(game.getSnapshot().cycle.warning).not.toHaveLength(0);
    game.update(game.getSnapshot().cycle.warningRemainingMs);
    expect(game.getSnapshot().cycle.anomalies.map((anomaly) => anomaly.type)).toEqual(['reverse']);
    const before = game.getSnapshot().orientation;
    key(game, 'ArrowLeft');
    expect(commands.at(-1)).toEqual({ type: 'rotate', steps: 1 });
    expect(game.getSnapshot().orientation).toBe((before + 5) % 6);
  });
});
