import { afterEach, describe, expect, it, vi } from 'vitest';
import { CanvasRenderer, type RenderLayer } from '../src/render/CanvasRenderer';
import { GameEngine } from '../src/game/GameEngine';
import { EffectsSystem } from '../src/render/EffectsSystem';
import type { GameSnapshot } from '../src/game/types';
import { InputController } from '../src/runtime/InputController';
import { PresentationSystem } from '../src/presentation/PresentationSystem';

afterEach(() => vi.restoreAllMocks());

// Canvas is an external drawing boundary unavailable in jsdom. Record submitted
// polygons to check world placement without mocking the renderer or geometry.
function surface() {
  const polygons: { points: number[][]; style: unknown; scale: number }[] = [];
  let points: number[][] = [];
  let drawingScale = 1;
  const savedScales: number[] = [];
  const context = {
    setTransform: vi.fn((a: number) => { drawingScale = a; }), clearRect: vi.fn(), fillRect: vi.fn(),
    save: () => { savedScales.push(drawingScale); }, restore: () => { drawingScale = savedScales.pop()!; },
    translate: vi.fn(), scale: vi.fn((x: number, _y: number) => { drawingScale *= x; }), rotate: vi.fn(),
    beginPath: () => { points = []; },
    moveTo: (x: number, y: number) => { points.push([x, y]); },
    lineTo: (x: number, y: number) => { points.push([x, y]); },
    closePath: vi.fn(), stroke: vi.fn(), arc: vi.fn(), setLineDash: vi.fn(),
    fill: () => { polygons.push({ points: [...points], style: context.fillStyle, scale: drawingScale }); },
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
const presentation = () => new PresentationSystem().snapshot();
const playing = (): GameSnapshot => {
  const game = new GameEngine({ spawning: false });
  game.start();
  return game.getSnapshot();
};

describe('CanvasRenderer', () => {
  it('draws six named layers in the required order', () => {
    const { canvas } = surface();
    const layers: RenderLayer[] = [];
    const renderer = new CanvasRenderer(canvas, { onLayer: layer => layers.push(layer) });
    renderer.resize(800, 600, 1);
    renderer.render(playing(), effects(), presentation(), 0);
    expect(layers).toEqual(['background', 'guides', 'field', 'falling', 'world-effects', 'screen-effects']);
  });

  it.each([[0, 'assemble'], [320, 'guides'], [760, 'ready'], [1199, 'ready']] as const)(
    'renders opening stage at %i ms (%s)', (ageMs, stage) => {
      const { canvas } = surface();
      const stages: string[] = [];
      const renderer = new CanvasRenderer(canvas, { onOpeningStage: value => stages.push(value) });
      renderer.resize(800, 600, 1);
      const timeline = new PresentationSystem();
      timeline.beginRun([1, 2]);
      timeline.update(ageMs, 'playing');
      renderer.render({ ...playing(), opening: { remainingMs: 1200 - ageMs, previewLanes: [1, 2] } },
        effects(), timeline.snapshot(), 0);
      expect(stages).toEqual([stage]);
    },
  );
  it('assembles six matte hub facets and clears READY before active play', () => {
    const { renderer, polygons, context } = surface();
    renderer.resize(800, 600, 1);
    const timeline = new PresentationSystem();
    timeline.beginRun([1, 2]);
    renderer.render(playing(), effects(), timeline.snapshot(), 0);
    expect(polygons.filter(({ points }) => points.length === 3).length).toBeGreaterThanOrEqual(6);
    timeline.update(760, 'playing');
    renderer.render(playing(), effects(), timeline.snapshot(), 0);
    expect(context.fillText).toHaveBeenCalledWith('ГОТОВ', 400, 300);
    context.fillText.mockClear();
    timeline.update(440, 'playing');
    renderer.render(playing(), effects(), timeline.snapshot(), 0);
    expect(context.fillText).not.toHaveBeenCalledWith('ГОТОВ', 400, 300);
  });
  it.each([['ArrowRight', 1], ['d', 1], ['ArrowLeft', -1], ['a', -1]] as const)(
    '%s moves a top attached plate visibly in the requested direction', (key, horizontalDirection) => {
      const { renderer, polygons } = surface();
      const game = new GameEngine({ spawning: false });
      game.start();
      game.debugAttachGroup('coral', [{ side: 0, count: 1 }]);
      const input = new InputController(window, command => game.enqueue(command), () => game.getSnapshot().mode);
      const center = () => {
        const plate = polygons.find(({ points, style }) => points.length === 4 && typeof style === 'object')!;
        return plate.points.reduce((sum, [x, y]) => [sum[0]! + x! / 4, sum[1]! + y! / 4], [0, 0]);
      };
      const draw = () => { polygons.length = 0; renderer.render(game.getSnapshot(), effects(), presentation(), 0); return center(); };
      renderer.resize(800, 600, 1);
      expect(draw()[0]).toBeCloseTo(0);
      input.start();
      try {
        window.dispatchEvent(new KeyboardEvent('keydown', { key }));
        game.update(0);
        draw(); // Begin the renderer's actual 120 ms interpolation.
        game.update(60);
        const midpoint = draw();
        expect(midpoint[0]! * horizontalDirection).toBeGreaterThan(0);
        expect(midpoint[1]).toBeLessThan(0);
        game.update(60);
        const end = draw();
        expect(end[0]! * horizontalDirection).toBeGreaterThan(Math.abs(midpoint[0]!));
        expect(end[1]).toBeCloseTo(-42); // Top plate center (0, -84) rotated exactly 60 degrees.
      } finally { input.stop(); }
    },
  );
  it('draws a smaller menu hub that can grow into the live field', () => {
    const { renderer, polygons } = surface();
    renderer.resize(1280, 720, 1);
    const hubRadius = () => {
      const hub = polygons.find(({ points, style }) => points.length === 6 && typeof style === 'object')!;
      return Math.hypot(...hub.points[0]!) * hub.scale;
    };
    renderer.render(new GameEngine().getSnapshot(), effects(), presentation(), 0);
    const menuRadius = hubRadius();
    polygons.length = 0;
    renderer.render(playing(), effects(), presentation(), 0);
    expect(menuRadius).toBeGreaterThan(0);
    expect(menuRadius).toBeLessThan(hubRadius());
  });
  it('keeps a cracked source plate visible while large fragments begin to release', () => {
    const { renderer, polygons, context } = surface();
    const fx = new EffectsSystem({ random: () => 0.5 });
    fx.consume([{ type: 'matchCleared', cells: [{ side: 0, index: 0 }, { side: 0, index: 1 }], color: 'teal', chain: 1 }]);
    fx.update(50);
    const snapshot = fx.snapshot();
    const before = JSON.stringify(snapshot);
    renderer.resize(800, 600, 1);
    renderer.render(playing(), snapshot, presentation(), 0);
    const plates = polygons.filter(({ points, style }) => points.length === 4 && typeof style === 'object');
    expect(plates).toHaveLength(2);
    expect(plates.flatMap(plate => plate.points.flat()).every(Number.isFinite)).toBe(true);
    expect(context.scale.mock.calls.some(([x, y]) => x > 0.5 && x < 1 && y === x)).toBe(true);
    expect(JSON.stringify(snapshot)).toBe(before);
    polygons.length = 0;
    fx.update(50);
    fx.update(50);
    renderer.render(playing(), fx.snapshot(), presentation(), 0);
    expect(polygons.filter(({ points, style }) => points.length === 4 && typeof style === 'object')).toHaveLength(2);
    expect(polygons.some(({ points, style }) => points.length >= 3 && points.length <= 5 && typeof style === 'string')).toBe(true);

    polygons.length = 0;
    fx.update(50); fx.update(50); fx.update(50);
    renderer.render(playing(), fx.snapshot(), presentation(), 0);
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
    renderer.render(snapshot, effects(), presentation(), 0.5);
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
    renderer.render(snapshot, effects(), presentation(), 0);
    renderer.render({ ...snapshot, orientation: 0, elapsedMs: 116 }, effects(), presentation(), 0);
    renderer.render({ ...snapshot, orientation: 0, elapsedMs: 176 }, effects(), presentation(), 0);
    // Halfway through one 60-degree turn: the rightmost vertex points up-right.
    expect(body()[0]).toBeCloseTo(72);
    expect(body()[1]).toBeCloseTo(-41.569219);
    renderer.render({ ...snapshot, orientation: 0, elapsedMs: 236 }, effects(), presentation(), 0);
    expect(body()[0]).toBeCloseTo(41.569219);
    expect(body()[1]).toBeCloseTo(-72);
  });

  it('keeps a decorative field visible in menu and draws finite effects without mutating them', () => {
    const { renderer, polygons, context } = surface();
    const fx = new EffectsSystem({ random: () => 0.5 });
    fx.consume([{ type: 'matchCleared', cells: [{ side: 0, index: 0 }], color: 'teal', chain: 2 },
      { type: 'comboChanged', multiplier: 2 },
      { type: 'blockLanded', cell: { side: 1, index: 0 }, block: { id: 4, color: 'amber' } }]);
    fx.update(50); fx.update(50);
    const snapshot = fx.snapshot();
    const before = JSON.stringify(snapshot);
    renderer.resize(800, 600, 2);
    renderer.render(new GameEngine().getSnapshot(), snapshot, presentation(), 0.5);
    expect(polygons.filter(({ points, style }) => points.length === 4 && typeof style === 'object').length).toBeGreaterThan(4);
    expect(polygons.flatMap((p) => p.points.flat()).every(Number.isFinite)).toBe(true);
    expect(context.fillText).toHaveBeenCalledWith('×2', expect.any(Number), expect.any(Number));
    expect(JSON.stringify(snapshot)).toBe(before);
  });
});
