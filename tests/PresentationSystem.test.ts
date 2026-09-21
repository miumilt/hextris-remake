import { describe, expect, it } from 'vitest';
import { PresentationSystem, type PresentationEvent } from '../src/presentation/PresentationSystem';

const collected: PresentationEvent = {
  type: 'bonusCollected',
  bonus: 'pulse',
  token: Object.freeze({ id: 7, type: 'pulse', lane: 2, distance: 72, speed: 150 }),
};

describe('PresentationSystem', () => {
  it('explains acquisition in Russian without an ambiguous flying glyph', () => {
    const presentation = new PresentationSystem();

    presentation.consume([collected]);

    expect(presentation.snapshot()).toMatchObject({
      notice: {
        title: 'БОНУС: ИМПУЛЬС',
        body: 'СБРАСЫВАЕТ КРАЙНИЕ БЛОКИ',
        lifetimeMs: 1400,
      },
      transfer: null,
      slotAttentionRemainingMs: 2500,
    });
    presentation.update(1399);
    expect(presentation.snapshot().notice).not.toBeNull();
    presentation.update(1);
    expect(presentation.snapshot().notice).toBeNull();
    presentation.update(1100);
    expect(presentation.snapshot().slotAttentionRemainingMs).toBe(0);
  });

  it('announces replacement and activation with bounded priority', () => {
    const presentation = new PresentationSystem();

    presentation.consume([
      collected,
      { type: 'bonusReplaced', previous: 'slow', replacement: 'pulse' },
      { type: 'bonusActivated', bonus: 'pulse' },
      { type: 'lastStand', side: 0, cells: [], blocks: [] },
    ]);

    expect(presentation.snapshot().notice).toMatchObject({
      title: 'ПОСЛЕДНИЙ ШАНС', body: 'ПЕРЕПОЛНЕНИЕ ПЕРЕЖИТО', assertive: true,
    });
    expect(presentation.snapshot().queuedNotices.map(({ title }) => title)).toEqual([
      'ИМПУЛЬС АКТИВИРОВАН', 'ИМПУЛЬС ЗАМЕНИЛ ЗАМЕДЛЕНИЕ',
    ]);
  });

  it.each([
    ['slow', 'БЛОКИ ЗАМЕДЛЕНЫ НА 6 СЕКУНД'],
    ['pulse', 'ЦЕНТРАЛЬНАЯ ВОЛНА ЗАПУЩЕНА'],
    ['cleanse', 'САМАЯ ЗАПОЛНЕННАЯ СТОРОНА ОЧИЩЕНА'],
    ['colorBreak', 'ВСЕ БЛОКИ ЦВЕТА УНИЧТОЖЕНЫ'],
  ] as const)('uses action-specific copy when %s activates', (bonus, body) => {
    const presentation = new PresentationSystem();

    presentation.consume([{ type: 'bonusActivated', bonus }]);

    expect(presentation.snapshot().notice).toMatchObject({ body, lifetimeMs: 620 });
  });

  it('deduplicates repeated low-priority notices', () => {
    const presentation = new PresentationSystem();
    const chain = {
      type: 'matchCleared' as const,
      cells: [{ side: 0, index: 0 }],
      color: 'coral' as const,
      chain: 2,
    };

    presentation.consume([chain, chain, chain]);

    expect(presentation.snapshot().notice?.title).toBe('СЕРИЯ ×2');
    expect(presentation.snapshot().queuedNotices).toEqual([]);
  });

  it('clamps invalid time, freezes snapshots, and clears every channel', () => {
    const presentation = new PresentationSystem();
    presentation.consume([collected]);

    presentation.update(Number.NaN);
    const snapshot = presentation.snapshot();
    expect(snapshot.notice?.ageMs).toBe(0);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.notice)).toBe(true);
    expect(Object.isFrozen(snapshot.queuedNotices)).toBe(true);
    expect(Object.isFrozen(snapshot.transfer)).toBe(true);

    presentation.reset();
    expect(presentation.snapshot()).toEqual({
      notice: null,
      queuedNotices: [],
      transfer: null,
      slotAttentionRemainingMs: 0,
      replacedBonus: null,
    });
  });
});
