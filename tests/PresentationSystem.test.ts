import { describe, expect, it } from 'vitest';
import type { AnomalyType } from '../src/game/progressionTypes';
import { PresentationSystem, type PresentationEvent } from '../src/presentation/PresentationSystem';

const collected: PresentationEvent = {
  type: 'bonusCollected',
  bonus: 'pulse',
  token: Object.freeze({ id: 7, type: 'pulse', lane: 2, distance: 72, speed: 150 }),
};

describe('PresentationSystem', () => {
  it('stages the 1200 ms opening and freezes it outside playing', () => {
    const presentation = new PresentationSystem();
    presentation.beginRun([1, 2]);
    expect(presentation.snapshot().opening).toMatchObject({
      stage: 'assemble', ageMs: 0, lifetimeMs: 1200, previewLanes: [1, 2],
    });
    presentation.update(319, 'playing');
    expect(presentation.snapshot().opening?.stage).toBe('assemble');
    presentation.update(1, 'playing');
    expect(presentation.snapshot().opening?.stage).toBe('guides');
    presentation.update(440, 'playing');
    expect(presentation.snapshot().opening?.stage).toBe('ready');
    for (const mode of ['paused', 'upgrade', 'gameOver', 'menu'] as const) presentation.update(100, mode);
    expect(presentation.snapshot().opening?.ageMs).toBe(760);
    presentation.update(439, 'playing');
    expect(presentation.snapshot().opening?.stage).toBe('ready');
    presentation.update(1, 'playing');
    expect(presentation.snapshot().opening).toBeNull();
  });

  it('copies and freezes preview lanes independently of caller mutations', () => {
    const presentation = new PresentationSystem();
    const lanes = [1, 2];
    presentation.beginRun(lanes);
    lanes[0] = 5;
    const opening = presentation.snapshot().opening;
    expect(opening?.previewLanes).toEqual([1, 2]);
    expect(Object.isFrozen(opening)).toBe(true);
    expect(Object.isFrozen(opening?.previewLanes)).toBe(true);
  });

  it('holds collection for 90 ms, flies for 800 ms, and explains it for 1700 ms', () => {
    const presentation = new PresentationSystem();
    presentation.consume([collected]);
    expect(presentation.snapshot()).toMatchObject({
      notice: { title: 'БОНУС: ИМПУЛЬС', body: 'СБРАСЫВАЕТ КРАЙНИЕ БЛОКИ', lifetimeMs: 1700 },
      transfer: { bonus: 'pulse', lane: 2, distance: 72, delayMs: 90, lifetimeMs: 800, ageMs: 0 },
      slotAttentionRemainingMs: 2500,
    });
    presentation.update(889, 'playing');
    expect(presentation.snapshot().transfer).not.toBeNull();
    presentation.update(1, 'playing');
    expect(presentation.snapshot().transfer).toBeNull();
    expect(presentation.snapshot().notice).not.toBeNull();
    presentation.update(810, 'playing');
    expect(presentation.snapshot().notice).toBeNull();
    presentation.update(800, 'playing');
    expect(presentation.snapshot().slotAttentionRemainingMs).toBe(0);
  });

  it('freezes every transient clock during pause and upgrade', () => {
    const presentation = new PresentationSystem();
    presentation.beginRun([3]);
    presentation.consume([collected]);
    presentation.update(100, 'playing');
    const before = presentation.snapshot();
    presentation.update(500, 'paused');
    presentation.update(500, 'upgrade');
    expect(presentation.snapshot()).toEqual(before);
  });

  it('announces replacement for 1700 ms but retires the old glyph after 800 ms', () => {
    const presentation = new PresentationSystem();
    presentation.consume([collected, { type: 'bonusReplaced', previous: 'slow', replacement: 'pulse' }]);
    expect(presentation.snapshot()).toMatchObject({
      notice: { title: 'ИМПУЛЬС ЗАМЕНИЛ ЗАМЕДЛЕНИЕ', lifetimeMs: 1700 },
      replacedBonus: 'slow',
    });
    presentation.update(799, 'playing');
    expect(presentation.snapshot().replacedBonus).toBe('slow');
    presentation.update(1, 'playing');
    expect(presentation.snapshot().replacedBonus).toBeNull();
    expect(presentation.snapshot().notice).not.toBeNull();
  });

  it('keeps action-specific activation copy for at least 900 ms', () => {
    const presentation = new PresentationSystem();
    presentation.consume([{ type: 'bonusActivated', bonus: 'cleanse' }]);
    expect(presentation.snapshot().notice).toMatchObject({
      title: 'ОЧИСТКА АКТИВИРОВАН',
      body: 'САМАЯ ЗАПОЛНЕННАЯ СТОРОНА ОЧИЩЕНА', lifetimeMs: 900,
    });
    presentation.update(899, 'playing');
    expect(presentation.snapshot().notice).not.toBeNull();
    presentation.update(1, 'playing');
    expect(presentation.snapshot().notice).toBeNull();
  });

  it.each([
    ['slow', 'БЛОКИ ЗАМЕДЛЕНЫ НА 6 СЕКУНД'],
    ['pulse', 'ЦЕНТРАЛЬНАЯ ВОЛНА ЗАПУЩЕНА'],
    ['cleanse', 'САМАЯ ЗАПОЛНЕННАЯ СТОРОНА ОЧИЩЕНА'],
    ['colorBreak', 'ВСЕ БЛОКИ ЦВЕТА УНИЧТОЖЕНЫ'],
  ] as const)('retains action-specific %s activation meaning', (bonus, body) => {
    const presentation = new PresentationSystem();
    presentation.consume([{ type: 'bonusActivated', bonus }]);
    expect(presentation.snapshot().notice).toMatchObject({ body, lifetimeMs: 900 });
  });

  it('explains each anomaly for 1800 ms only on first appearance in the run', () => {
    const presentation = new PresentationSystem();
    presentation.consume([{ type: 'anomalyStarted', anomalies: ['reverse'], lanes: [0], atActiveMs: 95_000 }]);
    expect(presentation.snapshot().notice).toMatchObject({
      title: 'РЕВЕРС', body: 'УПРАВЛЕНИЕ МЕНЯЕТСЯ МЕСТАМИ', lifetimeMs: 1800,
    });
    presentation.update(1800, 'playing');
    presentation.consume([{ type: 'anomalyStarted', anomalies: ['reverse'], lanes: [0], atActiveMs: 170_000 }]);
    expect(presentation.snapshot().notice).toMatchObject({ title: 'РЕВЕРС', body: '' });
    presentation.reset();
    presentation.beginRun([1]);
    presentation.consume([{ type: 'anomalyStarted', anomalies: ['reverse'], lanes: [0], atActiveMs: 95_000 }]);
    expect(presentation.snapshot().notice?.body).toBe('УПРАВЛЕНИЕ МЕНЯЕТСЯ МЕСТАМИ');
  });

  it('explains a newly seen member of a double anomaly', () => {
    const presentation = new PresentationSystem();
    presentation.consume([{ type: 'anomalyStarted', anomalies: ['reverse'], lanes: [0], atActiveMs: 95_000 }]);
    presentation.update(1800, 'playing');
    presentation.consume([{ type: 'anomalyStarted', anomalies: ['reverse', 'drift'], lanes: [0], atActiveMs: 360_000 }]);
    expect(presentation.snapshot().notice).toMatchObject({
      title: 'РЕВЕРС + ДРЕЙФ', body: 'КОНТУР ПОКАЗЫВАЕТ МЕСТО ПРИЗЕМЛЕНИЯ', lifetimeMs: 1800,
    });
  });

  it('does not consume a first-seen explanation when notice cap drops it', () => {
    const presentation = new PresentationSystem();
    const reverseStarted = {
      type: 'anomalyStarted' as const,
      anomalies: ['reverse'] as const,
      lanes: [0],
      atActiveMs: 95_000,
    };
    presentation.consume([
      { type: 'bonusActivated', bonus: 'slow' },
      { type: 'lastStand', side: 0, cells: [], blocks: [] },
      { type: 'gameOver', score: 42 },
      reverseStarted,
    ]);
    const titles = [
      presentation.snapshot().notice?.title,
      ...presentation.snapshot().queuedNotices.map(({ title }) => title),
    ];
    expect(titles).not.toContain('РЕВЕРС');
    presentation.update(2700, 'playing');
    presentation.consume([reverseStarted]);
    expect(presentation.snapshot().notice).toMatchObject({
      title: 'РЕВЕРС', body: 'УПРАВЛЕНИЕ МЕНЯЕТСЯ МЕСТАМИ', lifetimeMs: 1800,
    });
  });

  it('reoffers a first-seen explanation if its queued notice is evicted before display', () => {
    const presentation = new PresentationSystem();
    const reverse = { type: 'anomalyStarted' as const, anomalies: ['reverse'] as const,
      lanes: [0], atActiveMs: 95_000 };
    presentation.consume([{ type: 'bonusActivated', bonus: 'slow' }]);
    presentation.consume([reverse]);
    expect(presentation.snapshot().queuedNotices.map(({ title }) => title)).toContain('РЕВЕРС');
    presentation.consume([
      { type: 'lastStand', side: 0, cells: [], blocks: [] },
      { type: 'gameOver', score: 42 },
    ]);
    expect(presentation.snapshot().queuedNotices.map(({ title }) => title)).not.toContain('РЕВЕРС');
    presentation.update(3_000, 'playing');
    presentation.consume([reverse]);
    expect(presentation.snapshot().notice).toMatchObject({
      title: 'РЕВЕРС', body: 'УПРАВЛЕНИЕ МЕНЯЕТСЯ МЕСТАМИ', lifetimeMs: 1_800,
    });
  });

  it('uses a readable static notice when anomaly metadata is missing at runtime', () => {
    const presentation = new PresentationSystem();
    const unknown = 'unknown-at-runtime' as AnomalyType;
    presentation.consume([{ type: 'anomalyStarted', anomalies: [unknown], lanes: [0], atActiveMs: 95_000 }]);
    expect(presentation.snapshot().notice).toMatchObject({
      title: 'АНОМАЛИЯ', body: 'СЛЕДИ ЗА ПРЕДУПРЕЖДЕНИЕМ', lifetimeMs: 1800,
    });
  });

  it.each(['constructor', '__proto__', 'toString'])(
    'treats inherited %s as missing anomaly metadata',
    (id) => {
      const presentation = new PresentationSystem();
      presentation.consume([{
        type: 'anomalyStarted', anomalies: [id as AnomalyType], lanes: [0], atActiveMs: 95_000,
      }]);
      expect(presentation.snapshot().notice).toMatchObject({
        title: 'АНОМАЛИЯ', body: 'СЛЕДИ ЗА ПРЕДУПРЕЖДЕНИЕМ', lifetimeMs: 1800,
      });
    },
  );

  it('announces Pressure once and lets Release stay visually quiet', () => {
    const presentation = new PresentationSystem();
    const pressure = { type: 'phaseChanged' as const, phase: 'pressure' as const, cycle: 2, atActiveMs: 130_000 };
    presentation.consume([pressure, pressure]);
    expect(presentation.snapshot().notice?.title).toBe('ДАВЛЕНИЕ');
    expect(presentation.snapshot().queuedNotices).toEqual([]);
    presentation.consume([{ type: 'phaseChanged', phase: 'release', cycle: 2, atActiveMs: 145_000 }]);
    expect(presentation.snapshot().queuedNotices).toEqual([]);
  });

  it('keeps bounded priority for simultaneous gameplay events', () => {
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

  it('consumes elapsed time across queued notices in one large playing step', () => {
    const presentation = new PresentationSystem();
    presentation.consume([
      collected,
      { type: 'bonusActivated', bonus: 'slow' },
    ]);
    expect(presentation.snapshot().queuedNotices).toHaveLength(1);
    presentation.update(900 + 1700, 'playing');
    expect(presentation.snapshot().notice).toBeNull();
    expect(presentation.snapshot().queuedNotices).toEqual([]);
  });

  it('clamps invalid time, freezes snapshots, and clears every channel', () => {
    const presentation = new PresentationSystem();
    presentation.beginRun([1, 2]);
    presentation.consume([collected]);
    presentation.update(Number.NaN, 'playing');
    const snapshot = presentation.snapshot();
    expect(snapshot.notice?.ageMs).toBe(0);
    expect(snapshot.opening?.ageMs).toBe(0);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.notice)).toBe(true);
    expect(Object.isFrozen(snapshot.queuedNotices)).toBe(true);
    expect(Object.isFrozen(snapshot.transfer)).toBe(true);
    presentation.reset();
    expect(presentation.snapshot()).toEqual({
      opening: null, notice: null, queuedNotices: [], transfer: null,
      slotAttentionRemainingMs: 0, replacedBonus: null,
    });
  });
});
