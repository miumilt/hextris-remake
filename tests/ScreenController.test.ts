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
    opening: null,
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
    expect(root.textContent).toContain('ИГРАТЬ');
    expect(root.textContent).toContain('ВРАЩАТЬ');
    expect(root.textContent).toContain('ПАУЗА');
    root.querySelector('button')!.innerHTML = '<span>ИГРАТЬ</span>';
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
    expect(root.textContent).toContain('ПАУЗА');
    expect(root.textContent).toContain('ПРОДОЛЖИТЬ');
    expect([...root.querySelectorAll('button')].map(button => button.dataset.action)).toEqual(['resume', 'restart', 'menu']);
    click('resume'); click('restart'); click('menu');
    screen.render(snapshot({ mode: 'gameOver', score: 144 }), emptyPresentation());
    expect(root.textContent).toContain('144');
    expect(root.textContent).toContain('ИГРА ОКОНЧЕНА');
    expect(root.textContent).toContain('ЕЩЁ РАЗ');
    expect([...root.querySelectorAll('button')].map(button => button.dataset.action)).toEqual(['retry', 'menu']);
    click('retry'); click('menu');
    screen.destroy(); click('retry');
    expect(actions).toEqual(['pause', 'resume', 'restart', 'menu', 'restart', 'menu']);
  });

  it('renders the authored playing HUD from the complete snapshot', () => {
    const screen = new ScreenController(root);
    screen.render(snapshot({
      mode: 'playing', score: 81,
      cycle: { number: 2, phase: 'pressure', elapsedMs: 8_000, totalActiveMs: 83_000, durationMs: 75_000, progress: 0.4, warning: ['reverse'], warningRemainingMs: 2_000, anomalies: [], threat: null },
      bonus: { stored: 'pulse', slowRemainingMs: 0 },
      upgrades: { levels: { stabilizer: 2, comboRelay: 0, salvage: 1, deepPulse: 0, anomalyShield: 0, lastStand: 0 }, choices: [], selectedIndex: 0 },
    }), emptyPresentation());
    expect(root.querySelector('[aria-label="Счёт"]')?.textContent).toBe('81');
    expect(root.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('40');
    expect(root.querySelector('[role="progressbar"]')?.getAttribute('aria-valuetext')).toBe('Цикл 2, давление');
    expect(root.querySelector('[aria-label^="Сохранённый бонус: ИМПУЛЬС"]')).not.toBeNull();
    expect(root.querySelectorAll('.upgrade-mark')).toHaveLength(3);
    expect(root.querySelector('.upgrade-mark')?.getAttribute('title')).toBe('СТАБИЛИЗАТОР — УРОВЕНЬ 1');
    expect(root.querySelector('.field-warning')?.textContent).toContain('РЕВЕРС');
    expect(root.querySelector('[data-action="pause"]')).not.toBeNull();

    screen.render(snapshot({ mode: 'playing' }), emptyPresentation());
    expect(root.querySelector('.bonus-slot')).toBeNull();
    expect(root.querySelector('[role="status"]')).toBeNull();
  });

  it('shows acquisition copy, a readable slot command, attention, and slow time', () => {
    const screen = new ScreenController(root);
    const presentation: PresentationSnapshot = Object.freeze({
      opening: null,
      notice: Object.freeze({
        title: 'БОНУС: ЗАМЕДЛЕНИЕ',
        body: 'ЗАМЕДЛЯЕТ ПАДАЮЩИЕ БЛОКИ НА 6 СЕКУНД',
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

    expect(root.querySelector('[role="status"]')?.textContent).toContain('БОНУС: ЗАМЕДЛЕНИЕ');
    expect(root.querySelector('[role="status"]')?.textContent).toContain('ЗАМЕДЛЯЕТ ПАДАЮЩИЕ БЛОКИ НА 6 СЕКУНД');
    expect(root.querySelector('.bonus-slot')?.textContent).toContain('ПРОБЕЛ');
    expect(root.querySelector('.bonus-slot')?.textContent).toContain('ИСПОЛЬЗОВАТЬ');
    expect(root.querySelector('.bonus-slot')?.classList.contains('attention')).toBe(true);
    expect(root.querySelector('[aria-label="Осталось замедления"]')?.getAttribute('aria-valuenow')).toBe('4200');
  });

  it('keeps the active slow timer visible after the inventory slot is consumed', () => {
    const screen = new ScreenController(root);

    screen.render(snapshot({
      mode: 'playing',
      bonus: { stored: null, slowRemainingMs: 4200 },
    }), emptyPresentation());

    expect(root.querySelector('.bonus-slot')).toBeNull();
    expect(root.querySelector('.slow-status')?.textContent).toContain('ЗАМЕДЛЕНИЕ АКТИВНО');
    expect(root.querySelector('[aria-label="Осталось замедления"]')?.getAttribute('aria-valuenow')).toBe('4200');

    screen.render(snapshot({
      mode: 'playing',
      bonus: { stored: 'pulse', slowRemainingMs: 2100 },
    }), emptyPresentation());

    expect(root.querySelector('[aria-label^="Сохранённый бонус: ИМПУЛЬС"]')).not.toBeNull();
    expect(root.querySelector('.slow-status')?.classList.contains('with-slot')).toBe(true);
    expect(root.querySelector('[aria-label="Осталось замедления"]')?.getAttribute('aria-valuenow')).toBe('2100');
  });

  it('shows the displaced old glyph while its replacement enters the slot', () => {
    const screen = new ScreenController(root);
    const replacement: PresentationSnapshot = Object.freeze({
      opening: null,
      notice: Object.freeze({
        title: 'ИМПУЛЬС ЗАМЕНИЛ ЗАМЕДЛЕНИЕ', body: 'СБРАСЫВАЕТ КРАЙНИЕ БЛОКИ',
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
    expect(root.querySelector('[data-replaced-bonus="ЗАМЕДЛЕНИЕ"]')?.textContent).toBe('Ⅱ');
  });

  it('preserves transient HUD nodes and focus across repeated renders and removal', () => {
    const screen = new ScreenController(root);
    const active: PresentationSnapshot = Object.freeze({
      opening: null,
      notice: Object.freeze({
        title: 'БОНУС: ИМПУЛЬС',
        body: 'СБРАСЫВАЕТ КРАЙНИЕ БЛОКИ',
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
          { id: 'stabilizer', level: 0, maxLevel: 3, label: 'СТАБИЛИЗАТОР', description: 'СКОРОСТЬ ПАДЕНИЯ −4%' },
          { id: 'deepPulse', level: 1, maxLevel: 2, label: 'ГЛУБОКИЙ ИМПУЛЬС', description: 'ИМПУЛЬС ЗАХВАТЫВАЕТ +1 СТОРОНУ' },
        ],
      },
    }), emptyPresentation());
    const choices = [...root.querySelectorAll<HTMLButtonElement>('[data-action="upgrade"]')];
    expect(choices).toHaveLength(2);
    expect(choices.map((choice) => choice.getAttribute('aria-pressed'))).toEqual(['true', 'false']);
    expect(choices[0]!.hasAttribute('aria-label')).toBe(false);
    const labelledBy = choices[0]!.getAttribute('aria-labelledby')!.split(' ');
    expect(labelledBy.map((id) => document.getElementById(id)?.textContent?.trim())).toEqual(['СТАБИЛИЗАТОР', 'УРОВЕНЬ 1 / 3']);
    const describedBy = choices[0]!.getAttribute('aria-describedby')!;
    expect(document.getElementById(describedBy)?.textContent).toBe('СКОРОСТЬ ПАДЕНИЯ −4%');
    expect(document.activeElement).toBe(choices[0]);
    expect(root.querySelector('h1')?.textContent).toBe('ВЫБЕРИ УЛУЧШЕНИЕ');
    expect(root.textContent).toContain('СТАБИЛИЗАТОР');
    expect(root.textContent).toContain('СКОРОСТЬ ПАДЕНИЯ −4%');
    expect(root.textContent).toContain('ГЛУБОКИЙ ИМПУЛЬС');
    expect(root.textContent).toContain('ИМПУЛЬС ЗАХВАТЫВАЕТ +1 СТОРОНУ');
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
          { id: 'stabilizer', level: 0, maxLevel: 3, label: 'СТАБИЛИЗАТОР', description: 'СКОРОСТЬ ПАДЕНИЯ −4%' },
          { id: 'deepPulse', level: 1, maxLevel: 2, label: 'ГЛУБОКИЙ ИМПУЛЬС', description: 'ИМПУЛЬС ЗАХВАТЫВАЕТ +1 СТОРОНУ' },
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
        choices: [{ id: 'lastStand', level: 0, maxLevel: 1, label: 'ПОСЛЕДНИЙ ШАНС', description: 'ПЕРЕЖИТЬ ОДНО ПЕРЕПОЛНЕНИЕ' }],
      },
    }), emptyPresentation());
    expect(root.querySelectorAll('[data-action="upgrade"]')).toHaveLength(1);
    expect(root.querySelector('.upgrade-choices')?.classList.contains('singleton')).toBe(true);
  });

  it('preserves transient anomaly DOM so its entrance animation can finish', () => {
    const screen = new ScreenController(root);
    const warning = snapshot({
      mode: 'playing',
      cycle: { number: 2, phase: 'build', elapsedMs: 24_000, totalActiveMs: 99_000, durationMs: 75_000, progress: 0.44, warning: ['inertia'], warningRemainingMs: 600, anomalies: [], threat: null },
    });
    screen.render(warning, emptyPresentation());
    const status = root.querySelector('.field-warning');
    screen.render(warning, emptyPresentation());
    expect(root.querySelector('.field-warning')).toBe(status);
  });

  it('keeps complete bonus meaning in its slot after acquisition copy expires', () => {
    const screen = new ScreenController(root);
    screen.render(snapshot({ mode: 'playing', bonus: { stored: 'pulse', slowRemainingMs: 0 } }), emptyPresentation());
    const slot = root.querySelector('.bonus-slot');
    expect(slot?.textContent).toContain('ИМПУЛЬС');
    expect(slot?.textContent).toContain('СБРАСЫВАЕТ КРАЙНИЕ БЛОКИ');
    expect(slot?.textContent).toContain('ПРОБЕЛ');
    expect(slot?.getAttribute('aria-label')).toContain('Сбрасывает крайние блоки');
    expect(root.querySelector('.presentation-notice')).toBeNull();
  });

  it('pins warning and overflow danger to the affected sides', () => {
    const screen = new ScreenController(root);
    const current = snapshot({ mode: 'playing' });
    const stacks = current.stacks.map((stack, side) => side === 1
      ? Array.from({ length: 10 }, (_, id) => ({ id: id + 1, color: 'coral' as const })) : stack);
    screen.render({
      ...current, stacks,
      cycle: { ...current.cycle, warning: ['drift'], warningRemainingMs: 2500,
        threat: { pattern: 'pair', anchorLane: 4, lanes: [4, 5], anomalies: ['drift'],
          warningMs: 2500, entryDelayMs: 0, bonusIncompatible: false,
          evidence: { seedCycle: 2, phase: 'pressure', budget: 6, spent: 4, combinationKey: 'pair:drift:4' } } },
    }, emptyPresentation());
    expect(root.querySelector('[data-side="4"].field-warning')?.textContent).toContain('ДРЕЙФ');
    expect(root.querySelector('[data-side="5"].field-warning')?.textContent).toContain('ДРЕЙФ');
    expect(root.querySelectorAll('.field-warning[role="status"]')).toHaveLength(1);
    expect(root.querySelector('[data-side="5"].field-warning')?.getAttribute('aria-hidden')).toBe('true');
    expect(root.querySelector('[data-side="1"].field-danger')?.textContent).toContain('ОПАСНО');
    expect(root.querySelector('.danger-panel')).toBeNull();
  });

  it('rotates an overflowing stack cue with the actual playfield orientation', () => {
    const screen = new ScreenController(root);
    const current = snapshot({ mode: 'playing' });
    const stacks = current.stacks.map((stack, side) => side === 1
      ? Array.from({ length: 10 }, (_, id) => ({ id: id + 1, color: 'coral' as const })) : stack);
    screen.render({ ...current, orientation: 2, stacks }, emptyPresentation());
    expect(root.querySelector('[data-side="5"].field-danger')?.textContent).toBe('ОПАСНО');
    expect(root.querySelector('[data-side="1"].field-danger')).toBeNull();
  });

  it('preserves slot, slow progress, notice and focused pause across changing frames', () => {
    const screen = new ScreenController(root);
    const active = { ...emptyPresentation(), notice: {
      title: 'ЗАМЕДЛЕНИЕ АКТИВИРОВАНО', body: 'БЛОКИ ЗАМЕДЛЕНЫ', tone: 'sky' as const,
      priority: 4 as const, ageMs: 100, lifetimeMs: 900, assertive: false,
    } };
    screen.render(snapshot({ mode: 'playing', bonus: { stored: 'slow', slowRemainingMs: 4200 } }), active);
    const slot = root.querySelector('.bonus-slot');
    const slow = root.querySelector('.slow-status');
    const progress = root.querySelector('.slow-rule');
    const notice = root.querySelector('.presentation-notice');
    const pause = root.querySelector<HTMLButtonElement>('[data-action="pause"]')!;
    pause.focus();
    screen.render(snapshot({ mode: 'playing', score: 99, bonus: { stored: 'slow', slowRemainingMs: 3900 } }),
      { ...active, notice: { ...active.notice, ageMs: 400 } });
    expect(root.querySelector('.bonus-slot')).toBe(slot);
    expect(root.querySelector('.slow-status')).toBe(slow);
    expect(root.querySelector('.slow-rule')).toBe(progress);
    expect(root.querySelector('.presentation-notice')).toBe(notice);
    expect(root.querySelector('.slow-rule')?.getAttribute('aria-valuenow')).toBe('3900');
    expect(document.activeElement).toBe(pause);
  });

  it('shows the score multiplier and a readable ivory fallback bonus', () => {
    const screen = new ScreenController(root);
    screen.render(snapshot({ mode: 'playing', combo: 3,
      bonus: { stored: 'mystery' as GameSnapshot['bonus']['stored'], slowRemainingMs: 0 } }), emptyPresentation());
    expect(root.querySelector('.multiplier')?.textContent).toContain('×3');
    expect(root.querySelector('.bonus-slot')?.getAttribute('data-tone')).toBe('ivory');
    expect(root.querySelector('.bonus-slot')?.textContent).toContain('ПРОБЕЛ');
  });
});
