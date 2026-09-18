import { describe, expect, it } from 'vitest';
import {
  BONUS_PRESENTATION,
  getBonusPresentation,
} from '../src/presentation/bonusPresentation';

describe('bonus presentation metadata', () => {
  it('defines distinct complete copy and glyphs for every bonus', () => {
    expect(Object.keys(BONUS_PRESENTATION).sort()).toEqual([
      'cleanse', 'colorBreak', 'pulse', 'slow',
    ]);
    expect(new Set(Object.values(BONUS_PRESENTATION).map(({ glyph }) => glyph)).size).toBe(4);
    expect(getBonusPresentation('slow')).toMatchObject({
      label: 'SLOW',
      description: 'SLOWS FALLING BLOCKS FOR 6 SECONDS',
      glyph: 'Ⅱ',
      tone: 'sky',
    });
    expect(getBonusPresentation('pulse').description).toBe('KNOCKS BLOCKS FROM OUTER SIDES');
    expect(getBonusPresentation('cleanse').description).toBe('CLEARS THE TALLEST SIDE');
    expect(getBonusPresentation('colorBreak').description).toBe('REMOVES EVERY BLOCK OF ONE COLOR');
    expect(Object.values(BONUS_PRESENTATION).every(Object.isFrozen)).toBe(true);
  });
});
