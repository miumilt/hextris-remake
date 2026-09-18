import { afterEach, describe, expect, it, vi } from 'vitest';
import { VISUAL_COLORS } from '../src/game/constants';
import { GameEngine } from '../src/game/GameEngine';
import type { GameSnapshot } from '../src/game/types';
import { CanvasRenderer } from '../src/render/CanvasRenderer';
import { EffectsSystem, type EffectsSnapshot } from '../src/render/EffectsSystem';

afterEach(() => vi.restoreAllMocks());

interface RecordedPolygon {
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
  const strokes: { style: unknown; alpha: number; depth: number }[] = [];
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
    stroke: () => strokes.push({ style: context.strokeStyle, alpha: context.globalAlpha, depth }),
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

    renderer.render(drifting, baseEffects(), 1);

    const [plateX, plateY] = center(plates(polygons).at(-1)!);
    expect(plateX).toBeGreaterThan(0);
    expect(plateY).toBeLessThan(0);
    const trailCenters = polygons.filter(({ points, style }) => points.length === 4 && typeof style === 'string').map(center);
    expect(trailCenters.some(([x]) => x > 0 && x < plateX)).toBe(true);

    polygons.length = 0;
    renderer.render(snapshot({
      elapsedMs: 1,
      falling: [{ id: 1, color: 'sky', lane: 0, distance: 200, speed: 0, driftToLane: 1, driftProgress: 1 }],
    }), baseEffects(), 1);
    const [endX, endY] = center(plates(polygons).at(-1)!);
    expect(endX).toBeCloseTo(Math.cos(-Math.PI / 6) * 212);
    expect(endY).toBeCloseTo(Math.sin(-Math.PI / 6) * 212);
  });

  it('draws a translucent broken mirage only while it is visible', () => {
    const { renderer, polygons } = surface();
    const visible = snapshot({
      falling: [{ id: 2, color: 'amber', lane: 0, distance: 300, speed: 0, mirageLane: 1, mirageVisible: true }],
    });
    renderer.render(visible, baseEffects(), 1);
    expect(polygons.some((polygon) => {
      const [x] = center(polygon);
      return polygon.points.length >= 3 && x > 100 && polygon.alpha > 0.1 && polygon.alpha < 0.5;
    })).toBe(true);

    polygons.length = 0;
    renderer.render({
      ...visible,
      elapsedMs: 1,
      falling: [{ ...visible.falling[0]!, mirageVisible: false }],
    }, baseEffects(), 1);
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
    }), baseEffects(), 1);

    expect(polygons.some(({ style, points }) => style === VISUAL_COLORS.sky && points.length >= 3)).toBe(true);
    expect(plates(polygons)).toHaveLength(1);
  });

  it('renders an ivory inset bonus token with its deterministic one-letter glyph', () => {
    const { renderer, polygons, text } = surface();
    renderer.render(snapshot({
      fallingBonuses: [{ id: 4, type: 'colorBreak', lane: 2, distance: 320, speed: 0 }],
    }), baseEffects(), 1);

    expect(polygons.some(({ style }) => style === VISUAL_COLORS.ink)).toBe(true);
    expect(text).toContainEqual(expect.objectContaining({ value: '◆' }));
  });

  it('reverses guide motion without changing attached stack geometry and keeps surge compression within four percent', () => {
    const normalSurface = surface();
    const reverseSurface = surface();
    const attached = snapshot({
      elapsedMs: 1_000,
      stacks: [[{ id: 5, color: 'teal' }], [], [], [], [], []],
    });
    normalSurface.renderer.render(attached, baseEffects(), 1);
    reverseSurface.renderer.render({
      ...attached,
      cycle: { ...attached.cycle, phase: 'surge', anomalies: [{ type: 'reverse', remainingMs: 1_000 }] },
    }, baseEffects(), 1);

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

    renderer.render(snapshot(), effects, 1);

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
    renderer.render(previous, baseEffects(), 1);
    const previousY = center(plates(polygons).at(-1)!)[1];

    const current = { ...previous, elapsedMs: 116, falling: [{ ...previous.falling[0]!, distance: 200 }] };
    polygons.length = 0;
    renderer.render(current, { ...baseEffects(), hitStopRemainingMs: 60 }, 1);
    expect(center(plates(polygons).at(-1)!)[1]).toBeCloseTo(previousY);

    polygons.length = 0;
    renderer.render({ ...current, elapsedMs: 176 }, baseEffects(), 1);
    expect(center(plates(polygons).at(-1)!)[1]).toBeCloseTo(-212);

    polygons.length = 0;
    renderer.render({ ...current, mode: 'upgrade', elapsedMs: 192 }, { ...baseEffects(), hitStopRemainingMs: 60 }, 1);
    expect(center(plates(polygons).at(-1)!)[1]).toBeCloseTo(-212);
  });
});
