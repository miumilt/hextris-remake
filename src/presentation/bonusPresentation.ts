import type { BonusType } from '../game/progressionTypes';

export type BonusTone = 'sky' | 'amber' | 'teal' | 'coral';

export interface BonusPresentation {
  readonly label: string;
  readonly description: string;
  readonly activationCopy: string;
  readonly glyph: string;
  readonly tone: BonusTone;
}

const entry = (value: BonusPresentation): BonusPresentation => Object.freeze(value);

export const BONUS_PRESENTATION: Readonly<Record<BonusType, BonusPresentation>> = Object.freeze({
  slow: entry({
    label: 'SLOW',
    description: 'SLOWS FALLING BLOCKS FOR 6 SECONDS',
    activationCopy: 'FALLING BLOCKS SLOWED FOR 6S',
    glyph: 'Ⅱ',
    tone: 'sky',
  }),
  pulse: entry({
    label: 'PULSE',
    description: 'KNOCKS BLOCKS FROM OUTER SIDES',
    activationCopy: 'CENTRAL WAVE RELEASED',
    glyph: '⌁',
    tone: 'amber',
  }),
  cleanse: entry({
    label: 'CLEANSE',
    description: 'CLEARS THE TALLEST SIDE',
    activationCopy: 'SIDE SWEEP RELEASED',
    glyph: '╱',
    tone: 'teal',
  }),
  colorBreak: entry({
    label: 'COLOR BREAK',
    description: 'REMOVES EVERY BLOCK OF ONE COLOR',
    activationCopy: 'COLOR FRACTURE RELEASED',
    glyph: '◆',
    tone: 'coral',
  }),
});

export const getBonusPresentation = (type: BonusType): BonusPresentation => BONUS_PRESENTATION[type];
