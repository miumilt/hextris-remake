import { describe, expect, it } from 'vitest';
import { EffectsSystem } from '../src/render/EffectsSystem';

describe('EffectsSystem', () => {
  it('gives landings a brief restrained impact without weakening an active clear impact', () => {
    const effects = new EffectsSystem();
    const landing = { type: 'blockLanded' as const, block: { id: 1, color: 'sky' as const }, cell: { side: 0, index: 0 } };
    effects.consume([landing]);
    expect(effects.snapshot().shake.magnitude).toBeGreaterThan(0);
    expect(effects.snapshot().shake.magnitude).toBeLessThan(2);
    effects.update(50); effects.update(20);
    expect(effects.snapshot().shake).toEqual({ magnitude: 0, remainingMs: 0 });
    effects.consume([{ type: 'matchCleared', cells: [{ side: 0, index: 0 }], color: 'sky', chain: 2 }, landing]);
    expect(effects.snapshot().shake).toEqual({ magnitude: 4, remainingMs: 120 });
  });
  it('creates finite particles and removes them after their lifetime', () => {
    const effects = new EffectsSystem(() => 0.5);
    effects.consume([
      {
        type: 'matchCleared',
        cells: [{ side: 0, index: 0 }, { side: 0, index: 1 }, { side: 0, index: 2 }],
        color: 'coral',
        chain: 1,
      },
    ]);

    expect(effects.snapshot().particles.length).toBeGreaterThan(0);
    for (const particle of effects.snapshot().particles) {
      expect([particle.x, particle.y, particle.vx, particle.vy, particle.rotation, particle.spin,
        particle.ageMs, particle.lifetimeMs].every(Number.isFinite)).toBe(true);
    }
    for (let update = 0; update < 40; update += 1) effects.update(50);
    expect(effects.snapshot().particles).toEqual([]);
  });

  it('clamps one update to fifty milliseconds while integrating particle motion', () => {
    const effects = new EffectsSystem(() => 0.5);
    effects.consume([
      { type: 'matchCleared', cells: [{ side: 0, index: 0 }], color: 'coral', chain: 1 },
    ]);

    const before = effects.snapshot().particles[0];
    effects.update(500);

    const [particle] = effects.snapshot().particles;
    expect(particle?.ageMs).toBe(50);
    expect(particle?.burstDelayMs).toBeGreaterThan(0);
    expect(particle?.x).toBeCloseTo(before?.x ?? 0);
    expect(particle?.y).toBeCloseTo(before?.y ?? 0);

    effects.update(50);
    const moving = effects.snapshot().particles[0]!;
    expect(moving.ageMs).toBe(100);
    expect(moving.x).toBeCloseTo(before!.x + before!.vx * 0.03);
    expect(moving.y).toBeCloseTo(before!.y + before!.vy * 0.03);
    expect(before!.ageMs).toBe(0);
  });

  it('maps cleared cells and landings to their clockwise world-side positions', () => {
    const effects = new EffectsSystem(() => 0.5);
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
    expect(snapshot.particles[0]?.x).toBeCloseTo(10 + 36 * Math.sqrt(3));
    expect(snapshot.particles[0]).toMatchObject({ y: -16, color: 'coral' });
    expect(snapshot.shake).toMatchObject({ magnitude: 4, remainingMs: 120 });

    for (let update = 0; update < 4; update += 1) effects.update(50);
    expect(effects.snapshot().flashes).toEqual([]);
  });

  it('inverts grid orientation when positioning effects on a rotated attached side', () => {
    const effects = new EffectsSystem(() => 0.5);
    effects.consume([
      { type: 'matchCleared', cells: [{ side: 1, index: 0 }], color: 'teal', chain: 1 },
    ], { orientation: 1 });

    const particle = effects.snapshot().particles[0]!;
    expect(particle.x).toBeCloseTo(0);
    expect(particle.y).toBeCloseTo(-72);
    expect(particle.vy).toBeLessThan(0);
  });

  it('discards the oldest particles when later bursts exceed the cap', () => {
    const effects = new EffectsSystem(() => 0.5);
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

    const particles = effects.snapshot().particles;
    expect(particles).toHaveLength(180);
    expect(particles.every((particle) => particle.color === 'sky' && particle.ageMs === 0)).toBe(true);
  });

  it('caps particles, expires transient impulses, and exposes immutable snapshots', () => {
    const effects = new EffectsSystem(() => 0.5);
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
    expect(snapshot.particles).toHaveLength(180);
    expect(snapshot.combo).toMatchObject({ multiplier: 3, remainingMs: 360 });
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.particles)).toBe(true);
    expect(Object.isFrozen(snapshot.particles[0])).toBe(true);

    for (let update = 0; update < 8; update += 1) effects.update(50);
    expect(effects.snapshot()).toMatchObject({
      particles: expect.any(Array),
      flashes: [],
      shake: { magnitude: 0, remainingMs: 0 },
      combo: { multiplier: 0, x: 0, y: 0, ageMs: 0, lifetimeMs: 0, remainingMs: 0 },
    });
  });

  it('clears all visual state on reset', () => {
    const effects = new EffectsSystem(() => 0.5);
    effects.consume([
      { type: 'blockLanded', block: { id: 1, color: 'teal' }, cell: { side: 0, index: 0 } },
      { type: 'comboChanged', multiplier: 2 },
    ]);

    effects.reset();

    expect(effects.snapshot()).toEqual({
      particles: [],
      flashes: [],
      shake: { magnitude: 0, remainingMs: 0 },
      combo: { multiplier: 0, x: 0, y: 0, ageMs: 0, lifetimeMs: 0, remainingMs: 0 },
    });
  });
});
