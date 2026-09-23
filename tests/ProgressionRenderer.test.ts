import { afterEach, describe, expect, it, vi } from 'vitest';
import { VISUAL_COLORS } from '../src/game/constants';
import { GameEngine } from '../src/game/GameEngine';
import type { GameSnapshot } from '../src/game/types';
import { CanvasRenderer } from '../src/render/CanvasRenderer';
import { EffectsSystem, type EffectsSnapshot } from '../src/render/EffectsSystem';
import { PresentationSystem } from '../src/presentation/PresentationSystem';

afterEach(() => vi.restoreAllMocks());

interface RecordedPolygon {
  readonly points: readonly (readonly [number, number])[];
  readonly style: unknown;
  readonly alpha: number;
  readonly depth: number;
}

interface RecordedStroke {
  readonly points: readonly (readonly [number, number])[];
  readonly style: unknown;
  readonly alpha: number;
  readonly depth: number;
}

function surface() {
  const polygons: RecordedPolygon[] = [];
  const fills: { x: number; y: number; width: number; height: number; style: unknown; alpha: number; depth: number }[] = [];
  const text: { value: string; x: number; y: number; depth: number }[] = [];
  const rotations: number[] = [];
  const scales: [number, number][] = [];
  const strokes: RecordedStroke[] = [];
  let points: [number, number][] = [];
  let depth = 0;
  const context = {
    setTransform: vi.fn(), clearRect: vi.fn(),
    fillRect: (x: number, y: number, width: number, height: number) => fills.push({
      x, y, width, height, style: context.fillStyle, alpha: context.globalAlpha, depth,
    }),
    save: () => { depth += 1; }, restore: () => { depth -= 1; },
    translate: vi.fn(),
    scale: (x: number, y: number) => { scales.push([x, y]); },
    rotate: (angle: number) => { rotations.push(angle); },
    beginPath: () => { points = []; },
    moveTo: (x: number, y: number) => { points.push([x, y]); },
    lineTo: (x: number, y: number) => { points.push([x, y]); },
    closePath: vi.fn(),
    stroke: () => strokes.push({ points: [...points], style: context.strokeStyle, alpha: context.globalAlpha, depth }),
    arc: vi.fn(), setLineDash: vi.fn(),
    fill: () => { polygons.push({ points: [...points], style: context.fillStyle, alpha: context.globalAlpha, depth }); },
    fillStyle: '' as unknown, strokeStyle: '' as unknown, globalAlpha: 1, lineWidth: 1,
    shadowColor: '', shadowBlur: 0,
    font: '', textAlign: 'start' as CanvasTextAlign,
    createLinearGradient: () => ({ addColorStop: vi.fn() }),
    createRadialGradient: () => ({ addColorStop: vi.fn() }),
    fillText: (value: string, x: number, y: number) => text.push({ value, x, y, depth }),
  };
  const canvas = document.createElement('canvas');
  vi.spyOn(canvas, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
  const renderer = new CanvasRenderer(canvas);
  renderer.resize(800, 600, 1);
  return { renderer, context, polygons, fills, text, rotations, scales, strokes };
}

const baseSnapshot = (): GameSnapshot => {
  const game = new GameEngine({ spawning: false });
  game.start();
  return game.getSnapshot();
};

const snapshot = (overrides: Partial<GameSnapshot> = {}): GameSnapshot => ({ ...baseSnapshot(), ...overrides });
const baseEffects = (): EffectsSnapshot => new EffectsSystem({ random: () => 0.5 }).snapshot();
const presentation = () => new PresentationSystem().snapshot();
const center = (polygon: RecordedPolygon): readonly [number, number] => polygon.points.reduce(
  ([x, y], [pointX, pointY]) => [x + pointX / polygon.points.length, y + pointY / polygon.points.length] as const,
  [0, 0] as const,
);
const plates = (polygons: readonly RecordedPolygon[]) => polygons.filter(({ points, style }) => points.length === 4 && typeof style === 'object');

describe('progression rendering', () => {
  it('curves a drifting plate and its trail toward the announced destination lane', () => {
    const { renderer, polygons } = surface();
    const drifting = snapshot({
      falling: [{ id: 1, color: 'sky', lane: 0, distance: 280, speed: 0, driftToLane: 1, driftProgress: 0.5 }],
    });

    renderer.render(drifting, baseEffects(), presentation(), 1);

    const [plateX, plateY] = center(plates(polygons).at(-1)!);
    expect(plateX).toBeGreaterThan(0);
    expect(plateY).toBeLessThan(0);
    const trailCenters = polygons.filter(({ points, style }) => points.length === 4 && typeof style === 'string').map(center);
    expect(trailCenters.some(([x]) => x > 0 && x < plateX)).toBe(true);

    polygons.length = 0;
    renderer.render(snapshot({
      elapsedMs: 1,
      falling: [{ id: 1, color: 'sky', lane: 0, distance: 200, speed: 0, driftToLane: 1, driftProgress: 1 }],
    }), baseEffects(), presentation(), 1);
    const [endX, endY] = center(plates(polygons).at(-1)!);
    expect(endX).toBeCloseTo(Math.cos(-Math.PI / 6) * 212);
    expect(endY).toBeCloseTo(Math.sin(-Math.PI / 6) * 212);
  });

  it('draws a translucent broken mirage only while it is visible', () => {
    const { renderer, polygons } = surface();
    const visible = snapshot({
      falling: [{ id: 2, color: 'amber', lane: 0, distance: 300, speed: 0, mirageLane: 1, mirageVisible: true }],
    });
    renderer.render(visible, baseEffects(), presentation(), 1);
    expect(polygons.some((polygon) => {
      const [x] = center(polygon);
      return polygon.points.length >= 3 && x > 100 && polygon.alpha > 0.1 && polygon.alpha < 0.5;
    })).toBe(true);

    polygons.length = 0;
    renderer.render({
      ...visible,
      elapsedMs: 1,
      falling: [{ ...visible.falling[0]!, mirageVisible: false }],
    }, baseEffects(), presentation(), 1);
    expect(polygons.some((polygon) => {
      const [x] = center(polygon);
      return polygon.points.length >= 3 && x > 100 && polygon.alpha > 0.1 && polygon.alpha < 0.5;
    })).toBe(false);
  });

  it('shows the current and future matte colors before a color shift boundary', () => {
    const { renderer, polygons } = surface();
    renderer.render(snapshot({
      falling: [{
        id: 3, color: 'coral', lane: 0, distance: 300, speed: 0,
        shiftToColor: 'sky', shiftAtDistance: 260,
      }],
    }), baseEffects(), presentation(), 1);

    expect(polygons.some(({ style, points }) => style === VISUAL_COLORS.sky && points.length >= 3)).toBe(true);
    expect(plates(polygons)).toHaveLength(1);
  });

  it('renders a large bonus token with both its glyph and Russian name', () => {
    const { renderer, polygons, text } = surface();
    renderer.render(snapshot({
      fallingBonuses: [{ id: 4, type: 'colorBreak', lane: 2, distance: 320, speed: 0 }],
    }), baseEffects(), presentation(), 1);

    expect(polygons.some(({ style }) => style === VISUAL_COLORS.coral)).toBe(true);
    expect(text).toContainEqual(expect.objectContaining({ value: '◆' }));
    expect(text).toContainEqual(expect.objectContaining({ value: 'ЦВЕТОВОЙ ВЗРЫВ' }));
    const token = polygons.find(({ points, style }) => points.length === 6 && style === VISUAL_COLORS.coral)!;
    const [tokenX, tokenY] = center(token);
    expect(Math.max(...token.points.map(([x, y]) => Math.hypot(x - tokenX, y - tokenY)))).toBeGreaterThan(22);
  });

  it('assembles a newly spawned block from a scaled faceted silhouette', () => {
    const { renderer, scales, polygons } = surface();
    const block = { id: 9, color: 'teal' as const, lane: 2, distance: 520, speed: 0 };
    const fx = new EffectsSystem({ random: () => 0.5 });
    fx.consume([{ type: 'blockSpawned', block }]);

    renderer.render(snapshot({ falling: [block] }), fx.snapshot(), presentation(), 0);

    expect(scales.some(([x, y]) => Math.abs(x - 0.72) < 0.01 && Math.abs(y - 0.72) < 0.01)).toBe(true);
    expect(polygons.filter(({ points }) => points.length === 3).length).toBeGreaterThanOrEqual(2);
  });

  it('draws pulse destruction as fragments with a central outlined impact', () => {
    const { renderer, polygons, strokes } = surface();
    const fx = new EffectsSystem({ random: () => 0.5 });
    fx.consume([
      { type: 'bonusActivated', bonus: 'pulse' },
      {
        type: 'bonusRemoved', bonus: 'pulse', cells: [{ side: 0, index: 0 }],
        blocks: [{ id: 1, color: 'coral' }], scoreDelta: 80,
      },
    ]);
    fx.update(100);

    renderer.render(snapshot(), fx.snapshot(), presentation(), 0);

    expect(strokes.filter(({ points }) => points.length === 6).length).toBeGreaterThanOrEqual(3);
    expect(polygons.some(({ points }) => points.length >= 3 && points.length <= 5)).toBe(true);
  });

  it('draws a cool multi-ring wave for slow without creating fragments', () => {
    const { renderer, strokes } = surface();
    const fx = new EffectsSystem({ random: () => 0.5 });
    fx.consume([{ type: 'bonusActivated', bonus: 'slow' }]);
    fx.update(110);

    renderer.render(snapshot(), fx.snapshot(), presentation(), 0);

    expect(fx.snapshot().fragments).toEqual([]);
    expect(strokes.filter(({ points, style }) => points.length === 6 && style === VISUAL_COLORS.sky).length)
      .toBeGreaterThanOrEqual(2);
  });

  it('sweeps a narrow cleanse cut across the removed side', () => {
    const { renderer, strokes } = surface();
    const fx = new EffectsSystem({ random: () => 0.5 });
    fx.consume([
      { type: 'bonusActivated', bonus: 'cleanse' },
      {
        type: 'bonusRemoved', bonus: 'cleanse', cells: [{ side: 1, index: 2 }],
        blocks: [{ id: 8, color: 'teal' }], scoreDelta: 80,
      },
    ]);
    fx.update(110);

    renderer.render(snapshot(), fx.snapshot(), presentation(), 0);

    expect(strokes.some(({ points, style }) => {
      if (points.length !== 2 || style !== VISUAL_COLORS.ink) return false;
      const [first, second] = points;
      if (!first || !second) return false;
      return Math.hypot(second[0] - first[0], second[1] - first[1]) >= 24;
    })).toBe(true);
  });

  it('flashes every color-break source plate together before release', () => {
    const { renderer, polygons } = surface();
    const fx = new EffectsSystem({ random: () => 0.5 });
    fx.consume([
      { type: 'bonusActivated', bonus: 'colorBreak' },
      {
        type: 'bonusRemoved', bonus: 'colorBreak',
        cells: [{ side: 0, index: 0 }, { side: 3, index: 1 }],
        blocks: [{ id: 3, color: 'coral' }, { id: 4, color: 'coral' }], scoreDelta: 160,
      },
    ]);
    fx.update(30);

    renderer.render(snapshot(), fx.snapshot(), presentation(), 0);

    expect(polygons.filter(({ points, style, alpha }) => (
      points.length === 4 && style === VISUAL_COLORS.coral && alpha > 0 && alpha < 1
    )).length).toBeGreaterThanOrEqual(2);
  });

  it('draws the collected glyph during the staged transfer', () => {
    const { renderer, text } = surface();
    const timeline = new PresentationSystem();
    timeline.consume([{
      type: 'bonusCollected', bonus: 'pulse',
      token: { id: 12, type: 'pulse', lane: 2, distance: 72, speed: 150 },
    }]);
    timeline.update(320);

    renderer.render(snapshot({ bonus: { stored: 'pulse', slowRemainingMs: 0 } }), baseEffects(), timeline.snapshot(), 0);

    expect(timeline.snapshot().transfer).toMatchObject({
      bonus: 'pulse', ageMs: 320, delayMs: 90, lifetimeMs: 800,
    });
    expect(text).toContainEqual(expect.objectContaining({ value: '⌁' }));
  });

  it('keeps reduced motion free of assembly transforms and traveling fragments', () => {
    const { renderer, scales, polygons, strokes } = surface();
    const block = { id: 13, color: 'sky' as const, lane: 0, distance: 420, speed: 0 };
    const fx = new EffectsSystem({ random: () => 0.5, reducedMotion: true });
    fx.consume([
      { type: 'blockSpawned', block },
      { type: 'matchCleared', cells: [{ side: 0, index: 0 }], color: 'sky', chain: 1 },
      { type: 'bonusActivated', bonus: 'pulse' },
      {
        type: 'bonusRemoved', bonus: 'pulse', cells: [{ side: 0, index: 0 }],
        blocks: [{ id: 1, color: 'sky' }], scoreDelta: 80,
      },
    ]);

    renderer.render(snapshot({ falling: [block] }), fx.snapshot(), presentation(), 0);

    expect(scales.some(([x, y]) => Math.abs(x - 0.72) < 0.01 && Math.abs(y - 0.72) < 0.01)).toBe(false);
    expect(polygons.filter(({ points }) => points.length === 3 || points.length === 5)).toHaveLength(0);
    expect(strokes.filter(({ points, style }) => points.length === 6 && style === VISUAL_COLORS.ink)).toHaveLength(1);
  });

  it('reverses guide motion without changing attached stack geometry and keeps pressure compression within four percent', () => {
    const normalSurface = surface();
    const reverseSurface = surface();
    const attached = snapshot({
      elapsedMs: 1_000,
      stacks: [[{ id: 5, color: 'teal' }], [], [], [], [], []],
    });
    normalSurface.renderer.render(attached, baseEffects(), presentation(), 1);
    reverseSurface.renderer.render({
      ...attached,
      cycle: { ...attached.cycle, phase: 'pressure', anomalies: [{ type: 'reverse', remainingMs: 1_000 }] },
    }, baseEffects(), presentation(), 1);

    expect(normalSurface.rotations.some((angle) => angle > 0)).toBe(true);
    expect(reverseSurface.rotations.some((angle) => angle < 0)).toBe(true);
    expect(center(plates(reverseSurface.polygons)[0]!)).toEqual(center(plates(normalSurface.polygons)[0]!));
    expect(reverseSurface.scales.some(([x, y]) => x === y && x >= 0.96 && x < 1)).toBe(true);
  });

  it('draws shockwaves in the shaken world but labels and flashes in stable screen space', () => {
    const { renderer, fills, text, strokes } = surface();
    const effects: EffectsSnapshot = {
      ...baseEffects(),
      shake: { magnitude: 8, remainingMs: 100 },
      shockwaves: [{ x: 10, y: 20, color: 'ivory', ageMs: 100, lifetimeMs: 500, intensity: 1 }],
      labels: [{ text: 'CHAIN ×2', tone: 'amber', ageMs: 100, lifetimeMs: 600 }],
      screenFlash: { tone: 'coral', intensity: 0.75, remainingMs: 80 },
    };

    renderer.render(snapshot(), effects, presentation(), 1);

    expect(strokes.some(({ style, depth }) => style === VISUAL_COLORS.ink && depth > 0)).toBe(true);
    expect(text).toContainEqual(expect.objectContaining({ value: 'CHAIN ×2', depth: 1 }));
    expect(fills).toContainEqual(expect.objectContaining({ x: 0, y: 0, width: 800, height: 600, depth: 1 }));
  });

  it('holds one previous gameplay snapshot, then catches up, and clears the hold on a mode change', () => {
    const { renderer, polygons } = surface();
    const previous = snapshot({
      elapsedMs: 100,
      falling: [{ id: 6, color: 'coral', lane: 0, distance: 300, speed: 0 }],
    });
    renderer.render(previous, baseEffects(), presentation(), 1);
    const previousY = center(plates(polygons).at(-1)!)[1];

    const current = { ...previous, elapsedMs: 116, falling: [{ ...previous.falling[0]!, distance: 200 }] };
    polygons.length = 0;
    renderer.render(current, { ...baseEffects(), hitStopRemainingMs: 60 }, presentation(), 1);
    expect(center(plates(polygons).at(-1)!)[1]).toBeCloseTo(previousY);

    polygons.length = 0;
    renderer.render({ ...current, elapsedMs: 176 }, baseEffects(), presentation(), 1);
    expect(center(plates(polygons).at(-1)!)[1]).toBeCloseTo(-212);

    polygons.length = 0;
    renderer.render({ ...current, mode: 'upgrade', elapsedMs: 192 }, { ...baseEffects(), hitStopRemainingMs: 60 }, presentation(), 1);
    expect(center(plates(polygons).at(-1)!)[1]).toBeCloseTo(-212);
  });
});
