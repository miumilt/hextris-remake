import { beforeEach, describe, expect, it } from 'vitest';
import { ScreenController } from '../src/ui/ScreenController';
import { GameEngine } from '../src/game/GameEngine';

describe('ScreenController', () => {
  let root: HTMLElement;
  beforeEach(() => {
    document.body.innerHTML = '<main id="ui-root"></main>';
    root = document.getElementById('ui-root')!;
  });
  const click = (action: string) => (document.querySelector(`[data-action="${action}"]`) as HTMLButtonElement).click();

  it('delegates nested play clicks to start and exposes only playing controls', () => {
    const engine = new GameEngine();
    const screen = new ScreenController(root);
    screen.bind({ start: () => engine.start(), resume: () => {}, restart: () => {}, returnToMenu: () => {}, togglePause: () => {} });
    screen.render('menu', 0);
    expect(root.querySelector('h1')?.textContent).toBe('HEXTRIS');
    expect(root.textContent).toContain('A / D');
    root.querySelector('button')!.innerHTML = '<span>PLAY</span>';
    (root.querySelector('button span') as HTMLElement).click();
    expect(engine.getSnapshot().mode).toBe('playing');
    screen.render('playing', 81);
    expect([...root.querySelectorAll('button')].map(button => button.dataset.action)).toEqual(['pause']);
    expect(root.querySelector('output')?.textContent).toBe('81');
  });

  it('preserves focused buttons on same-mode score updates', () => {
    const screen = new ScreenController(root);
    screen.render('playing', 0);
    const pause = root.querySelector('button')!;
    pause.focus();
    screen.render('playing', 144);
    expect(document.activeElement).toBe(pause);
    expect(root.querySelector('output')?.textContent).toBe('144');
  });

  it('routes all pause/result actions and removes its listener on destroy', () => {
    const actions: string[] = [];
    const screen = new ScreenController(root);
    const bindings = { start: () => actions.push('start'), resume: () => actions.push('resume'), restart: () => actions.push('restart'), returnToMenu: () => actions.push('menu'), togglePause: () => actions.push('pause') };
    screen.bind(bindings);
    screen.bind(bindings);
    screen.render('playing', 0); click('pause');
    screen.render('paused', 0);
    expect([...root.querySelectorAll('button')].map(button => button.dataset.action)).toEqual(['resume', 'restart', 'menu']);
    click('resume'); click('restart'); click('menu');
    screen.render('gameOver', 144);
    expect(root.textContent).toContain('144');
    expect([...root.querySelectorAll('button')].map(button => button.dataset.action)).toEqual(['retry', 'menu']);
    click('retry'); click('menu');
    screen.destroy(); click('retry');
    expect(actions).toEqual(['pause', 'resume', 'restart', 'menu', 'restart', 'menu']);
  });
});
