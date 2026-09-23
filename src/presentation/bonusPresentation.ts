import type { BonusType } from '../game/progressionTypes';

export type BonusTone = 'sky' | 'amber' | 'teal' | 'coral' | 'ivory';

export interface BonusPresentation {
  readonly label: string;
  readonly description: string;
  readonly activationCopy: string;
  readonly glyph: string;
  readonly tone: BonusTone;
}

export interface KnownBonusPresentation extends BonusPresentation {
  readonly tone: Exclude<BonusTone, 'ivory'>;
}

const entry = <T extends BonusPresentation>(value: T): Readonly<T> => Object.freeze(value);

export const BONUS_PRESENTATION: Readonly<Record<BonusType, KnownBonusPresentation>> = Object.freeze({
  slow: entry({
    label: 'ЗАМЕДЛЕНИЕ',
    description: 'ЗАМЕДЛЯЕТ ПАДАЮЩИЕ БЛОКИ НА 6 СЕКУНД',
    activationCopy: 'БЛОКИ ЗАМЕДЛЕНЫ НА 6 СЕКУНД',
    glyph: 'Ⅱ',
    tone: 'sky',
  }),
  pulse: entry({
    label: 'ИМПУЛЬС',
    description: 'СБРАСЫВАЕТ КРАЙНИЕ БЛОКИ',
    activationCopy: 'ЦЕНТРАЛЬНАЯ ВОЛНА ЗАПУЩЕНА',
    glyph: '⌁',
    tone: 'amber',
  }),
  cleanse: entry({
    label: 'ОЧИСТКА',
    description: 'ОЧИЩАЕТ САМУЮ ЗАПОЛНЕННУЮ СТОРОНУ',
    activationCopy: 'САМАЯ ЗАПОЛНЕННАЯ СТОРОНА ОЧИЩЕНА',
    glyph: '╱',
    tone: 'teal',
  }),
  colorBreak: entry({
    label: 'ЦВЕТОВОЙ ВЗРЫВ',
    description: 'УНИЧТОЖАЕТ ВСЕ БЛОКИ ОДНОГО ЦВЕТА',
    activationCopy: 'ВСЕ БЛОКИ ЦВЕТА УНИЧТОЖЕНЫ',
    glyph: '◆',
    tone: 'coral',
  }),
});

const FALLBACK_BONUS_PRESENTATION: BonusPresentation = entry({
  label: 'БОНУС',
  description: 'ПРОБЕЛ — ИСПОЛЬЗОВАТЬ',
  activationCopy: 'БОНУС АКТИВИРОВАН',
  glyph: '◇',
  tone: 'ivory',
});

export function getBonusPresentation(type: BonusType): KnownBonusPresentation;
export function getBonusPresentation(type: string): BonusPresentation;
export function getBonusPresentation(type: string): BonusPresentation {
  return Object.prototype.hasOwnProperty.call(BONUS_PRESENTATION, type)
    ? BONUS_PRESENTATION[type as BonusType]
    : FALLBACK_BONUS_PRESENTATION;
}
