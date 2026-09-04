import { describe, expect, it } from 'vitest';
import { APP_TITLE, BLOCK_COLORS, FIXED_STEP_MS } from '../src/game/constants';

describe('game constants', () => {
  it('defines the approved title, palette, and 60 Hz step', () => {
    expect(APP_TITLE).toBe('HEXTRIS');
    expect(BLOCK_COLORS).toEqual(['coral', 'amber', 'teal', 'sky']);
    expect(FIXED_STEP_MS).toBeCloseTo(1000 / 60);
  });
});
