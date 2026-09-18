import { beforeEach, describe, expect, it } from 'vitest';
import { ScreenController } from '../src/ui/ScreenController';
import { GameEngine } from '../src/game/GameEngine';
import type { GameSnapshot } from '../src/game/types';

describe('ScreenController', () => {
  let root: HTMLElement;
  beforeEach(() => {
    document.body.innerHTML = '<main id="ui-root"></main>';
    root = document.getElementById('ui-root')!;
  });
  const click = (action: string) => (document.querySelector(`[data-action="${action}"]`) as HTMLButtonElement).click();
  const snapshot = (overrides: Partial<GameSnapshot> = {}): GameSnapshot => ({
    ...new GameEngine().getSnapshot(),
    ...overrides,
  });
  const actions = (calls: string[] = []) => ({
    start: () => calls.push('start'), resume: () => calls.push('resume'),
    restart: () => calls.push('restart'), returnToMenu: () => calls.push('menu'),
    togglePause: () => calls.push('pause'),
    selectUpgrade: (index: 0 | 1) => calls.push(`select:${index}`),
    confirmUpgrade: () => calls.push('confirm'),
  });

  it('delegates nested play clicks to start and exposes only playing controls', () => {
    const engine = new GameEngine();
    const screen = new ScreenController(root);
    screen.bind({ ...actions(), start: () => engine.start() });
    screen.render(snapshot({ mode: 'menu' }));
    expect(root.querySelector('h1')?.textContent).toBe('HEXTRIS');
    expect(root.textContent).toContain('A / D');
    root.querySelector('button')!.innerHTML = '<span>PLAY</span>';
    (root.querySelector('button span') as HTMLElement).click();
    expect(engine.getSnapshot().mode).toBe('playing');
    screen.render(snapshot({ mode: 'playing', score: 81 }));
    expect([...root.querySelectorAll('button')].map(button => button.dataset.action)).toEqual(['pause']);
    expect(root.querySelector('output')?.textContent).toBe('81');
  });

  it('preserves focused buttons on same-mode score updates', () => {
    const screen = new ScreenController(root);
    screen.render(snapshot({ mode: 'playing', score: 0 }));
    const pause = root.querySelector('button')!;
    pause.focus();
    screen.render(snapshot({ mode: 'playing', score: 144 }));
    expect(document.activeElement).toBe(pause);
    expect(root.querySelector('output')?.textContent).toBe('144');
  });

  it('routes all pause/result actions and removes its listener on destroy', () => {
    const actions: string[] = [];
    const screen = new ScreenController(root);
    const bindings = { start: () => actions.push('start'), resume: () => actions.push('resume'), restart: () => actions.push('restart'), returnToMenu: () => actions.push('menu'), togglePause: () => actions.push('pause'), selectUpgrade: (index: 0 | 1) => actions.push(`select:${index}`), confirmUpgrade: () => actions.push('confirm') };
    screen.bind(bindings);
    screen.bind(bindings);
    screen.render(snapshot({ mode: 'playing' })); click('pause');
    screen.render(snapshot({ mode: 'paused' }));
    expect([...root.querySelectorAll('button')].map(button => button.dataset.action)).toEqual(['resume', 'restart', 'menu']);
    click('resume'); click('restart'); click('menu');
    screen.render(snapshot({ mode: 'gameOver', score: 144 }));
    expect(root.textContent).toContain('144');
    expect([...root.querySelectorAll('button')].map(button => button.dataset.action)).toEqual(['retry', 'menu']);
    click('retry'); click('menu');
    screen.destroy(); click('retry');
    expect(actions).toEqual(['pause', 'resume', 'restart', 'menu', 'restart', 'menu']);
  });

  it('renders the authored playing HUD from the complete snapshot', () => {
    const screen = new ScreenController(root);
    screen.render(snapshot({
      mode: 'playing', score: 81,
      cycle: { number: 2, phase: 'pressure', elapsedMs: 8_000, durationMs: 55_000, progress: 0.4, warning: ['reverse'], warningRemainingMs: 2_000, anomalies: [] },
      bonus: { stored: 'pulse', slowRemainingMs: 0 },
      upgrades: { levels: { stabilizer: 2, comboRelay: 0, salvage: 1, deepPulse: 0, anomalyShield: 0, lastStand: 0 }, choices: [], selectedIndex: 0 },
    }));
    expect(root.querySelector('[aria-label="Score"]')?.textContent).toBe('81');
    expect(root.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('40');
    expect(root.querySelector('[role="progressbar"]')?.getAttribute('aria-valuetext')).toBe('Cycle 2, pressure');
    expect(root.querySelector('[aria-label="Stored bonus: PULSE"]')).not.toBeNull();
    expect(root.querySelectorAll('.upgrade-mark')).toHaveLength(3);
    expect(root.querySelector('[role="status"]')?.textContent).toContain('REVERSE');
    expect(root.querySelector('[data-action="pause"]')).not.toBeNull();

    screen.render(snapshot({ mode: 'playing' }));
    expect(root.querySelector('.bonus-slot')).toBeNull();
    expect(root.querySelector('[role="status"]')).toBeNull();
  });

  it('renders exactly the offered angular upgrade actions and confirms the clicked side', () => {
    const calls: string[] = [];
    const screen = new ScreenController(root);
    screen.bind(actions(calls));
    screen.render(snapshot({
      mode: 'upgrade',
      upgrades: {
        levels: { stabilizer: 0, comboRelay: 0, salvage: 0, deepPulse: 0, anomalyShield: 0, lastStand: 0 },
        selectedIndex: 0,
        choices: [
          { id: 'stabilizer', level: 0, maxLevel: 3, label: 'STABILIZER', description: 'FALL SPEED -4%' },
          { id: 'deepPulse', level: 1, maxLevel: 2, label: 'DEEP PULSE', description: 'PULSE HITS +1 SIDE' },
        ],
      },
    }));
    const choices = [...root.querySelectorAll<HTMLButtonElement>('[data-action="upgrade"]')];
    expect(choices).toHaveLength(2);
    expect(choices.map((choice) => choice.getAttribute('aria-pressed'))).toEqual(['true', 'false']);
    expect(choices[0]!.hasAttribute('aria-label')).toBe(false);
    const labelledBy = choices[0]!.getAttribute('aria-labelledby')!.split(' ');
    expect(labelledBy.map((id) => document.getElementById(id)?.textContent?.trim())).toEqual(['STABILIZER', 'LEVEL 1 / 3']);
    const describedBy = choices[0]!.getAttribute('aria-describedby')!;
    expect(document.getElementById(describedBy)?.textContent).toBe('FALL SPEED -4%');
    expect(document.activeElement).toBe(choices[0]);
    expect(root.querySelector('h1')?.textContent).toBe('CHOOSE UPGRADE');
    expect(root.textContent).toContain('STABILIZER');
    expect(root.textContent).toContain('FALL SPEED -4%');
    expect(root.textContent).toContain('DEEP PULSE');
    expect(root.textContent).toContain('PULSE HITS +1 SIDE');
    expect(root.textContent?.toLowerCase()).not.toMatch(/settings|store/);
    choices[1]!.click();
    expect(calls).toEqual(['select:1', 'confirm']);
  });

  it('moves upgrade focus on selection changes without refocusing unchanged RAF renders', () => {
    const screen = new ScreenController(root);
    const offer = snapshot({
      mode: 'upgrade',
      upgrades: {
        levels: { stabilizer: 0, comboRelay: 0, salvage: 0, deepPulse: 0, anomalyShield: 0, lastStand: 0 },
        selectedIndex: 0,
        choices: [
          { id: 'stabilizer', level: 0, maxLevel: 3, label: 'STABILIZER', description: 'FALL SPEED -4%' },
          { id: 'deepPulse', level: 1, maxLevel: 2, label: 'DEEP PULSE', description: 'PULSE HITS +1 SIDE' },
        ],
      },
    });
    screen.render(offer);
    const choices = [...root.querySelectorAll<HTMLButtonElement>('[data-action="upgrade"]')];
    expect(document.activeElement).toBe(choices[0]);
    const outside = document.createElement('button');
    document.body.append(outside);
    outside.focus();
    screen.render(offer);
    expect(document.activeElement).toBe(outside);
    screen.render({ ...offer, upgrades: { ...offer.upgrades, selectedIndex: 1 } });
    expect(document.activeElement).toBe(choices[1]);
  });

  it('renders a singleton offer as one intentional upgrade action', () => {
    const screen = new ScreenController(root);
    screen.render(snapshot({
      mode: 'upgrade',
      upgrades: {
        levels: { stabilizer: 3, comboRelay: 3, salvage: 3, deepPulse: 2, anomalyShield: 3, lastStand: 0 },
        selectedIndex: 0,
        choices: [{ id: 'lastStand', level: 0, maxLevel: 1, label: 'LAST STAND', description: 'SURVIVE ONE OVERFLOW' }],
      },
    }));
    expect(root.querySelectorAll('[data-action="upgrade"]')).toHaveLength(1);
    expect(root.querySelector('.upgrade-choices')?.classList.contains('singleton')).toBe(true);
  });

  it('preserves transient anomaly DOM so its entrance animation can finish', () => {
    const screen = new ScreenController(root);
    const warning = snapshot({
      mode: 'playing',
      cycle: { number: 2, phase: 'flow', elapsedMs: 24_000, durationMs: 55_000, progress: 0.44, warning: ['inertia'], warningRemainingMs: 600, anomalies: [] },
    });
    screen.render(warning);
    const status = root.querySelector('[role="status"]');
    screen.render(warning);
    expect(root.querySelector('[role="status"]')).toBe(status);
  });
});
