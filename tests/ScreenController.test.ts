import { beforeEach, describe, expect, it } from 'vitest';
import { ScreenController } from '../src/ui/ScreenController';
import { GameEngine } from '../src/game/GameEngine';
import type { GameSnapshot } from '../src/game/types';
import type { PresentationSnapshot } from '../src/presentation/PresentationSystem';

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
  const emptyPresentation = (): PresentationSnapshot => Object.freeze({
    notice: null,
    queuedNotices: Object.freeze([]),
    transfer: null,
    slotAttentionRemainingMs: 0,
    replacedBonus: null,
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
    screen.render(snapshot({ mode: 'menu' }), emptyPresentation());
    expect(root.querySelector('h1')?.textContent).toBe('HEXTRIS');
    expect(root.textContent).toContain('A / D');
    root.querySelector('button')!.innerHTML = '<span>PLAY</span>';
    (root.querySelector('button span') as HTMLElement).click();
    expect(engine.getSnapshot().mode).toBe('playing');
    screen.render(snapshot({ mode: 'playing', score: 81 }), emptyPresentation());
    expect([...root.querySelectorAll('button')].map(button => button.dataset.action)).toEqual(['pause']);
    expect(root.querySelector('output')?.textContent).toBe('81');
  });

  it('preserves focused buttons on same-mode score updates', () => {
    const screen = new ScreenController(root);
    screen.render(snapshot({ mode: 'playing', score: 0 }), emptyPresentation());
    const pause = root.querySelector('button')!;
    pause.focus();
    screen.render(snapshot({ mode: 'playing', score: 144 }), emptyPresentation());
    expect(document.activeElement).toBe(pause);
    expect(root.querySelector('output')?.textContent).toBe('144');
  });

  it('routes all pause/result actions and removes its listener on destroy', () => {
    const actions: string[] = [];
    const screen = new ScreenController(root);
    const bindings = { start: () => actions.push('start'), resume: () => actions.push('resume'), restart: () => actions.push('restart'), returnToMenu: () => actions.push('menu'), togglePause: () => actions.push('pause'), selectUpgrade: (index: 0 | 1) => actions.push(`select:${index}`), confirmUpgrade: () => actions.push('confirm') };
    screen.bind(bindings);
    screen.bind(bindings);
    screen.render(snapshot({ mode: 'playing' }), emptyPresentation()); click('pause');
    screen.render(snapshot({ mode: 'paused' }), emptyPresentation());
    expect([...root.querySelectorAll('button')].map(button => button.dataset.action)).toEqual(['resume', 'restart', 'menu']);
    click('resume'); click('restart'); click('menu');
    screen.render(snapshot({ mode: 'gameOver', score: 144 }), emptyPresentation());
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
    }), emptyPresentation());
    expect(root.querySelector('[aria-label="Score"]')?.textContent).toBe('81');
    expect(root.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('40');
    expect(root.querySelector('[role="progressbar"]')?.getAttribute('aria-valuetext')).toBe('Cycle 2, pressure');
    expect(root.querySelector('[aria-label="Stored bonus: PULSE"]')).not.toBeNull();
    expect(root.querySelectorAll('.upgrade-mark')).toHaveLength(3);
    expect(root.querySelector('[role="status"]')?.textContent).toContain('REVERSE');
    expect(root.querySelector('[data-action="pause"]')).not.toBeNull();

    screen.render(snapshot({ mode: 'playing' }), emptyPresentation());
    expect(root.querySelector('.bonus-slot')).toBeNull();
    expect(root.querySelector('[role="status"]')).toBeNull();
  });

  it('shows acquisition copy, a readable slot command, attention, and slow time', () => {
    const screen = new ScreenController(root);
    const presentation: PresentationSnapshot = Object.freeze({
      notice: Object.freeze({
        title: 'SLOW ACQUIRED',
        body: 'SLOWS FALLING BLOCKS FOR 6 SECONDS',
        tone: 'sky' as const,
        priority: 3 as const,
        ageMs: 0,
        lifetimeMs: 900,
        assertive: false,
      }),
      queuedNotices: Object.freeze([]),
      transfer: null,
      slotAttentionRemainingMs: 2500,
      replacedBonus: null,
    });

    screen.render(snapshot({
      mode: 'playing',
      bonus: { stored: 'slow', slowRemainingMs: 4200 },
    }), presentation);

    expect(root.querySelector('[role="status"]')?.textContent).toContain('SLOW ACQUIRED');
    expect(root.querySelector('[role="status"]')?.textContent).toContain('SLOWS FALLING BLOCKS FOR 6 SECONDS');
    expect(root.querySelector('.bonus-slot')?.textContent).toContain('SPACE');
    expect(root.querySelector('.bonus-slot')?.textContent).toContain('ACTIVATE');
    expect(root.querySelector('.bonus-slot')?.classList.contains('attention')).toBe(true);
    expect(root.querySelector('[aria-label="Slow remaining"]')?.getAttribute('aria-valuenow')).toBe('4200');
  });

  it('keeps the active slow timer visible after the inventory slot is consumed', () => {
    const screen = new ScreenController(root);

    screen.render(snapshot({
      mode: 'playing',
      bonus: { stored: null, slowRemainingMs: 4200 },
    }), emptyPresentation());

    expect(root.querySelector('.bonus-slot')).toBeNull();
    expect(root.querySelector('.slow-status')?.textContent).toContain('SLOW ACTIVE');
    expect(root.querySelector('[aria-label="Slow remaining"]')?.getAttribute('aria-valuenow')).toBe('4200');

    screen.render(snapshot({
      mode: 'playing',
      bonus: { stored: 'pulse', slowRemainingMs: 2100 },
    }), emptyPresentation());

    expect(root.querySelector('[aria-label="Stored bonus: PULSE"]')).not.toBeNull();
    expect(root.querySelector('.slow-status')?.classList.contains('with-slot')).toBe(true);
    expect(root.querySelector('[aria-label="Slow remaining"]')?.getAttribute('aria-valuenow')).toBe('2100');
  });

  it('shows the displaced old glyph while its replacement enters the slot', () => {
    const screen = new ScreenController(root);
    const replacement: PresentationSnapshot = Object.freeze({
      notice: Object.freeze({
        title: 'PULSE REPLACED SLOW', body: 'KNOCKS BLOCKS FROM OUTER SIDES',
        tone: 'amber', priority: 3, ageMs: 0, lifetimeMs: 950, assertive: false,
      }),
      queuedNotices: Object.freeze([]),
      transfer: null,
      slotAttentionRemainingMs: 2500,
      replacedBonus: 'slow',
    });

    screen.render(snapshot({
      mode: 'playing', bonus: { stored: 'pulse', slowRemainingMs: 0 },
    }), replacement);

    expect(root.querySelector('.bonus-glyph.current')?.textContent).toBe('⌁');
    expect(root.querySelector('[data-replaced-bonus="SLOW"]')?.textContent).toBe('Ⅱ');
  });

  it('preserves transient HUD nodes and focus across repeated renders and removal', () => {
    const screen = new ScreenController(root);
    const active: PresentationSnapshot = Object.freeze({
      notice: Object.freeze({
        title: 'PULSE ACQUIRED',
        body: 'KNOCKS BLOCKS FROM OUTER SIDES',
        tone: 'amber' as const,
        priority: 3 as const,
        ageMs: 120,
        lifetimeMs: 900,
        assertive: false,
      }),
      queuedNotices: Object.freeze([]),
      transfer: null,
      slotAttentionRemainingMs: 2300,
      replacedBonus: null,
    });
    const occupied = snapshot({ mode: 'playing', bonus: { stored: 'pulse', slowRemainingMs: 0 } });

    screen.render(occupied, active);
    const notice = root.querySelector('.presentation-notice');
    const slot = root.querySelector('.bonus-slot');
    const pause = root.querySelector<HTMLButtonElement>('[data-action="pause"]')!;
    pause.focus();
    screen.render(occupied, active);

    expect(root.querySelector('.presentation-notice')).toBe(notice);
    expect(root.querySelector('.bonus-slot')).toBe(slot);
    expect(document.activeElement).toBe(pause);

    screen.render(snapshot({ mode: 'playing' }), emptyPresentation());
    expect(root.querySelector('.presentation-notice')).toBeNull();
    expect(root.querySelector('.bonus-slot')).toBeNull();
    expect(document.activeElement).toBe(pause);
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
    }), emptyPresentation());
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
    screen.render(offer, emptyPresentation());
    const choices = [...root.querySelectorAll<HTMLButtonElement>('[data-action="upgrade"]')];
    expect(document.activeElement).toBe(choices[0]);
    const outside = document.createElement('button');
    document.body.append(outside);
    outside.focus();
    screen.render(offer, emptyPresentation());
    expect(document.activeElement).toBe(outside);
    screen.render({ ...offer, upgrades: { ...offer.upgrades, selectedIndex: 1 } }, emptyPresentation());
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
    }), emptyPresentation());
    expect(root.querySelectorAll('[data-action="upgrade"]')).toHaveLength(1);
    expect(root.querySelector('.upgrade-choices')?.classList.contains('singleton')).toBe(true);
  });

  it('preserves transient anomaly DOM so its entrance animation can finish', () => {
    const screen = new ScreenController(root);
    const warning = snapshot({
      mode: 'playing',
      cycle: { number: 2, phase: 'flow', elapsedMs: 24_000, durationMs: 55_000, progress: 0.44, warning: ['inertia'], warningRemainingMs: 600, anomalies: [] },
    });
    screen.render(warning, emptyPresentation());
    const status = root.querySelector('[role="status"]');
    screen.render(warning, emptyPresentation());
    expect(root.querySelector('[role="status"]')).toBe(status);
  });
});
