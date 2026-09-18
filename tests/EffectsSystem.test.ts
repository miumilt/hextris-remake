import { describe, expect, it } from 'vitest';
import { EffectsSystem } from '../src/render/EffectsSystem';

describe('EffectsSystem', () => {
  it('assembles a spawned block for 180ms and expires it', () => {
    const effects = new EffectsSystem({ random: () => 0.5 });
    effects.consume([{
      type: 'blockSpawned',
      block: { id: 9, lane: 2, color: 'teal', distance: 520, speed: 150 },
    }]);

    expect(effects.snapshot().assemblies).toEqual([
      { blockId: 9, lane: 2, color: 'teal', ageMs: 0, lifetimeMs: 180 },
    ]);
    effects.update(180);
    expect(effects.snapshot().assemblies).toEqual([]);
  });

  it('creates deterministic fracture fragments after anticipation', () => {
    const effects = new EffectsSystem({ random: () => 0.5 });
    effects.consume([{
      type: 'matchCleared', cells: [{ side: 0, index: 0 }], color: 'coral', chain: 1,
    }]);

    expect(effects.snapshot().fragments).toHaveLength(8);
    expect(effects.snapshot().fragments[0]).toMatchObject({
      color: 'coral', ageMs: 0, lifetimeMs: 700, anticipationMs: 70,
    });
  });

  it('distinguishes empty activation from removal and keeps all channels bounded', () => {
    const effects = new EffectsSystem({ random: () => 0.5 });
    effects.consume([{ type: 'bonusActivated', bonus: 'cleanse' }]);
    expect(effects.snapshot().bonusImpact).toMatchObject({ bonus: 'cleanse', removedCount: 0 });
    expect(effects.snapshot().fragments).toEqual([]);

    effects.consume(Array.from({ length: 40 }, () => ({
      type: 'matchCleared' as const,
      cells: [{ side: 0, index: 0 }],
      color: 'sky' as const,
      chain: 4,
    })));
    expect(effects.snapshot().fragments.length).toBeLessThanOrEqual(180);
  });

  it('gives landings a brief restrained impact without weakening an active clear impact', () => {
    const effects = new EffectsSystem();
    const landing = { type: 'blockLanded' as const, block: { id: 1, color: 'sky' as const }, cell: { side: 0, index: 0 } };
    effects.consume([landing]);
    expect(effects.snapshot().shake.magnitude).toBeGreaterThan(0);
    expect(effects.snapshot().shake.magnitude).toBe(2);
    effects.update(50); effects.update(20);
    expect(effects.snapshot().shake).toEqual({ magnitude: 0, remainingMs: 0 });
    effects.consume([{ type: 'matchCleared', cells: [{ side: 0, index: 0 }], color: 'sky', chain: 2 }, landing]);
    expect(effects.snapshot().shake).toEqual({ magnitude: 6, remainingMs: 120 });
  });
  it('creates finite fragments and removes them after their lifetime', () => {
    const effects = new EffectsSystem({ random: () => 0.5 });
    effects.consume([
      {
        type: 'matchCleared',
        cells: [{ side: 0, index: 0 }, { side: 0, index: 1 }, { side: 0, index: 2 }],
        color: 'coral',
        chain: 1,
      },
    ]);

    expect(effects.snapshot().fragments.length).toBeGreaterThan(0);
    for (const fragment of effects.snapshot().fragments) {
      expect([fragment.x, fragment.y, fragment.vx, fragment.vy, fragment.rotation, fragment.spin,
        fragment.size, fragment.ageMs, fragment.lifetimeMs, fragment.anticipationMs].every(Number.isFinite)).toBe(true);
    }
    for (let update = 0; update < 40; update += 1) effects.update(50);
    expect(effects.snapshot().fragments).toEqual([]);
  });

  it('clamps one update to fifty milliseconds while integrating fragment motion', () => {
    const effects = new EffectsSystem({ random: () => 0.5 });
    effects.consume([
      { type: 'matchCleared', cells: [{ side: 0, index: 0 }], color: 'coral', chain: 1 },
    ]);

    const before = effects.snapshot().fragments[0];
    effects.update(500);

    const [fragment] = effects.snapshot().fragments;
    expect(fragment?.ageMs).toBe(50);
    expect(fragment?.anticipationMs).toBeGreaterThan(0);
    expect(fragment?.x).toBeCloseTo(before?.x ?? 0);
    expect(fragment?.y).toBeCloseTo(before?.y ?? 0);

    effects.update(50);
    const moving = effects.snapshot().fragments[0]!;
    expect(moving.ageMs).toBe(100);
    expect(moving.x).toBeCloseTo(before!.x);
    expect(moving.y).toBeLessThan(before!.y);
    expect(before!.ageMs).toBe(0);
  });

  it('maps cleared cells and landings to their clockwise world-side positions', () => {
    const effects = new EffectsSystem({ random: () => 0.5 });
    effects.consume(
      [
        { type: 'blockLanded', block: { id: 1, color: 'sky' }, cell: { side: 0, index: 1 } },
        { type: 'matchCleared', cells: [{ side: 1, index: 0 }], color: 'coral', chain: 2 },
      ],
      { center: { x: 10, y: 20 }, orientation: 0 },
    );

    const snapshot = effects.snapshot();
    expect(snapshot.flashes[0]?.x).toBeCloseTo(10);
    expect(snapshot.flashes[0]).toMatchObject({ y: -76, color: 'sky' });
    expect(snapshot.fragments[0]?.x).toBeCloseTo(10 + 36 * Math.sqrt(3));
    expect(snapshot.fragments[0]).toMatchObject({ y: -16, color: 'coral' });
    expect(snapshot.shake).toMatchObject({ magnitude: 6, remainingMs: 120 });

    for (let update = 0; update < 4; update += 1) effects.update(50);
    expect(effects.snapshot().flashes).toEqual([]);
  });

  it('inverts grid orientation when positioning effects on a rotated attached side', () => {
    const effects = new EffectsSystem({ random: () => 0.5 });
    effects.consume([
      { type: 'matchCleared', cells: [{ side: 1, index: 0 }], color: 'teal', chain: 1 },
    ], { orientation: 1 });

    const fragment = effects.snapshot().fragments[0]!;
    expect(fragment.x).toBeCloseTo(0);
    expect(fragment.y).toBeCloseTo(-72);
    expect(fragment.vy).toBeLessThan(0);
  });

  it('discards the oldest fragments when later bursts exceed the cap', () => {
    const effects = new EffectsSystem({ random: () => 0.5 });
    effects.consume([
      { type: 'matchCleared', cells: [{ side: 0, index: 0 }], color: 'coral', chain: 1 },
    ]);
    effects.update(50);
    effects.consume([
      {
        type: 'matchCleared',
        cells: Array.from({ length: 30 }, () => ({ side: 1, index: 0 })),
        color: 'sky',
        chain: 1,
      },
    ]);

    const fragments = effects.snapshot().fragments;
    expect(fragments).toHaveLength(180);
    expect(fragments.every((fragment) => fragment.color === 'sky' && fragment.ageMs === 0)).toBe(true);
  });

  it('caps fragments, expires transient impulses, and exposes immutable snapshots', () => {
    const effects = new EffectsSystem({ random: () => 0.5 });
    effects.consume([
      {
        type: 'matchCleared',
        cells: Array.from({ length: 100 }, () => ({ side: 0, index: 0 })),
        color: 'amber',
        chain: 1,
      },
      { type: 'comboChanged', multiplier: 3 },
    ]);

    const snapshot = effects.snapshot();
    expect(snapshot.fragments).toHaveLength(180);
    expect(snapshot.combo).toMatchObject({ multiplier: 3, remainingMs: 360 });
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.fragments)).toBe(true);
    expect(Object.isFrozen(snapshot.fragments[0])).toBe(true);

    for (let update = 0; update < 8; update += 1) effects.update(50);
    expect(effects.snapshot()).toMatchObject({
      fragments: expect.any(Array),
      flashes: [],
      shake: { magnitude: 0, remainingMs: 0 },
      combo: { multiplier: 0, x: 0, y: 0, ageMs: 0, lifetimeMs: 0, remainingMs: 0 },
    });
  });

  it('clears all visual state on reset', () => {
    const effects = new EffectsSystem({ random: () => 0.5 });
    effects.consume([
      { type: 'blockLanded', block: { id: 1, color: 'teal' }, cell: { side: 0, index: 0 } },
      { type: 'comboChanged', multiplier: 2 },
    ]);

    effects.reset();

    expect(effects.snapshot()).toEqual({
      assemblies: [],
      fragments: [],
      bonusImpact: null,
      particles: [],
      flashes: [],
      shake: { magnitude: 0, remainingMs: 0 },
      combo: { multiplier: 0, x: 0, y: 0, ageMs: 0, lifetimeMs: 0, remainingMs: 0 },
      shockwaves: [],
      labels: [],
      screenFlash: null,
      hitStopRemainingMs: 0,
    });
  });
});
