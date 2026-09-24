import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GameEngine } from '../src/game/GameEngine';
import { PresentationSystem } from '../src/presentation/PresentationSystem';
import { ScreenController } from '../src/ui/ScreenController';

describe('document localization', () => {
  it('identifies the game and playfield as Russian content', () => {
    const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
    const document = new DOMParser().parseFromString(html, 'text/html');

    expect(document.documentElement.lang).toBe('ru');
    expect(document.querySelector('meta[name="description"]')?.getAttribute('content'))
      .toBe('Вращай шестиугольник, собирай три одинаковых цвета и не дай полю переполниться.');
    expect(document.querySelector('#game-canvas')?.getAttribute('aria-label')).toBe('Игровое поле HEXTRIS');
  });

  it('keeps the saved bonus effect and activation key in Russian after the notice expires', () => {
    document.body.innerHTML = '<main id="localization-ui"></main>';
    const root = document.getElementById('localization-ui')!;
    const screen = new ScreenController(root);
    const initial = new GameEngine().getSnapshot();
    screen.render({ ...initial, mode: 'playing', bonus: { stored: 'pulse', slowRemainingMs: 0 } },
      new PresentationSystem().snapshot());

    expect(root.querySelector('.bonus-copy strong')?.textContent).toBe('ИМПУЛЬС');
    expect(root.querySelector('.bonus-description')?.textContent).toBe('СБРАСЫВАЕТ КРАЙНИЕ БЛОКИ');
    expect(root.querySelector('.bonus-copy kbd')?.textContent).toBe('ПРОБЕЛ');
    expect(root.querySelector('.bonus-slot')?.getAttribute('aria-label')).toContain('Сбрасывает крайние блоки');
    expect(root.querySelector('.presentation-notice')).toBeNull();
    screen.destroy();
  });
});
