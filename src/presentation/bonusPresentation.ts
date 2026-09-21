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

export const getBonusPresentation = (type: BonusType): BonusPresentation => BONUS_PRESENTATION[type];
