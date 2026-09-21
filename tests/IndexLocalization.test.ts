import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('document localization', () => {
  it('identifies the game and playfield as Russian content', () => {
    const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
    const document = new DOMParser().parseFromString(html, 'text/html');

    expect(document.documentElement.lang).toBe('ru');
    expect(document.querySelector('meta[name="description"]')?.getAttribute('content'))
      .toBe('Вращай шестиугольник, собирай три одинаковых цвета и не дай полю переполниться.');
    expect(document.querySelector('#game-canvas')?.getAttribute('aria-label')).toBe('Игровое поле HEXTRIS');
  });
});
