import { describe, expect, it } from 'vitest';
import { EffectsSystem } from '../src/render/EffectsSystem';

describe('progression effects', () => {
  it('turns a normal clear into a bounded impact with a visual-only hit stop', () => {
    const effects = new EffectsSystem({ random: () => 0.5 });

    effects.consume([
      { type: 'matchCleared', cells: [{ side: 0, index: 0 }], color: 'coral', chain: 1 },
    ], { center: { x: 20, y: 30 } });

    const snapshot = effects.snapshot();
    expect(snapshot.shake).toEqual({ magnitude: 4, remainingMs: 120 });
    expect(snapshot.hitStopRemainingMs).toBe(60);
    expect(snapshot.shockwaves).toMatchObject([
      { y: -42, color: 'coral', ageMs: 0, lifetimeMs: 360, intensity: 0.55 },
    ]);
    expect(snapshot.shockwaves[0]?.x).toBeCloseTo(20);
  });

  it('amplifies a chain into a readable label, stronger ring, and larger fragment burst', () => {
    const effects = new EffectsSystem({ random: () => 0.5 });

    effects.consume([
      { type: 'matchCleared', cells: [{ side: 1, index: 0 }], color: 'amber', chain: 3 },
    ]);

    const snapshot = effects.snapshot();
    expect(snapshot.shake).toEqual({ magnitude: 8, remainingMs: 120 });
    expect(snapshot.fragments).toHaveLength(11);
    expect(snapshot.labels).toEqual([
      { text: 'СЕРИЯ ×3', tone: 'amber', ageMs: 0, lifetimeMs: 620 },
    ]);
    expect(snapshot.shockwaves).toMatchObject([
      { color: 'amber', ageMs: 0, lifetimeMs: 460, intensity: 0.85 },
    ]);
  });

  it('marks bonus collection with a seventy-millisecond visual hold and one origin ring', () => {
    const effects = new EffectsSystem({ random: () => 0.5 });

    effects.consume([{
      type: 'bonusCollected',
      bonus: 'pulse',
      token: { id: 7, type: 'pulse', lane: 2, distance: 72, speed: 150 },
    }], { center: { x: 10, y: 20 } });

    const snapshot = effects.snapshot();
    expect(snapshot.hitStopRemainingMs).toBe(70);
    expect(snapshot.shake).toEqual({ magnitude: 0, remainingMs: 0 });
    expect(snapshot.shockwaves).toHaveLength(1);
    expect(snapshot.shockwaves[0]).toMatchObject({
      color: 'ivory', ageMs: 0, lifetimeMs: 260, intensity: 0.6,
    });
    expect(snapshot.shockwaves[0]?.x).toBeCloseTo(10 + Math.cos(Math.PI / 6) * 72);
    expect(snapshot.shockwaves[0]?.y).toBeCloseTo(56);
  });

  it('gives a bonus removal a full-field wave and an eighty-millisecond visual-only hit stop', () => {
    const effects = new EffectsSystem({ random: () => 0.5 });

    effects.consume([
      {
        type: 'bonusRemoved',
        bonus: 'pulse',
        cells: [{ side: 0, index: 0 }],
        blocks: [{ id: 1, color: 'teal' }],
        scoreDelta: 80,
      },
    ], { center: { x: 40, y: 50 } });

    expect(effects.snapshot()).toMatchObject({
      bonusImpact: { bonus: 'pulse', removedCount: 1, ageMs: 0, lifetimeMs: 620 },
      shake: { magnitude: 7, remainingMs: 180 },
      hitStopRemainingMs: 80,
      shockwaves: [{ x: 40, y: 50, color: 'ivory', ageMs: 0, lifetimeMs: 520, intensity: 1 }],
      labels: [{ text: 'ИМПУЛЬС', tone: 'coral', ageMs: 0, lifetimeMs: 620 }],
      screenFlash: { tone: 'coral', intensity: 0.75, remainingMs: 100 },
    });
    expect(effects.snapshot().fragments).toHaveLength(8);
    expect(effects.snapshot().fragments[0]).toMatchObject({ color: 'teal', anticipationMs: 100 });
    expect(effects.snapshot().fragments[0]!.vy).toBeLessThan(0);
  });

  it('sequences cleanse and color break fragments in deterministic waves', () => {
    const cells = [{ side: 0, index: 2 }, { side: 1, index: 1 }];
    const blocks = [{ id: 1, color: 'sky' as const }, { id: 2, color: 'amber' as const }];
    const cleanse = new EffectsSystem({ random: () => 0.5 });
    cleanse.consume([{
      type: 'bonusRemoved', bonus: 'cleanse', cells, blocks, scoreDelta: 80,
    }]);
    expect(cleanse.snapshot().fragments[0]?.anticipationMs).toBe(100);
    expect(cleanse.snapshot().fragments[8]?.anticipationMs).toBe(128);

    const colorBreak = new EffectsSystem({ random: () => 0.5 });
    colorBreak.consume([{
      type: 'bonusRemoved', bonus: 'colorBreak', cells, blocks, scoreDelta: 80,
    }]);
    expect(colorBreak.snapshot().fragments[0]?.anticipationMs).toBe(100);
    expect(colorBreak.snapshot().fragments[8]?.anticipationMs).toBe(124);

    const pulse = new EffectsSystem({ random: () => 0.5 });
    pulse.consume([{
      type: 'bonusRemoved', bonus: 'pulse', cells, blocks, scoreDelta: 80,
    }]);
    expect(pulse.snapshot().fragments[0]?.anticipationMs).toBe(100);
    expect(pulse.snapshot().fragments[8]?.anticipationMs).toBe(120);
  });

  it('announces anomaly starts transiently without retaining a cue when they end', () => {
    const effects = new EffectsSystem({ random: () => 0.5 });

    effects.consume([{ type: 'anomalyStarted', anomalies: ['inertia'], lanes: [0], atActiveMs: 119_500 }]);
    expect(effects.snapshot()).toMatchObject({
      labels: [{ text: 'ИНЕРЦИЯ', tone: 'amber', ageMs: 0, lifetimeMs: 620 }],
      screenFlash: { tone: 'amber', intensity: 0.55, remainingMs: 100 },
    });

    effects.consume([{ type: 'anomalyEnded', anomalies: ['inertia'], atActiveMs: 127_500 }]);
    for (let update = 0; update < 13; update += 1) effects.update(50);
    expect(effects.snapshot().labels).toEqual([]);
    expect(effects.snapshot().screenFlash).toBeNull();
  });

  it('uses the authored spaced labels for camel-case bonuses and anomalies', () => {
    const effects = new EffectsSystem({ random: () => 0.5 });

    effects.consume([
      { type: 'bonusRemoved', bonus: 'colorBreak', cells: [], blocks: [], scoreDelta: 0 },
      { type: 'anomalyStarted', anomalies: ['colorShift', 'inertia'], lanes: [0], atActiveMs: 420_200 },
    ]);

    expect(effects.snapshot().labels.map(({ text }) => text)).toEqual([
      'ЦВЕТОВОЙ ВЗРЫВ',
      'СМЕНА ЦВЕТА + ИНЕРЦИЯ',
    ]);
  });

  it('caps surge completion and last stand at the strongest shake and flash', () => {
    const effects = new EffectsSystem({ random: () => 0.5 });

    effects.consume([{ type: 'cycleCompleted', cycle: 2, atActiveMs: 150_000 }]);
    expect(effects.snapshot()).toMatchObject({
      shake: { magnitude: 8, remainingMs: 220 },
      screenFlash: { tone: 'amber', intensity: 1, remainingMs: 160 },
    });

    effects.consume([{ type: 'lastStand', side: 3, cells: [], blocks: [] }]);
    expect(effects.snapshot()).toMatchObject({
      shake: { magnitude: 8, remainingMs: 220 },
      screenFlash: { tone: 'coral', intensity: 1, remainingMs: 160 },
      labels: [
        { text: 'ЦИКЛ 2 ЗАВЕРШЁН', tone: 'amber', ageMs: 0, lifetimeMs: 620 },
        { text: 'ПОСЛЕДНИЙ ШАНС', tone: 'coral', ageMs: 0, lifetimeMs: 620 },
      ],
    });
  });

  it('caps new channels and expires every transient progression value', () => {
    const effects = new EffectsSystem({ random: () => 0.5 });
    const pulse = {
      type: 'bonusRemoved' as const,
      bonus: 'pulse' as const,
      cells: [] as const,
      blocks: [] as const,
      scoreDelta: 0,
    };

    effects.consume(Array.from({ length: 13 }, () => pulse));
    const snapshot = effects.snapshot();
    expect(snapshot.shockwaves).toHaveLength(12);
    expect(snapshot.labels).toHaveLength(6);
    expect(Object.isFrozen(snapshot.shockwaves)).toBe(true);
    expect(Object.isFrozen(snapshot.shockwaves[0])).toBe(true);
    expect(Object.isFrozen(snapshot.labels)).toBe(true);
    expect(Object.isFrozen(snapshot.labels[0])).toBe(true);
    expect(Object.isFrozen(snapshot.screenFlash)).toBe(true);

    for (let update = 0; update < 13; update += 1) effects.update(50);
    expect(effects.snapshot()).toMatchObject({
      bonusImpact: null, shockwaves: [], labels: [], screenFlash: null, hitStopRemainingMs: 0,
    });
  });

  it('keeps progression labels readable while reduced motion removes visual holds and movement', () => {
    const effects = new EffectsSystem({ random: () => 0.5, reducedMotion: true });

    effects.consume([
      { type: 'matchCleared', cells: [{ side: 0, index: 0 }], color: 'sky', chain: 3 },
      { type: 'bonusRemoved', bonus: 'pulse', cells: [], blocks: [], scoreDelta: 0 },
      { type: 'cycleCompleted', cycle: 2, atActiveMs: 150_000 },
      { type: 'comboChanged', multiplier: 4 },
    ]);

    expect(effects.snapshot()).toMatchObject({
      reducedMotion: true,
      assemblies: [], fragments: [], bonusImpact: { bonus: 'pulse', removedCount: 0 },
      particles: [], flashes: [], shockwaves: [],
      shake: { magnitude: 0, remainingMs: 0 },
      hitStopRemainingMs: 0,
      screenFlash: null,
      combo: { multiplier: 0, remainingMs: 0 },
      labels: [
        { text: 'СЕРИЯ ×3', tone: 'amber', ageMs: 0, lifetimeMs: 620 },
        { text: 'ИМПУЛЬС', tone: 'coral', ageMs: 0, lifetimeMs: 620 },
        { text: 'ЦИКЛ 2 ЗАВЕРШЁН', tone: 'amber', ageMs: 0, lifetimeMs: 620 },
      ],
    });
  });

  it('clears every progression channel on reset', () => {
    const effects = new EffectsSystem({ random: () => 0.5 });
    effects.consume([
      { type: 'matchCleared', cells: [{ side: 0, index: 0 }], color: 'sky', chain: 2 },
      { type: 'bonusRemoved', bonus: 'pulse', cells: [], blocks: [], scoreDelta: 0 },
      { type: 'anomalyStarted', anomalies: ['reverse'], lanes: [0], atActiveMs: 119_500 },
    ]);

    effects.reset();

    expect(effects.snapshot()).toMatchObject({
      assemblies: [], fragments: [], bonusImpact: null,
      particles: [], flashes: [], shockwaves: [], labels: [], screenFlash: null,
      shake: { magnitude: 0, remainingMs: 0 }, hitStopRemainingMs: 0,
    });
  });
});
