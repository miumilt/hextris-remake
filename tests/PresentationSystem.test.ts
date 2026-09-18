import { describe, expect, it } from 'vitest';
import { PresentationSystem, type PresentationEvent } from '../src/presentation/PresentationSystem';

const collected: PresentationEvent = {
  type: 'bonusCollected',
  bonus: 'pulse',
  token: Object.freeze({ id: 7, type: 'pulse', lane: 2, distance: 72, speed: 150 }),
};

describe('PresentationSystem', () => {
  it('explains acquisition, transfers the glyph, and settles slot attention', () => {
    const presentation = new PresentationSystem();

    presentation.consume([collected]);

    expect(presentation.snapshot()).toMatchObject({
      notice: {
        title: 'PULSE ACQUIRED',
        body: 'KNOCKS BLOCKS FROM OUTER SIDES',
        lifetimeMs: 900,
      },
      transfer: {
        bonus: 'pulse', lane: 2, distance: 72, ageMs: 0, lifetimeMs: 650,
      },
      slotAttentionRemainingMs: 2500,
    });
    presentation.update(650);
    expect(presentation.snapshot().transfer).toBeNull();
    presentation.update(250);
    expect(presentation.snapshot().notice).toBeNull();
    presentation.update(1600);
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
      title: 'LAST STAND', body: 'OVERFLOW SURVIVED', assertive: true,
    });
    expect(presentation.snapshot().queuedNotices.map(({ title }) => title)).toEqual([
      'PULSE ACTIVATED', 'PULSE REPLACED SLOW',
    ]);
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

    expect(presentation.snapshot().notice?.title).toBe('CHAIN ×2');
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
