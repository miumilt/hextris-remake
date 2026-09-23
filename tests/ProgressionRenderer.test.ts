import { afterEach, describe, expect, it, vi } from 'vitest';
import { HEX_APOTHEM, VISUAL_COLORS } from '../src/game/constants';
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
  const text: { value: string; x: number; y: number; depth: number; font: string }[] = [];
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
    fillText: (value: string, x: number, y: number) => text.push({ value, x, y, depth, font: context.font }),
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
  it('takes the opening hub from radius 118 through one continuous four-percent overshoot', () => {
    const { renderer, scales } = surface();
    const timeline = new PresentationSystem();
    const openingScale = (ageMs: number) => {
      scales.length = 0;
      timeline.beginRun([1]);
      timeline.update(ageMs, 'playing');
      renderer.render(snapshot({ elapsedMs: ageMs,
        opening: { remainingMs: 1_200 - ageMs, previewLanes: [1] } }),
      baseEffects(), timeline.snapshot(), 0);
      return scales.at(-1)![0];
    };
    expect(openingScale(0)).toBeCloseTo(118 / (HEX_APOTHEM / Math.cos(Math.PI / 6)));
    const beforeBoundary = openingScale(215.5);
    const afterBoundary = openingScale(216);
    expect(Math.abs(afterBoundary - beforeBoundary)).toBeLessThan(0.01);
    expect(afterBoundary).toBeGreaterThanOrEqual(0.96);
    expect(openingScale(319)).toBeLessThanOrEqual(1);
  });
  it('marks only deterministic preview lanes with an assertive matte opening guide', () => {
    const { renderer, strokes } = surface();
    const timeline = new PresentationSystem();
    timeline.beginRun([1, 2]);
    timeline.update(400, 'playing');
    const current = snapshot({ opening: { remainingMs: 800, previewLanes: [1, 2] } });
    renderer.render(current, baseEffects(), timeline.snapshot(), 0);
    expect(strokes.filter(({ style, alpha }) => style === VISUAL_COLORS.amber && alpha > 0.22).length).toBeGreaterThanOrEqual(2);
    strokes.length = 0;
    renderer.render({ ...current, opening: { remainingMs: 800, previewLanes: [] } },
      baseEffects(), timeline.snapshot(), 0);
    expect(strokes.filter(({ style }) => style === VISUAL_COLORS.amber)).toHaveLength(0);
  });
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
    expect(polygons.some(({ points, alpha }) => points.length === 4 && alpha === 0.86)).toBe(true);
    expect(polygons.some(({ points, alpha }) => points.length >= 3 && alpha === 0.42)).toBe(true);

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

    expect(polygons.some(({ style, points }) => style === VISUAL_COLORS.sky && points.length === 6)).toBe(true);
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
    expect(Math.max(...token.points.map(([x, y]) => Math.hypot(x - tokenX, y - tokenY)))).toBeGreaterThan(31);
  });

  it('keeps the falling bonus name and label backing legible in CSS pixels at 1280x720', () => {
    const { renderer, text, fills } = surface();
    renderer.resize(1280, 720, 1);
    renderer.render(snapshot({
      fallingBonuses: [{ id: 44, type: 'colorBreak', lane: 2, distance: 320, speed: 0 }],
    }), baseEffects(), presentation(), 1);
    const cssScale = (renderer.worldToScreen({ x: 100, y: 0 }).x - 640) / 100;
    const label = text.find(({ value }) => value === 'ЦВЕТОВОЙ ВЗРЫВ')!;
    const fontPx = Number(label.font.match(/([\d.]+)px/)?.[1]);
    expect(fontPx * cssScale).toBeGreaterThanOrEqual(11);
    const backing = fills.find(({ style, y }) => style === VISUAL_COLORS.background && y !== 0)!;
    expect(backing.height * cssScale).toBeGreaterThanOrEqual(17);
    expect(backing.width * cssScale).toBeGreaterThanOrEqual(label.value.length * 7);
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

  it('reveals PULSE rings at 0, 42, and 84 ms without duplicate contours', () => {
    const { renderer, strokes } = surface();
    const fx = new EffectsSystem({ random: () => 0.5 });
    fx.consume([{ type: 'bonusActivated', bonus: 'pulse' }]);
    const count = () => {
      strokes.length = 0;
      renderer.render(snapshot(), fx.snapshot(), presentation(), 0);
      return strokes.filter(({ style, points }) => style === VISUAL_COLORS.ink && points.length === 6).length;
    };
    expect(count()).toBe(1);
    fx.update(41); expect(count()).toBe(1);
    fx.update(1); expect(count()).toBe(2);
    fx.update(42); expect(count()).toBe(3);
  });

  it('draws a cool multi-ring wave for slow without creating fragments', () => {
    const { renderer, strokes } = surface();
    const fx = new EffectsSystem({ random: () => 0.5 });
    fx.consume([{ type: 'bonusActivated', bonus: 'slow' }]);
    fx.update(110);

    renderer.render(snapshot(), fx.snapshot(), presentation(), 0);

    expect(fx.snapshot().fragments).toEqual([]);
    expect(strokes.filter(({ points, style }) => points.length === 6 && style === VISUAL_COLORS.sky)).toHaveLength(1);
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

  it('locates a cleanse cut from the selected side even without fragments', () => {
    const { renderer, strokes } = surface();
    const base = baseEffects();
    renderer.render(snapshot(), {
      ...base,
      bonusImpact: { bonus: 'cleanse', removedCount: 1, ageMs: 110, lifetimeMs: 620,
        targetSide: 3, cutCells: [{ side: 3, index: 2 }], removedColors: ['teal'] },
    }, presentation(), 0);
    expect(strokes.some(({ style, points }) => style === VISUAL_COLORS.ink && points.length === 2
      && points[0]![1] > 0 && points[1]![1] > 0)).toBe(true);
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

  it('keeps the transfer at its origin through 90 ms and retires after 800 ms of flight', () => {
    const { renderer, text } = surface();
    const baseline = presentation();
    const drawAt = (ageMs: number) => {
      text.length = 0;
      renderer.render(snapshot(), baseEffects(), {
        ...baseline,
        transfer: { bonus: 'pulse', lane: 2, distance: 180, delayMs: 90, lifetimeMs: 800, ageMs },
      }, 0);
      return text.filter(({ value }) => value === '⌁');
    };
    expect(drawAt(89)).toHaveLength(1);
    expect(drawAt(89)[0]!.x).toBeCloseTo(Math.cos(Math.PI / 6) * 180);
    expect(drawAt(90)).toHaveLength(1);
    expect(drawAt(889)).toHaveLength(1);
    expect(drawAt(890)).toHaveLength(0);
  });

  it('shows the outgoing replacement glyph without delaying the incoming transfer', () => {
    const { renderer, text } = surface();
    renderer.render(snapshot(), baseEffects(), {
      ...presentation(), replacedBonus: 'slow', slotAttentionRemainingMs: 2_300,
      transfer: { bonus: 'pulse', lane: 2, distance: 180, ageMs: 200, delayMs: 90, lifetimeMs: 800 },
    }, 0);
    expect(text.map(({ value }) => value)).toContain('Ⅱ');
    expect(text.map(({ value }) => value)).toContain('⌁');
  });

  it('does not draw delayed shockwaves before their own delay', () => {
    const { renderer, strokes } = surface();
    const base = baseEffects();
    const delayed = (ageMs: number): EffectsSnapshot => ({
      ...base,
      shockwaves: [{ kind: 'collection', x: 0, y: -72, color: 'ivory', ageMs,
        delayMs: 90, lifetimeMs: 400, intensity: 1 }],
    });
    renderer.render(snapshot(), base, presentation(), 0);
    const baselineCount = strokes.filter(({ style }) => style === VISUAL_COLORS.ink).length;
    renderer.render(snapshot(), delayed(89), presentation(), 0);
    const before = strokes.filter(({ style }) => style === VISUAL_COLORS.ink).length;
    expect(before).toBe(baselineCount);
    renderer.render(snapshot(), delayed(90), presentation(), 0);
    expect(strokes.filter(({ style }) => style === VISUAL_COLORS.ink)).toHaveLength(before + 1);
  });

  it('draws local anticipation and landing response without altering effect time', () => {
    const { renderer, strokes, polygons } = surface();
    const fx = new EffectsSystem({ random: () => 0.5 });
    fx.consume([{ type: 'blockLanded', cell: { side: 0, index: 0 }, block: { id: 33, color: 'teal' } }]);
    const immutable = fx.snapshot();
    const before = JSON.stringify(immutable);
    renderer.render(snapshot(), immutable, presentation(), 0);
    expect(strokes.some(({ style, points }) => style === VISUAL_COLORS.ink && points.length >= 2)).toBe(true);
    expect(strokes.some(({ style }) => style === VISUAL_COLORS.coral)).toBe(false);
    expect(polygons.some(({ style, alpha }) => style === VISUAL_COLORS.teal && alpha > 0 && alpha < 1)).toBe(true);
    expect(JSON.stringify(immutable)).toBe(before);
  });

  it('keeps a reverse anomaly direction cue attached to its lane after the event cue expires', () => {
    const { renderer, strokes } = surface();
    const current = snapshot();
    renderer.render({ ...current, cycle: {
      ...current.cycle, warning: [], warningRemainingMs: 0,
      anomalies: [{ type: 'reverse', remainingMs: 3_000 }],
      threat: { pattern: 'pair', anchorLane: 2, lanes: [2], anomalies: ['reverse'], warningMs: 2_500,
        entryDelayMs: 0, bonusIncompatible: false,
        evidence: { seedCycle: 1, phase: 'build', budget: 1, spent: 1, combinationKey: 'reverse' } },
    } }, baseEffects(), presentation(), 0);
    expect(strokes.some(({ style, points }) => style === VISUAL_COLORS.amber && points.length >= 2)).toBe(true);
  });

  it('shows DRIFT affected lane without inventing a destination, then contours the real destination', () => {
    const { renderer, strokes } = surface();
    const fx = new EffectsSystem({ random: () => 0.5 });
    fx.consume([{ type: 'anomalyWarning', anomalies: ['drift'], lanes: [1],
      warningMs: 2_500, atActiveMs: 0 }]);
    const draw = () => {
      strokes.length = 0;
      renderer.render(snapshot(), fx.snapshot(), presentation(), 0);
      return strokes.filter(({ style, points }) => style === VISUAL_COLORS.amber && points.length === 6);
    };
    const warning = draw();
    expect(warning.some(stroke => Math.abs(Math.hypot(...center(stroke)) - 215) < 2)).toBe(true);
    expect(warning.some(stroke => Math.abs(Math.hypot(...center(stroke)) - 190) < 2)).toBe(false);
    fx.consume([{ type: 'blockSpawned', block: { id: 93, color: 'teal', lane: 1,
      distance: 520, speed: 0, driftToLane: 4 } }]);
    const active = draw();
    expect(active.some(stroke => {
      const [x, y] = center(stroke);
      return Math.abs(x - Math.cos(5 * Math.PI / 6) * 190) < 2
        && Math.abs(y - Math.sin(5 * Math.PI / 6) * 190) < 2;
    })).toBe(true);
    expect(strokes.some(({ style, points }) => style === VISUAL_COLORS.amber && points.length === 2
      && points[0]![0] * points[1]![0] < 0 && points[0]![1] * points[1]![1] < 0)).toBe(false);
  });

  it('joins a double anomaly into one side-attached rule', () => {
    const { renderer, strokes } = surface();
    const fx = new EffectsSystem({ random: () => 0.5 });
    fx.consume([{ type: 'anomalyWarning', anomalies: ['reverse', 'mirage'], lanes: [2],
      warningMs: 3_200, atActiveMs: 0 }]);
    const current = snapshot();
    renderer.render({ ...current, cycle: { ...current.cycle,
      warning: ['reverse', 'mirage'], warningRemainingMs: 3_200,
    } }, fx.snapshot(), presentation(), 0);
    expect(strokes.some(({ style, points }) => style === VISUAL_COLORS.amber
      && points.length === 2 && Math.hypot(points[0]![0] - points[1]![0], points[0]![1] - points[1]![1]) >= 50)).toBe(true);
  });

  it('keeps INERTIA on a known threat lane after rotationDelayed clears its cue lanes', () => {
    const { renderer, context } = surface();
    const fx = new EffectsSystem({ random: () => 0.5 });
    fx.consume([{ type: 'anomalyWarning', anomalies: ['mirage', 'inertia'], lanes: [3],
      warningMs: 3_200, atActiveMs: 0 }]);
    fx.consume([{ type: 'rotationDelayed', steps: 1, remainingMs: 300 }]);
    expect(fx.snapshot().anomalyCues.find(({ anomaly }) => anomaly === 'inertia')?.lanes).toEqual([]);
    const doubleThreat = snapshot();
    renderer.render({ ...doubleThreat, cycle: { ...doubleThreat.cycle,
      warning: ['mirage', 'inertia'], warningRemainingMs: 1_000,
    } }, fx.snapshot(), presentation(), 0);
    const inertiaArc = context.arc.mock.calls.find((call) => call[2] === 22)!;
    expect(inertiaArc[1]).toBeGreaterThan(0);
    context.arc.mockClear();
    renderer.render(snapshot(), fx.snapshot(), presentation(), 0);
    const unrelatedArc = context.arc.mock.calls.find((call) => call[2] === 22)!;
    expect(unrelatedArc[0]).toBeCloseTo(0);
    expect(unrelatedArc[1]).toBeCloseTo(0);
    context.arc.mockClear();
    const isolated = new EffectsSystem({ random: () => 0.5 });
    isolated.consume([{ type: 'rotationDelayed', steps: 1, remainingMs: 300 }]);
    const current = snapshot();
    renderer.render({ ...current, cycle: { ...current.cycle,
      anomalies: [{ type: 'inertia', remainingMs: 3_000 }],
      threat: { pattern: 'pair', anchorLane: 3, lanes: [3], anomalies: ['inertia'],
        warningMs: 2_500, entryDelayMs: 0, bonusIncompatible: false,
        evidence: { seedCycle: 1, phase: 'build', budget: 1, spent: 1, combinationKey: 'inertia' } },
    } }, isolated.snapshot(), presentation(), 0);
    const threatArc = context.arc.mock.calls.find((call) => call[2] === 22)!;
    expect(threatArc[1]).toBeGreaterThan(0);
    context.arc.mockClear();
    renderer.render(snapshot(), isolated.snapshot(), presentation(), 0);
    const unlocatedArc = context.arc.mock.calls.find((call) => call[2] === 22)!;
    expect(unlocatedArc[0]).toBeCloseTo(0);
    expect(unlocatedArc[1]).toBeCloseTo(0);
  });

  it('keeps reduced motion free of transforms and fragments while retaining a local contour', () => {
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

  it('gives Pressure denser restrained guides than Release', () => {
    const pressure = surface();
    const release = surface();
    const current = snapshot();
    pressure.renderer.render({ ...current, cycle: { ...current.cycle, phase: 'pressure' } },
      baseEffects(), presentation(), 0);
    release.renderer.render({ ...current, cycle: { ...current.cycle, phase: 'release' } },
      baseEffects(), presentation(), 0);
    const guides = (strokes: readonly RecordedStroke[]) => strokes.filter(({ style }) =>
      typeof style === 'string' && style.startsWith('rgba(141,145,140'));
    expect(guides(pressure.strokes).length).toBeGreaterThan(guides(release.strokes).length);
    expect(guides(pressure.strokes).every(({ style }) => Number((style as string).split(',').at(-1)!.replace(')', '')) <= 0.22)).toBe(true);
  });

  it('draws shockwaves in the shaken world but labels and flashes in stable screen space', () => {
    const { renderer, fills, text, strokes } = surface();
    const effects: EffectsSnapshot = {
      ...baseEffects(),
      shake: { magnitude: 8, remainingMs: 100 },
      shockwaves: [{ kind: 'clear', delayMs: 0, x: 10, y: 20, color: 'ivory', ageMs: 100, lifetimeMs: 500, intensity: 1 }],
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
