import { afterEach, describe, expect, it, vi } from 'vitest';
import { CanvasRenderer } from '../src/render/CanvasRenderer';
import { GameEngine } from '../src/game/GameEngine';
import { EffectsSystem } from '../src/render/EffectsSystem';
import type { GameSnapshot } from '../src/game/types';

afterEach(() => vi.restoreAllMocks());

// Canvas is an external drawing boundary unavailable in jsdom. Record submitted
// polygons to check world placement without mocking the renderer or geometry.
function surface() {
  const polygons: { points: number[][]; style: unknown }[] = [];
  let points: number[][] = [];
  const context = {
    setTransform: vi.fn(), clearRect: vi.fn(), fillRect: vi.fn(),
    save: vi.fn(), restore: vi.fn(), translate: vi.fn(), scale: vi.fn(), rotate: vi.fn(),
    beginPath: () => { points = []; },
    moveTo: (x: number, y: number) => { points.push([x, y]); },
    lineTo: (x: number, y: number) => { points.push([x, y]); },
    closePath: vi.fn(), stroke: vi.fn(), arc: vi.fn(), setLineDash: vi.fn(),
    fill: () => { polygons.push({ points: [...points], style: context.fillStyle }); },
    fillStyle: '' as unknown, strokeStyle: '', globalAlpha: 1,
    createLinearGradient: () => ({ addColorStop: vi.fn() }),
    createRadialGradient: () => ({ addColorStop: vi.fn() }),
    fillText: vi.fn(),
  };
  const canvas = document.createElement('canvas');
  vi.spyOn(canvas, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
  return { canvas, context, polygons, renderer: new CanvasRenderer(canvas) };
}

const effects = () => new EffectsSystem().snapshot();
const playing = (): GameSnapshot => {
  const game = new GameEngine({ spawning: false });
  game.start();
  return game.getSnapshot();
};

describe('CanvasRenderer', () => {
  it('draws one contracting plate per clear origin before the particle burst without mutating effects', () => {
    const { renderer, polygons, context } = surface();
    const fx = new EffectsSystem(() => 0.5);
    fx.consume([{ type: 'matchCleared', cells: [{ side: 0, index: 0 }, { side: 0, index: 1 }], color: 'teal', chain: 1 }]);
    fx.update(35);
    const snapshot = fx.snapshot();
    const before = JSON.stringify(snapshot);
    renderer.resize(800, 600, 1);
    renderer.render(playing(), snapshot, 0);
    const plates = polygons.filter(({ points, style }) => points.length === 4 && typeof style === 'object');
    expect(plates).toHaveLength(2);
    expect(plates.flatMap(plate => plate.points.flat()).every(Number.isFinite)).toBe(true);
    expect(context.scale.mock.calls.some(([x, y]) => x > 0.5 && x < 1 && y === x)).toBe(true);
    expect(JSON.stringify(snapshot)).toBe(before);
    polygons.length = 0;
    fx.update(40);
    renderer.render(playing(), fx.snapshot(), 0);
    expect(polygons.filter(({ points, style }) => points.length === 4 && typeof style === 'object')).toHaveLength(0);
  });
  it('scales the backing canvas while keeping CSS world coordinates independent of DPR', () => {
    const { canvas, context, renderer } = surface();
    renderer.resize(800, 600, 2);
    expect([canvas.width, canvas.height]).toEqual([1600, 1200]);
    expect(context.setTransform).toHaveBeenCalledWith(2, 0, 0, 2, 0, 0);
    expect(renderer.worldToScreen({ x: 0, y: 0 })).toEqual({ x: 400, y: 300 });
    const point = renderer.worldToScreen({ x: 100, y: -100 });
    expect(point.x).toBeGreaterThan(400);
    expect(point.y).toBeLessThan(300);
    renderer.resize(800, 600, 1);
    expect(renderer.worldToScreen({ x: 100, y: -100 })).toEqual(point);
  });

  it('draws attached and interpolated falling plates from immutable world positions', () => {
    const { renderer, polygons } = surface();
    renderer.resize(800, 600, 1);
    const snapshot = { ...playing(), stacks: [[{ id: 1, color: 'coral' as const }], [], [], [], [], []],
      falling: [{ id: 2, color: 'sky' as const, lane: 0, distance: 180, speed: 120 }] };
    const before = JSON.stringify(snapshot);
    renderer.render(snapshot, effects(), 0.5);
    const plates = polygons.filter(({ points, style }) => points.length === 4 && typeof style === 'object');
    expect(plates).toHaveLength(2);
    expect(plates[0]!.points.map((p) => p[1])).toEqual([-74, -74, -94, -94]);
    expect(plates[1]!.points.map((p) => p[1])).toEqual([-183, -183, -203, -203]);
    expect(JSON.stringify(snapshot)).toBe(before);
  });

  it('interpolates the short rotation across orientation wrap and finishes at the target', () => {
    const { renderer, polygons } = surface();
    const snapshot = { ...playing(), orientation: 5, elapsedMs: 100 };
    const body = () => polygons.filter((p) => p.points.length === 6 && typeof p.style === 'object').at(-1)!.points[0]!;
    renderer.render(snapshot, effects(), 0);
    renderer.render({ ...snapshot, orientation: 0, elapsedMs: 116 }, effects(), 0);
    renderer.render({ ...snapshot, orientation: 0, elapsedMs: 176 }, effects(), 0);
    // Halfway through one 60-degree turn: the rightmost vertex points up-right.
    expect(body()[0]).toBeCloseTo(72);
    expect(body()[1]).toBeCloseTo(-41.569219);
    renderer.render({ ...snapshot, orientation: 0, elapsedMs: 236 }, effects(), 0);
    expect(body()[0]).toBeCloseTo(41.569219);
    expect(body()[1]).toBeCloseTo(-72);
  });

  it('keeps a decorative field visible in menu and draws finite effects without mutating them', () => {
    const { renderer, polygons, context } = surface();
    const fx = new EffectsSystem(() => 0.5);
    fx.consume([{ type: 'matchCleared', cells: [{ side: 0, index: 0 }], color: 'teal', chain: 2 },
      { type: 'comboChanged', multiplier: 2 },
      { type: 'blockLanded', cell: { side: 1, index: 0 }, block: { id: 4, color: 'amber' } }]);
    fx.update(50); fx.update(50);
    const snapshot = fx.snapshot();
    const before = JSON.stringify(snapshot);
    renderer.resize(800, 600, 2);
    renderer.render(new GameEngine().getSnapshot(), snapshot, 0.5);
    expect(polygons.filter(({ points, style }) => points.length === 4 && typeof style === 'object').length).toBeGreaterThan(4);
    expect(polygons.flatMap((p) => p.points.flat()).every(Number.isFinite)).toBe(true);
    expect(context.fillText).toHaveBeenCalledWith('×2', expect.any(Number), expect.any(Number));
    expect(JSON.stringify(snapshot)).toBe(before);
  });
});
