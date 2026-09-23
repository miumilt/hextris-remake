import { describe, expect, it } from 'vitest';
import {
  BONUS_PRESENTATION,
  getBonusPresentation,
} from '../src/presentation/bonusPresentation';

describe('bonus presentation metadata', () => {
  it('defines distinct Russian copy and glyphs for every bonus', () => {
    expect(Object.keys(BONUS_PRESENTATION).sort()).toEqual([
      'cleanse', 'colorBreak', 'pulse', 'slow',
    ]);
    expect(new Set(Object.values(BONUS_PRESENTATION).map(({ glyph }) => glyph)).size).toBe(4);
    expect(getBonusPresentation('slow')).toMatchObject({
      label: 'ЗАМЕДЛЕНИЕ',
      description: 'ЗАМЕДЛЯЕТ ПАДАЮЩИЕ БЛОКИ НА 6 СЕКУНД',
      activationCopy: 'БЛОКИ ЗАМЕДЛЕНЫ НА 6 СЕКУНД',
      glyph: 'Ⅱ',
      tone: 'sky',
    });
    expect(getBonusPresentation('pulse')).toMatchObject({
      label: 'ИМПУЛЬС', description: 'СБРАСЫВАЕТ КРАЙНИЕ БЛОКИ',
    });
    expect(getBonusPresentation('cleanse')).toMatchObject({
      label: 'ОЧИСТКА', description: 'ОЧИЩАЕТ САМУЮ ЗАПОЛНЕННУЮ СТОРОНУ',
    });
    expect(getBonusPresentation('colorBreak')).toMatchObject({
      label: 'ЦВЕТОВОЙ ВЗРЫВ', description: 'УНИЧТОЖАЕТ ВСЕ БЛОКИ ОДНОГО ЦВЕТА',
    });
    expect(Object.values(BONUS_PRESENTATION).every(Object.isFrozen)).toBe(true);
  });

  it('falls back to a readable static cue for missing runtime metadata', () => {
    expect(getBonusPresentation('unknown-at-runtime')).toMatchObject({
      label: 'БОНУС', description: 'ПРОБЕЛ — ИСПОЛЬЗОВАТЬ', glyph: '◇', tone: 'ivory',
    });
    expect(Object.isFrozen(getBonusPresentation('unknown-at-runtime'))).toBe(true);
  });
});
