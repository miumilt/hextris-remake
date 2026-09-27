import {
  BLOCK_COLORS,
  BLOCK_DEPTH,
  FIXED_STEP_MS,
  HEX_APOTHEM,
  MAX_STACK_DEPTH,
  START_DISTANCE,
  SURGE_GUIDE_SCALE,
  VISUAL_COLORS,
} from '../game/constants';
import type { FallingBonus } from '../game/progressionTypes';
import type { BlockColor, FallingBlock, GameSnapshot } from '../game/types';
import { getBonusPresentation } from '../presentation/bonusPresentation';
import type { OpeningPresentation, OpeningStage, PresentationSnapshot } from '../presentation/PresentationSystem';
import type { AnomalyCue, EffectsSnapshot } from './EffectsSystem';
import { blockQuad, hexPoints, type Point } from './geometry';

const ORIGIN = { x: 0, y: 0 };
const TURN = Math.PI / 3;
const TURN_MS = 120;
const COLLAPSE_MS = 140;
// Keep in sync with enter-field's starting scale in styles.css.
const MENU_FIELD_SCALE = 0.82;
const WORLD_RADIUS = (START_DISTANCE + BLOCK_DEPTH + 32) / Math.cos(Math.PI / 6);
const ease = (t: number): number => {
  const bounded = Math.max(0, Math.min(1, t));
  return bounded * bounded * (3 - 2 * bounded);
};

interface PlateMotion { from: number; to: number; startedAt: number; }
export type RenderLayer = 'background' | 'guides' | 'field' | 'falling' | 'world-effects' | 'screen-effects';
export interface CanvasRendererOptions {
  readonly onLayer?: (layer: RenderLayer) => void;
  readonly onOpeningStage?: (stage: OpeningStage) => void;
}

/** Canvas owns visual time and transitions; snapshots are never changed. */
export class CanvasRenderer {
  private readonly ctx: CanvasRenderingContext2D;
  private width = 1;
  private height = 1;
  private dpr = 1;
  private scale = 1;
  private lastSnapshot: GameSnapshot | null = null;
  private lastPresentedSnapshot: GameSnapshot | null = null;
  private targetOrientation = 0;
  private fromOrientation = 0;
  private turnStartedAt = 0;
  private readonly plates = new Map<number, PlateMotion>();
  private readonly seenPlates = new Set<number>();
  private readonly grain = new Float32Array(1800);

  public constructor(private readonly canvas: HTMLCanvasElement, private readonly options: CanvasRendererOptions = {}) {
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas 2D is unavailable');
    this.ctx = context;
    let seed = 0x483358;
    for (let index = 0; index < this.grain.length; index += 1) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      this.grain[index] = seed / 4294967296;
    }
  }

  public resize(width: number, height: number, dpr: number): void {
    this.width = Math.max(1, Number.isFinite(width) ? width : 1);
    this.height = Math.max(1, Number.isFinite(height) ? height : 1);
    this.dpr = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
    this.scale = Math.min(this.width, this.height) / (WORLD_RADIUS * 2);
    this.canvas.width = Math.max(1, Math.round(this.width * this.dpr));
    this.canvas.height = Math.max(1, Math.round(this.height * this.dpr));
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  /** CSS pixels, unaffected by device pixels or transient camera shake. */
  public worldToScreen(point: Point): Point {
    return {
      x: this.width / 2 + this.finite(point.x) * this.scale,
      y: this.height / 2 + this.finite(point.y) * this.scale,
    };
  }

  public render(
    snapshot: GameSnapshot,
    effects: EffectsSnapshot,
    presentation: PresentationSnapshot,
    alpha: number,
  ): void {
    const fraction = Number.isFinite(alpha) ? Math.max(0, Math.min(1, alpha)) : 0;
    const previous = this.lastSnapshot;
    const reset = previous !== null && snapshot.elapsedMs < previous.elapsedMs;
    const modeChanged = previous !== null && snapshot.mode !== previous.mode;
    if (reset || modeChanged || snapshot.mode === 'menu') this.lastPresentedSnapshot = null;
    const heldSnapshot = this.lastPresentedSnapshot;
    const holding = !reset
      && !modeChanged
      && effects.hitStopRemainingMs > 0
      && snapshot.mode === 'playing'
      && heldSnapshot?.mode === 'playing';
    const presented = holding ? heldSnapshot : snapshot;
    const presentedFraction = holding ? 1 : fraction;
    const time = this.finite(presented.elapsedMs)
      + (presented.mode === 'playing' ? presentedFraction * FIXED_STEP_MS : 0);
    this.syncMotion(presented, time);
    if (!holding) this.lastPresentedSnapshot = presented.mode === 'playing' ? presented : null;
    const orientation = this.orientationAt(time);
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.globalAlpha = 1;
    this.layer('background', () => this.background());
    ctx.save();
    ctx.translate(this.width / 2, this.height / 2);
    ctx.scale(this.scale, this.scale);
    const shake = effects.shake.magnitude;
    ctx.translate(Math.sin(effects.shake.remainingMs * 0.31) * shake, Math.cos(effects.shake.remainingMs * 0.43) * shake * 0.6);
    // The menu has visual motion even while engine elapsed time is zero.
    this.layer('guides', () => {
      this.guides(presented, presented.mode === 'menu' ? performance.now() : time);
      this.openingGuides(presented, presentation.opening, effects.reducedMotion);
    });
    this.layer('field', () => {
      if (presented.mode === 'menu') {
        // A decorative arrangement, independent of the actual grid and spawning.
        ctx.save();
        ctx.scale(MENU_FIELD_SCALE, MENU_FIELD_SCALE);
        const angle = Math.sin(performance.now() / 11000) * 0.07;
        this.hex(angle);
        for (let side = 0; side < 6; side += 1) {
          const count = [2, 1, 3, 2, 1, 2][side]!;
          for (let depth = 0; depth < count; depth += 1) {
            this.plate(-Math.PI / 2 + side * TURN + angle, HEX_APOTHEM + depth * BLOCK_DEPTH, BLOCK_COLORS[(side + depth) % 4]!);
          }
        }
        ctx.restore();
      } else {
        this.openingHub(presentation.opening, effects.reducedMotion, () => this.hex(-orientation * TURN));
        for (let side = 0; side < presented.stacks.length; side += 1) {
          for (const block of presented.stacks[side]!) {
            const motion = this.plates.get(block.id)!;
            const distance = motion.from + (motion.to - motion.from) * ease((time - motion.startedAt) / COLLAPSE_MS);
            this.plate(-Math.PI / 2 + (side - orientation) * TURN, distance, block.color);
          }
        }
      }
    });
    this.layer('falling', () => {
      const slowActive = !effects.reducedMotion && (effects.slowTrailRemainingMs > 0 || presented.bonus.slowRemainingMs > 0);
      for (const block of presented.falling) {
        const distance = this.fallingDistance(block, presented.mode, presentedFraction);
        this.trail(block, distance, slowActive);
        const angle = this.fallingAngle(block);
        const assembly = effects.assemblies.find(({ blockId }) => blockId === block.id);
        if (assembly) this.assemblingPlate(angle, distance, block.color, assembly.ageMs / assembly.lifetimeMs);
        else if (block.mirageVisible) {
          ctx.save(); ctx.globalAlpha = 0.86;
          this.plate(angle, distance, block.color);
          ctx.restore();
        } else this.plate(angle, distance, block.color);
        if (
          block.shiftToColor !== undefined
          && block.shiftAtDistance !== undefined
          && distance > block.shiftAtDistance
        ) this.colorFacet(angle, distance, block.shiftToColor);
        if (block.mirageVisible && block.mirageLane !== undefined) {
          this.miragePlate(this.laneAngle(block.mirageLane), distance, block.color);
        }
      }
      for (const bonus of presented.fallingBonuses) this.bonusToken(bonus, presented.mode, presentedFraction, time);
    });
    this.layer('world-effects', () => {
      this.worldEffects(effects, presented);
      this.bonusTransfer(presentation, effects.reducedMotion);
      this.replacementGhost(presentation, effects.reducedMotion);
    });
    ctx.restore();
    this.layer('screen-effects', () => {
      this.openingReady(presentation.opening);
      this.screenEffects(effects);
    });
  }

  private layer(name: RenderLayer, draw: () => void): void {
    this.options.onLayer?.(name);
    draw();
  }

  private syncMotion(snapshot: GameSnapshot, time: number): void {
    const previous = this.lastSnapshot;
    const reset = !previous || snapshot.elapsedMs < previous.elapsedMs || (snapshot.mode === 'menu') !== (previous.mode === 'menu');
    if (reset) {
      this.targetOrientation = snapshot.orientation;
      this.fromOrientation = snapshot.orientation;
      this.turnStartedAt = time;
      this.plates.clear();
    } else if (snapshot.orientation !== previous.orientation) {
      this.fromOrientation = this.orientationAt(time);
      const delta = ((snapshot.orientation - previous.orientation + 9) % 6) - 3;
      this.targetOrientation += delta;
      this.turnStartedAt = time;
    }
    this.seenPlates.clear();
    for (const stack of snapshot.stacks) {
      stack.forEach((block, index) => {
        const distance = HEX_APOTHEM + index * BLOCK_DEPTH;
        const motion = this.plates.get(block.id);
        if (!motion) this.plates.set(block.id, { from: distance, to: distance, startedAt: time });
        else if (motion.to !== distance) {
          motion.from += (motion.to - motion.from) * ease((time - motion.startedAt) / COLLAPSE_MS);
          motion.to = distance;
          motion.startedAt = time;
        }
        this.seenPlates.add(block.id);
      });
    }
    for (const id of this.plates.keys()) if (!this.seenPlates.has(id)) this.plates.delete(id);
    this.lastSnapshot = snapshot;
  }

  private orientationAt(time: number): number {
    return this.fromOrientation + (this.targetOrientation - this.fromOrientation) * ease((time - this.turnStartedAt) / TURN_MS);
  }

  private background(): void {
    const ctx = this.ctx;
    ctx.fillStyle = VISUAL_COLORS.background;
    ctx.fillRect(0, 0, this.width, this.height);
    const lift = ctx.createRadialGradient(this.width / 2, this.height / 2, 0, this.width / 2, this.height / 2, Math.max(this.width, this.height) * 0.62);
    lift.addColorStop(0, VISUAL_COLORS.backgroundLift);
    lift.addColorStop(1, VISUAL_COLORS.background);
    ctx.fillStyle = lift;
    ctx.fillRect(0, 0, this.width, this.height);
    ctx.fillStyle = 'rgba(238,233,223,0.035)';
    for (let index = 0; index < this.grain.length; index += 2) {
      ctx.fillRect(this.grain[index]! * this.width, this.grain[index + 1]! * this.height, 1, 1);
    }
  }

  private guides(snapshot: GameSnapshot, time: number): void {
    const ctx = this.ctx;
    const phaseSpeed = snapshot.cycle.phase === 'pressure' ? 1.25
      : snapshot.cycle.phase === 'build' ? 1 : snapshot.cycle.phase === 'release' ? 0.55 : 0.75;
    const direction = snapshot.cycle.anomalies.some(({ type }) => type === 'reverse') ? -1 : 1;
    const frameInset = snapshot.cycle.phase === 'pressure' ? 8 : snapshot.cycle.phase === 'build' ? 3 : 0;
    ctx.lineWidth = 1 / this.scale;
    ctx.strokeStyle = 'rgba(141,145,140,0.075)';
    const safeRadius = (HEX_APOTHEM + MAX_STACK_DEPTH * BLOCK_DEPTH - frameInset) / Math.cos(Math.PI / 6);
    this.path(hexPoints(ORIGIN, safeRadius, -TURN)); ctx.stroke();
    ctx.save();
    if (snapshot.cycle.phase === 'pressure') ctx.scale(SURGE_GUIDE_SCALE, SURGE_GUIDE_SCALE);
    ctx.rotate(this.finite(time) * 0.000006 * phaseSpeed * direction);
    this.path(hexPoints(ORIGIN, 510, -TURN)); ctx.stroke();
    ctx.strokeStyle = 'rgba(141,145,140,0.045)';
    this.path(hexPoints(ORIGIN, 575, -TURN + 0.13)); ctx.stroke();
    ctx.restore();
    ctx.strokeStyle = `rgba(141,145,140,${Math.min(0.16, 0.1 * phaseSpeed)})`;
    const tickCount = snapshot.cycle.phase === 'pressure' ? 8
      : snapshot.cycle.phase === 'build' ? 6 : snapshot.cycle.phase === 'release' ? 3 : 5;
    for (let lane = 0; lane < tickCount; lane += 1) {
      const angle = -Math.PI / 2 + lane * Math.PI * 2 / tickCount;
      ctx.beginPath();
      ctx.moveTo(Math.cos(angle) * 415, Math.sin(angle) * 415);
      ctx.lineTo(Math.cos(angle) * 438, Math.sin(angle) * 438);
      ctx.stroke();
    }
  }

  private hex(rotation: number): void {
    const ctx = this.ctx;
    const radius = HEX_APOTHEM / Math.cos(Math.PI / 6);
    ctx.save();
    ctx.translate(0, 8);
    this.path(hexPoints(ORIGIN, radius + 2, rotation - TURN));
    ctx.fillStyle = 'rgba(0,0,0,0.34)'; ctx.fill();
    ctx.restore();
    const body = hexPoints(ORIGIN, radius, rotation - TURN);
    const gradient = ctx.createLinearGradient(0, -HEX_APOTHEM, 0, HEX_APOTHEM);
    gradient.addColorStop(0, VISUAL_COLORS.hexTop);
    gradient.addColorStop(1, VISUAL_COLORS.hexBottom);
    this.path(body); ctx.fillStyle = gradient; ctx.fill();
    ctx.strokeStyle = 'rgba(238,233,223,0.14)'; ctx.lineWidth = 1 / this.scale; ctx.stroke();
    this.path(hexPoints(ORIGIN, radius - 7, rotation - TURN));
    ctx.strokeStyle = 'rgba(0,0,0,0.18)'; ctx.stroke();
    // Tiny stamped center mark makes the solid hub feel manufactured.
    ctx.beginPath(); ctx.moveTo(-4, 0); ctx.lineTo(4, 0); ctx.moveTo(0, -4); ctx.lineTo(0, 4);
    ctx.strokeStyle = 'rgba(238,233,223,0.2)'; ctx.stroke();
  }

  private plate(angle: number, distance: number, color: BlockColor): void {
    const ctx = this.ctx;
    const points = blockQuad(ORIGIN, angle, distance + 2, BLOCK_DEPTH - 4);
    // Pull the corners inward along the tangent, leaving seams between sides.
    const tx = -Math.sin(angle); const ty = Math.cos(angle);
    for (let i = 0; i < points.length; i += 1) {
      const point = points[i]!;
      const inset = (i === 0 || i === 3) ? 2 : -2;
      points[i] = { x: point.x + tx * inset, y: point.y + ty * inset };
    }
    ctx.save();
    ctx.translate(0, 4);
    this.path(points); ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.shadowColor = 'rgba(0,0,0,0.20)'; ctx.shadowBlur = 3 * this.scale; ctx.fill();
    ctx.restore();
    let top = Infinity; let bottom = -Infinity;
    for (const point of points) { top = Math.min(top, point.y); bottom = Math.max(bottom, point.y); }
    const gradient = ctx.createLinearGradient(0, top, 0, bottom);
    gradient.addColorStop(0, VISUAL_COLORS[color]);
    gradient.addColorStop(1, this.shade(color));
    this.path(points); ctx.fillStyle = gradient; ctx.fill();
    ctx.beginPath(); ctx.moveTo(points[0]!.x, points[0]!.y); ctx.lineTo(points[1]!.x, points[1]!.y);
    ctx.strokeStyle = 'rgba(255,250,236,0.30)'; ctx.lineWidth = 1 / this.scale; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(points[2]!.x, points[2]!.y); ctx.lineTo(points[3]!.x, points[3]!.y);
    ctx.strokeStyle = 'rgba(0,0,0,0.30)'; ctx.lineWidth = 2 / this.scale; ctx.stroke();
  }

  private openingGuides(snapshot: GameSnapshot, opening: OpeningPresentation | null | undefined, reducedMotion: boolean): void {
    if (!opening || snapshot.opening.remainingMs <= 0 || snapshot.mode !== 'playing') return;
    this.options.onOpeningStage?.(opening.stage);
    if (opening.stage === 'assemble') return;
    const ctx = this.ctx;
    const progress = reducedMotion ? 1 : ease((opening.ageMs - 320) / 440);
    for (const lane of snapshot.opening.previewLanes) {
      const angle = this.laneAngle(lane);
      const outer = 345 + (1 - progress) * 75;
      ctx.save();
      ctx.globalAlpha = 0.36 + progress * 0.18;
      ctx.strokeStyle = VISUAL_COLORS.amber;
      ctx.lineWidth = 2.2 / this.scale;
      ctx.beginPath();
      ctx.moveTo(Math.cos(angle) * outer, Math.sin(angle) * outer);
      ctx.lineTo(Math.cos(angle) * 160, Math.sin(angle) * 160);
      ctx.stroke();
      ctx.globalAlpha = 0.27 + progress * 0.1;
      ctx.strokeStyle = VISUAL_COLORS.ink;
      ctx.lineWidth = 1 / this.scale;
      const railAngle = angle + 0.04;
      ctx.beginPath();
      ctx.moveTo(Math.cos(railAngle) * (outer - 18), Math.sin(railAngle) * (outer - 18));
      ctx.lineTo(Math.cos(railAngle) * 174, Math.sin(railAngle) * 174);
      ctx.stroke();
      const tip = { x: Math.cos(angle) * 160, y: Math.sin(angle) * 160 };
      ctx.globalAlpha = 0.72;
      ctx.fillStyle = VISUAL_COLORS.amber;
      this.path(hexPoints(tip, 4.5, angle));
      ctx.fill();
      ctx.restore();
    }
  }

  private openingHub(opening: OpeningPresentation | null | undefined, reducedMotion: boolean, draw: () => void): void {
    if (!opening || opening.stage !== 'assemble') { draw(); return; }
    const ctx = this.ctx;
    const progress = ease(opening.ageMs / (reducedMotion ? 140 : 320));
    const scale = reducedMotion ? 1 : progress < 0.75
      ? 0.96 + (118 / (HEX_APOTHEM / Math.cos(Math.PI / 6)) - 0.96) * (1 - progress / 0.75)
      : 0.96 + 0.04 * ease((progress - 0.75) / 0.25);
    ctx.save();
    ctx.globalAlpha = reducedMotion ? Math.min(1, opening.ageMs / 140) : 1;
    ctx.scale(scale, scale);
    draw();
    const vertices = hexPoints(ORIGIN, HEX_APOTHEM / Math.cos(Math.PI / 6), -TURN);
    for (let facet = 0; facet < 6; facet += 1) {
      const first = vertices[facet]!;
      const next = vertices[(facet + 1) % 6]!;
      ctx.save();
      ctx.translate((first.x + next.x) * 0.5 * (1 - progress) * 0.3,
        (first.y + next.y) * 0.5 * (1 - progress) * 0.3);
      ctx.globalAlpha = (reducedMotion ? Math.min(1, opening.ageMs / 140) : 1) * (1 - progress) * 0.9;
      ctx.fillStyle = facet % 2 === 0 ? VISUAL_COLORS.hexTop : VISUAL_COLORS.hexBottom;
      this.path([ORIGIN, first, next]);
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }

  private openingReady(opening: OpeningPresentation | null | undefined): void {
    if (!opening || opening.stage !== 'ready') return;
    const remaining = Math.min(1, (1200 - opening.ageMs) / 240);
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = Math.max(0, remaining * 0.85);
    ctx.fillStyle = VISUAL_COLORS.ink;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '700 28px Arial, sans-serif';
    ctx.strokeStyle = VISUAL_COLORS.amber;
    ctx.lineWidth = 1.5;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(this.width / 2 + side * 52, this.height / 2 + 23);
      ctx.lineTo(this.width / 2 + side * 20, this.height / 2 + 23);
      ctx.stroke();
    }
    ctx.fillText('ГОТОВ', this.width / 2, this.height / 2);
    ctx.restore();
  }

  private assemblingPlate(angle: number, distance: number, color: BlockColor, rawProgress: number): void {
    const ctx = this.ctx;
    const progress = ease(rawProgress);
    const scale = 0.72 + progress * 0.28;
    const points = blockQuad(ORIGIN, angle, distance + 2, BLOCK_DEPTH - 4);
    const center = points.reduce(
      (sum, point) => ({ x: sum.x + point.x / points.length, y: sum.y + point.y / points.length }),
      { x: 0, y: 0 },
    );
    const splitNear = this.midpoint(points[0]!, points[1]!);
    const splitFar = this.midpoint(points[3]!, points[2]!);
    const spread = (1 - progress) * 10;
    const tangent = { x: -Math.sin(angle), y: Math.cos(angle) };

    ctx.save();
    ctx.translate(center.x, center.y);
    ctx.scale(scale, scale);
    ctx.translate(-center.x, -center.y);
    ctx.globalAlpha = 0.18 + progress * 0.82;
    this.path([
      { x: points[0]!.x - tangent.x * spread, y: points[0]!.y - tangent.y * spread },
      { x: points[3]!.x - tangent.x * spread, y: points[3]!.y - tangent.y * spread },
      { x: splitFar.x, y: splitFar.y },
      { x: splitNear.x, y: splitNear.y },
    ]);
    ctx.fillStyle = this.shade(color); ctx.fill();
    this.path([
      { x: points[1]!.x + tangent.x * spread, y: points[1]!.y + tangent.y * spread },
      { x: points[2]!.x + tangent.x * spread, y: points[2]!.y + tangent.y * spread },
      splitFar,
    ]);
    ctx.fillStyle = VISUAL_COLORS[color]; ctx.fill();
    this.path([points[1]!, splitNear, splitFar]);
    ctx.fillStyle = VISUAL_COLORS[color]; ctx.fill();
    ctx.restore();

    const guideFrom = START_DISTANCE + 26;
    ctx.save();
    ctx.globalAlpha = (1 - progress) * 0.38;
    ctx.beginPath();
    ctx.moveTo(Math.cos(angle) * guideFrom, Math.sin(angle) * guideFrom);
    ctx.lineTo(center.x, center.y);
    ctx.strokeStyle = VISUAL_COLORS[color];
    ctx.lineWidth = 1 / this.scale;
    ctx.stroke();
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  private shade(color: BlockColor): string {
    return { coral: '#B9574D', amber: '#B88A38', teal: '#478277', sky: '#56829C' }[color];
  }

  private trail(block: FallingBlock, distance: number, stretched = false): void {
    const ctx = this.ctx;
    ctx.save();
    const trailSteps = stretched ? 5 : 3;
    const spacing = stretched ? 19 : 14;
    for (let step = trailSteps; step >= 1; step -= 1) {
      ctx.globalAlpha = 0.018 * (trailSteps + 1 - step);
      const driftProgress = Math.max(0, (block.driftProgress ?? 0) - step * 0.08);
      const angle = this.fallingAngle({ ...block, driftProgress });
      this.path(blockQuad(ORIGIN, angle, distance + step * spacing, 10));
      ctx.fillStyle = VISUAL_COLORS[block.color]; ctx.fill();
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  private fallingDistance(block: FallingBlock, mode: GameSnapshot['mode'], fraction: number): number {
    const distance = this.finite(block.distance, START_DISTANCE);
    const speed = this.finite(block.speed);
    return distance + (mode === 'playing' ? speed * (1 - fraction) * FIXED_STEP_MS / 1000 : 0);
  }

  private fallingAngle(block: FallingBlock): number {
    const fromLane = this.finite(block.lane);
    if (block.driftToLane === undefined) return this.laneAngle(fromLane);
    const toLane = this.finite(block.driftToLane, fromLane);
    const laneDelta = ((toLane - fromLane + 9) % 6) - 3;
    const progress = ease(this.finite(block.driftProgress));
    return this.laneAngle(fromLane) + laneDelta * TURN * progress;
  }

  private laneAngle(lane: number): number {
    return -Math.PI / 2 + this.finite(lane) * TURN;
  }

  private miragePlate(angle: number, distance: number, color: BlockColor): void {
    const ctx = this.ctx;
    const points = blockQuad(ORIGIN, angle, distance + 2, BLOCK_DEPTH - 4);
    const middleNear = this.midpoint(points[0]!, points[1]!);
    const middleFar = this.midpoint(points[3]!, points[2]!);
    ctx.save();
    ctx.fillStyle = VISUAL_COLORS[color];
    ctx.globalAlpha = 0.42;
    this.path([points[0]!, middleNear, middleFar, points[3]!]); ctx.fill();
    ctx.globalAlpha = 0.42;
    this.path([middleNear, points[1]!, points[2]!, middleFar]); ctx.fill();
    ctx.setLineDash([5, 7]);
    ctx.strokeStyle = VISUAL_COLORS[color];
    ctx.lineWidth = 1 / this.scale;
    ctx.beginPath();
    ctx.moveTo(Math.cos(angle) * (distance + 70), Math.sin(angle) * (distance + 70));
    ctx.lineTo(Math.cos(angle) * (distance + 12), Math.sin(angle) * (distance + 12));
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  private colorFacet(angle: number, distance: number, color: BlockColor): void {
    const ctx = this.ctx;
    const points = blockQuad(ORIGIN, angle, distance + 2, BLOCK_DEPTH - 4);
    const center = points.reduce((point, vertex) => ({ x: point.x + vertex.x / 4, y: point.y + vertex.y / 4 }), { x: 0, y: 0 });
    ctx.save();
    ctx.globalAlpha = 0.86;
    this.path(hexPoints(center, BLOCK_DEPTH * 0.35, angle + Math.PI / 6));
    ctx.fillStyle = VISUAL_COLORS[color];
    ctx.fill();
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  private bonusToken(bonus: FallingBonus, mode: GameSnapshot['mode'], fraction: number, time: number): void {
    const ctx = this.ctx;
    const presentation = getBonusPresentation(bonus.type);
    const distance = this.finite(bonus.distance, START_DISTANCE)
      + (mode === 'playing' ? this.finite(bonus.speed) * (1 - fraction) * FIXED_STEP_MS / 1000 : 0);
    const angle = this.laneAngle(bonus.lane);
    const point = { x: Math.cos(angle) * distance, y: Math.sin(angle) * distance };
    const rotation = angle + Math.PI / 6;
    ctx.save();
    this.path(hexPoints({ x: point.x, y: point.y + 4 }, 35, rotation));
    ctx.fillStyle = 'rgba(0,0,0,0.34)'; ctx.fill();
    this.path(hexPoints(point, 32.4, rotation));
    ctx.fillStyle = this.bonusTone(presentation.tone); ctx.fill();
    ctx.globalAlpha = 0.34;
    this.path(hexPoints(point, 39, rotation + this.finite(time) * 0.00013));
    ctx.strokeStyle = this.bonusTone(presentation.tone);
    ctx.lineWidth = 1 / this.scale;
    ctx.stroke();
    ctx.globalAlpha = 1;
    this.path(hexPoints(point, 20, rotation));
    ctx.fillStyle = VISUAL_COLORS.ink; ctx.fill();
    this.path(hexPoints(point, 13, rotation));
    ctx.fillStyle = VISUAL_COLORS.background; ctx.fill();
    ctx.fillStyle = VISUAL_COLORS.ink;
    ctx.font = '800 17px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(presentation.glyph, point.x, point.y + 0.5);

    const labelPoint = {
      x: point.x - Math.cos(angle) * 66,
      y: point.y - Math.sin(angle) * 66,
    };
    const cssToWorld = 1 / this.scale;
    const labelWidth = Math.max(78, presentation.label.length * 7.4) * cssToWorld;
    const labelHeight = 20 * cssToWorld;
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = VISUAL_COLORS.background;
    ctx.fillRect(labelPoint.x - labelWidth / 2, labelPoint.y - labelHeight / 2, labelWidth, labelHeight);
    ctx.globalAlpha = 1;
    ctx.fillStyle = this.bonusTone(presentation.tone);
    ctx.font = `800 ${12 * cssToWorld}px Arial, sans-serif`;
    ctx.fillText(presentation.label, labelPoint.x, labelPoint.y + 0.5);
    ctx.restore();
  }

  private bonusTransfer(presentation: PresentationSnapshot, reducedMotion: boolean): void {
    const transfer = presentation.transfer;
    if (transfer === null || transfer.ageMs >= transfer.delayMs + transfer.lifetimeMs) return;
    const ctx = this.ctx;
    const progress = ease((transfer.ageMs - transfer.delayMs) / transfer.lifetimeMs);
    const angle = this.laneAngle(transfer.lane);
    const start = {
      x: Math.cos(angle) * transfer.distance,
      y: Math.sin(angle) * transfer.distance,
    };
    const end = {
      x: (this.width - 144 - this.width / 2) / this.scale,
      y: (this.height - 66 - this.height / 2) / this.scale,
    };
    const middle = {
      x: (start.x + end.x) / 2 - 54,
      y: Math.min(start.y, end.y) - 92,
    };
    const overshoot = progress > 0.8 ? Math.sin(Math.PI * (progress - 0.8) / 0.2) * 0.06 : 0;
    const motionProgress = reducedMotion ? 1 : Math.max(0, progress + overshoot);
    const inverse = 1 - motionProgress;
    const point = {
      x: inverse * inverse * start.x + 2 * inverse * motionProgress * middle.x + motionProgress * motionProgress * end.x,
      y: inverse * inverse * start.y + 2 * inverse * motionProgress * middle.y + motionProgress * motionProgress * end.y,
    };
    const finalAge = transfer.delayMs + transfer.lifetimeMs;
    const fadeOut = transfer.ageMs > finalAge - 120 ? (finalAge - transfer.ageMs) / 120 : 1;
    const fadeIn = reducedMotion ? Math.min(1, Math.max(0, (transfer.ageMs - transfer.delayMs) / 140)) : 1;
    const bonus = getBonusPresentation(transfer.bonus);
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, fadeIn * fadeOut));
    this.path(hexPoints(point, 14 - motionProgress * 2, angle + motionProgress * TURN));
    ctx.fillStyle = VISUAL_COLORS.ink; ctx.fill();
    ctx.fillStyle = VISUAL_COLORS.background;
    ctx.font = '700 11px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(bonus.glyph, point.x, point.y + 0.5);
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  private replacementGhost(presentation: PresentationSnapshot, reducedMotion: boolean): void {
    if (presentation.replacedBonus === null) return;
    const progress = Math.max(0, Math.min(1, (2500 - presentation.slotAttentionRemainingMs) / 800));
    const point = {
      x: (this.width - 144 - this.width / 2) / this.scale + (reducedMotion ? 0 : progress * 44),
      y: (this.height - 66 - this.height / 2) / this.scale - (reducedMotion ? 0 : progress * 32),
    };
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = 0.72 * (1 - progress);
    ctx.translate(point.x, point.y);
    if (!reducedMotion) ctx.rotate(progress * 0.42);
    ctx.fillStyle = this.bonusTone(getBonusPresentation(presentation.replacedBonus).tone);
    ctx.font = '700 13px Arial, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(getBonusPresentation(presentation.replacedBonus).glyph, 0, 0);
    ctx.restore();
  }

  private bonusTone(tone: string): string {
    return tone === 'ivory' ? VISUAL_COLORS.ink
      : Object.prototype.hasOwnProperty.call(VISUAL_COLORS, tone)
        ? VISUAL_COLORS[tone as keyof typeof VISUAL_COLORS]
        : VISUAL_COLORS.ink;
  }

  private bonusImpact(effects: EffectsSnapshot, orientation: number): void {
    const impact = effects.bonusImpact;
    if (impact === null) return;
    if ((impact.bonus === 'pulse' || impact.bonus === 'slow')
      && effects.shockwaves.some(({ kind }) => kind === impact.bonus)) return;
    const ctx = this.ctx;
    const rawProgress = this.finite(impact.ageMs) / Math.max(1, this.finite(impact.lifetimeMs, 1));
    const progress = ease(rawProgress);
    const life = Math.max(0, 1 - rawProgress);

    if (effects.reducedMotion) {
      if (effects.shockwaves.length > 0) return;
      ctx.save();
      ctx.globalAlpha = life * 0.28;
      ctx.strokeStyle = VISUAL_COLORS.ink;
      ctx.lineWidth = 1.5 / this.scale;
      this.path(hexPoints(ORIGIN, HEX_APOTHEM + 16, -TURN));
      ctx.stroke();
      ctx.restore();
      ctx.globalAlpha = 1;
      return;
    }

    // Activation remains legible even when a removal bonus finds no targets,
    // without drawing fragments or implying that a plate was destroyed.
    if (impact.removedCount === 0 && impact.bonus !== 'slow') {
      ctx.save();
      ctx.globalAlpha = life * 0.32;
      ctx.strokeStyle = VISUAL_COLORS.ink;
      ctx.lineWidth = (1 + life * 1.5) / this.scale;
      this.path(hexPoints(ORIGIN, HEX_APOTHEM + 12 + progress * 30, -TURN));
      ctx.stroke();
      ctx.restore();
      ctx.globalAlpha = 1;
      return;
    }

    if (impact.bonus === 'slow') {
      for (let ring = 0; ring < 3; ring += 1) {
        const phase = Math.max(0, Math.min(1, progress * 1.2 + ring * 0.09));
        ctx.save();
        ctx.globalAlpha = Math.max(0, (1 - phase) * (0.34 - ring * 0.055));
        ctx.strokeStyle = VISUAL_COLORS.sky;
        ctx.lineWidth = (2.5 - ring * 0.45) / this.scale;
        this.path(hexPoints(ORIGIN, HEX_APOTHEM + 22 + phase * 178 + ring * 14, -TURN));
        ctx.stroke();
        ctx.restore();
      }
      ctx.globalAlpha = 1;
      return;
    }

    if (impact.bonus === 'pulse') {
      for (let ring = 0; ring < 3; ring += 1) {
        const phase = Math.max(0, Math.min(1, progress * 1.28 + ring * 0.11));
        ctx.save();
        ctx.globalAlpha = Math.max(0, (1 - phase) * (0.68 - ring * 0.1));
        ctx.strokeStyle = VISUAL_COLORS.ink;
        ctx.lineWidth = (3.6 - ring * 0.7) / this.scale;
        this.path(hexPoints(ORIGIN, HEX_APOTHEM + 10 + phase * 210 + ring * 18, -TURN));
        ctx.stroke();
        ctx.restore();
      }
      ctx.globalAlpha = 1;
      return;
    }

    if (impact.bonus === 'cleanse') {
      const fragments = effects.fragments;
      const direction = impact.targetSide !== null
        ? this.laneAngle(impact.targetSide - orientation)
        : fragments.length === 0 ? -Math.PI / 2 : Math.atan2(
          fragments.reduce((sum, fragment) => sum + fragment.y, 0),
          fragments.reduce((sum, fragment) => sum + fragment.x, 0),
        );
      const furthestCell = impact.cutCells.reduce((max, cell) => Math.max(max, cell.index), -1);
      const outerDistance = fragments.reduce(
        (furthest, fragment) => Math.max(furthest, Math.hypot(fragment.x, fragment.y)),
        HEX_APOTHEM + BLOCK_DEPTH * Math.max(3, furthestCell + 1),
      );
      const distance = outerDistance - progress * Math.max(0, outerDistance - HEX_APOTHEM + 6);
      const center = { x: Math.cos(direction) * distance, y: Math.sin(direction) * distance };
      const tangent = { x: -Math.sin(direction), y: Math.cos(direction) };
      const halfWidth = 22 + life * 13;
      ctx.save();
      ctx.globalAlpha = Math.min(1, life * 1.45);
      ctx.beginPath();
      ctx.moveTo(center.x - tangent.x * halfWidth, center.y - tangent.y * halfWidth);
      ctx.lineTo(center.x + tangent.x * halfWidth, center.y + tangent.y * halfWidth);
      ctx.strokeStyle = VISUAL_COLORS.ink;
      ctx.lineWidth = (2 + life * 2.5) / this.scale;
      ctx.stroke();
      ctx.restore();
      ctx.globalAlpha = 1;
      return;
    }

    // COLOR BREAK: all source plates receive the same brief tone flash before
    // their individually delayed fragment release begins.
    if (impact.ageMs <= 70) {
      const sources = new Map<string, { x: number; y: number; color: BlockColor }>();
      for (const fragment of effects.fragments) {
        const key = `${fragment.x.toFixed(3)},${fragment.y.toFixed(3)},${fragment.color}`;
        if (!sources.has(key)) sources.set(key, { x: fragment.x, y: fragment.y, color: fragment.color });
      }
      const flash = 0.24 + Math.sin(Math.min(1, impact.ageMs / 70) * Math.PI) * 0.46;
      for (const source of sources.values()) {
        const angle = Math.atan2(source.y, source.x);
        const distance = Math.hypot(source.x, source.y);
        ctx.save();
        ctx.globalAlpha = flash;
        this.path(blockQuad(ORIGIN, angle, distance + 2, BLOCK_DEPTH - 4));
        ctx.fillStyle = VISUAL_COLORS[source.color];
        ctx.fill();
        ctx.restore();
      }
      ctx.globalAlpha = 1;
    }
  }

  private worldEffects(effects: EffectsSnapshot, snapshot: GameSnapshot): void {
    const ctx = this.ctx;
    this.localEffects(effects);
    this.anomalyEvidence(effects, snapshot);
    this.bonusImpact(effects, snapshot.orientation);
    for (const shockwave of effects.shockwaves) {
      if (shockwave.ageMs < shockwave.delayMs) continue;
      const progress = ease(this.finite(shockwave.ageMs - shockwave.delayMs) / Math.max(1, this.finite(shockwave.lifetimeMs, 1)));
      const life = Math.max(0, 1 - progress);
      const center = { x: this.finite(shockwave.x), y: this.finite(shockwave.y) };
      const radius = 18 + progress * (90 + this.finite(shockwave.intensity) * 80);
      ctx.save();
      ctx.globalAlpha = life * Math.min(1, Math.max(0, shockwave.intensity));
      ctx.strokeStyle = shockwave.kind === 'slow' ? VISUAL_COLORS.sky
        : shockwave.color === 'ivory' ? VISUAL_COLORS.ink : VISUAL_COLORS[shockwave.color];
      ctx.lineWidth = (1.5 + life * 3) / this.scale;
      this.path(hexPoints(center, radius, -TURN)); ctx.stroke();
      ctx.restore();
      ctx.globalAlpha = 1;
    }
    for (const flash of effects.flashes) {
      const life = Math.max(0, 1 - flash.ageMs / flash.lifetimeMs);
      ctx.save(); ctx.globalAlpha = life * 0.7;
      const angle = Math.atan2(flash.y, flash.x);
      const distance = Math.hypot(flash.x, flash.y);
      this.path(blockQuad(ORIGIN, angle, distance + 2, 3 + life * 8));
      ctx.fillStyle = VISUAL_COLORS.ink; ctx.fill(); ctx.restore();
    }
    for (const particle of effects.particles) {
      if (particle.ageMs < particle.burstDelayMs) continue;
      const life = Math.max(0, 1 - (particle.ageMs - particle.burstDelayMs)
        / Math.max(1, particle.lifetimeMs - particle.burstDelayMs));
      ctx.save();
      ctx.globalAlpha = life;
      ctx.fillStyle = VISUAL_COLORS[particle.color];
      const x = this.finite(particle.x); const y = this.finite(particle.y);
      this.path(hexPoints({ x, y }, 2 + life * 3, particle.rotation));
      ctx.fill();
      ctx.restore();
    }
    const contracting = new Set<string>();
    const releasing = new Set<string>();
    for (const fragment of effects.fragments) {
      if (fragment.ageMs < fragment.anticipationMs) {
        // Fragments share each cleared plate's origin during anticipation.
        // Draw its contracting silhouette once, without retaining game-state ghosts.
        const key = `${fragment.originX.toFixed(3)},${fragment.originY.toFixed(3)},${fragment.color},${fragment.anticipationMs}`;
        if (!contracting.has(key)) {
          contracting.add(key);
          const progress = fragment.ageMs / fragment.anticipationMs;
          const scale = 1 - ease(progress) * 0.28;
          const angle = Math.atan2(fragment.originY, fragment.originX);
          const distance = Math.hypot(fragment.originX, fragment.originY);
          ctx.save();
          ctx.globalAlpha = 1 - progress * 0.42;
          ctx.translate(fragment.originX, fragment.originY);
          ctx.scale(scale, scale);
          ctx.translate(-fragment.originX, -fragment.originY);
          this.plate(angle, distance, fragment.color);
          ctx.beginPath();
          const seamAngle = angle + Math.PI * 0.62;
          ctx.moveTo(fragment.originX - Math.cos(seamAngle) * 11, fragment.originY - Math.sin(seamAngle) * 11);
          ctx.lineTo(fragment.originX + Math.cos(seamAngle) * 11, fragment.originY + Math.sin(seamAngle) * 11);
          ctx.strokeStyle = 'rgba(23,25,24,0.72)';
          ctx.lineWidth = 1.5 / this.scale;
          ctx.stroke();
          ctx.restore();
        }
        continue;
      }
      const releasedAge = fragment.ageMs - fragment.anticipationMs;
      const originKey = `${fragment.originX.toFixed(3)},${fragment.originY.toFixed(3)},${fragment.color},${fragment.anticipationMs}`;
      if (releasedAge < 180 && !releasing.has(originKey)) {
        releasing.add(originKey);
        const releaseProgress = ease(releasedAge / 180);
        const sourceAngle = Math.atan2(fragment.originY, fragment.originX);
        const sourceDistance = Math.hypot(fragment.originX, fragment.originY);
        ctx.save();
        ctx.globalAlpha = (1 - releaseProgress) * 0.72;
        ctx.translate(fragment.originX, fragment.originY);
        const sourceScale = 0.72 - releaseProgress * 0.16;
        ctx.scale(sourceScale, sourceScale);
        ctx.translate(-fragment.originX, -fragment.originY);
        this.plate(sourceAngle, sourceDistance, fragment.color);
        ctx.restore();
      }
      const releasedLife = Math.max(1, fragment.lifetimeMs - fragment.anticipationMs);
      const life = Math.max(0, 1 - releasedAge / releasedLife);
      const sides = 3 + (Math.round(fragment.size) % 3);
      const points = Array.from({ length: sides }, (_, index) => {
        const angle = -Math.PI / 2 + index * Math.PI * 2 / sides;
        const radius = fragment.size * (index % 2 === 0 ? 1 : 0.72);
        return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
      });
      ctx.save(); ctx.translate(fragment.x, fragment.y); ctx.rotate(fragment.rotation);
      ctx.globalAlpha = life;
      this.path(points);
      ctx.fillStyle = VISUAL_COLORS[fragment.color]; ctx.fill();
      ctx.beginPath();
      ctx.moveTo(points[0]!.x, points[0]!.y);
      ctx.lineTo(points[1]!.x, points[1]!.y);
      ctx.strokeStyle = 'rgba(255,250,236,0.38)';
      ctx.lineWidth = 1 / this.scale; ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(points.at(-1)!.x, points.at(-1)!.y);
      ctx.lineTo(points[0]!.x, points[0]!.y);
      ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.stroke();
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  private localEffects(effects: EffectsSnapshot): void {
    const ctx = this.ctx;
    for (const cue of effects.anticipations) {
      const life = Math.max(0, 1 - this.finite(cue.ageMs) / Math.max(1, this.finite(cue.lifetimeMs, 1)));
      ctx.save();
      ctx.globalAlpha = life * (cue.kind === 'clear' ? 0.55 : 0.38);
      ctx.strokeStyle = VISUAL_COLORS.ink;
      ctx.lineWidth = 1 / this.scale;
      this.path(hexPoints({ x: cue.x, y: cue.y }, 18 + (1 - life) * 10, -TURN));
      ctx.stroke();
      ctx.restore();
    }
    for (const landing of effects.landings) {
      const life = Math.max(0, 1 - this.finite(landing.ageMs) / landing.lifetimeMs);
      const angle = Math.atan2(landing.y, landing.x);
      ctx.save();
      ctx.globalAlpha = life * 0.48;
      ctx.fillStyle = VISUAL_COLORS[landing.color];
      ctx.translate(landing.x, landing.y);
      ctx.scale(1 + (1 - life) * 0.08, 1 - (1 - life) * 0.16);
      ctx.translate(-landing.x, -landing.y);
      this.path(blockQuad(ORIGIN, angle, Math.hypot(landing.x, landing.y) + 2, BLOCK_DEPTH - 4));
      ctx.fill();
      ctx.restore();
    }
  }

  private anomalyEvidence(effects: EffectsSnapshot, snapshot: GameSnapshot): void {
    const live = new Map(effects.anomalyCues.map((cue) => [cue.anomaly, cue] as const));
    const active = new Set(snapshot.cycle.anomalies.map(({ type }) => type));
    const warning = new Set(snapshot.cycle.warning);
    for (const type of [...active, ...warning]) {
      if (live.has(type)) continue;
      live.set(type, { anomaly: type, lanes: [],
        ageMs: 0, lifetimeMs: 1, warning: warning.has(type), direction: type === 'reverse' ? -1 : null,
        destinationLane: null, futureColor: null, remainingImpulseMs: 0 });
    }
    const isSharedThreat = (first: AnomalyCue['anomaly'], second: AnomalyCue['anomaly']): boolean =>
      (warning.has(first) && warning.has(second)) || (active.has(first) && active.has(second));
    const cues = [...live.values()];
    const shared = cues.length >= 2 && isSharedThreat(cues[0]!.anomaly, cues[1]!.anomaly);
    const sharedLane = cues[0]?.lanes[0];
    const pairedSide = shared && sharedLane !== undefined && cues[1]!.lanes[0] === sharedLane;
    const pairedHub = shared && cues[0]!.lanes.length === 0 && cues[1]!.lanes.length === 0;
    if (pairedSide || pairedHub) {
      const angle = pairedSide ? this.laneAngle(sharedLane) : 0;
      const tangent = pairedHub ? { x: 1, y: 0 } : { x: -Math.sin(angle), y: Math.cos(angle) };
      const center = pairedSide ? { x: Math.cos(angle) * 215, y: Math.sin(angle) * 215 } : ORIGIN;
      const ctx = this.ctx;
      ctx.save();
      ctx.globalAlpha = 0.45;
      ctx.strokeStyle = VISUAL_COLORS.amber;
      ctx.lineWidth = 1 / this.scale;
      ctx.beginPath();
      ctx.moveTo(center.x - tangent.x * 30, center.y - tangent.y * 30);
      ctx.lineTo(center.x + tangent.x * 30, center.y + tangent.y * 30);
      ctx.stroke();
      ctx.restore();
    }
    cues.forEach((cue, index) => this.anomalyCue(cue,
      (pairedSide || pairedHub) && index < 2 ? (index === 0 ? -1 : 1) : 0,
      pairedSide && index < 2));
  }

  private anomalyCue(cue: AnomalyCue, offset: number, sideAttached: boolean): void {
    const ctx = this.ctx;
    const lane = cue.lanes[0] ?? null;
    const angle = lane === null ? 0 : this.laneAngle(lane);
    const tangent = { x: -Math.sin(angle), y: Math.cos(angle) };
    const radius = cue.anomaly === 'inertia' && !sideAttached ? HEX_APOTHEM + 22 : 215;
    const point = lane === null ? { x: offset * 30, y: 0 } : { x: Math.cos(angle) * radius + tangent.x * offset * 30,
      y: Math.sin(angle) * radius + tangent.y * offset * 30 };
    ctx.save();
    ctx.globalAlpha = cue.warning ? 0.72 : 0.58;
    ctx.strokeStyle = VISUAL_COLORS.amber;
    ctx.lineWidth = 1.5 / this.scale;
    if (cue.anomaly === 'reverse' || cue.anomaly === 'inertia') {
      const direction = cue.direction ?? -1;
      const start = angle - direction * 0.7;
      const finish = angle + direction * 0.7;
      ctx.beginPath();
      ctx.arc(point.x, point.y, cue.anomaly === 'inertia' ? 22 : 18, start, finish, direction < 0);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(point.x + Math.cos(finish) * 22, point.y + Math.sin(finish) * 22);
      ctx.lineTo(point.x + Math.cos(finish - direction * 0.28) * 16,
        point.y + Math.sin(finish - direction * 0.28) * 16);
      ctx.stroke();
      if (cue.anomaly === 'inertia' && cue.remainingImpulseMs > 0) {
        ctx.globalAlpha *= Math.min(1, cue.remainingImpulseMs / 300);
        this.path(hexPoints(ORIGIN, HEX_APOTHEM + 18, -TURN));
        ctx.stroke();
      }
    } else if (cue.anomaly === 'drift') {
      if (cue.destinationLane === null) {
        // Anomaly warnings stay global until an affected block reveals its route.
        this.path(hexPoints(point, 16, -TURN));
        ctx.stroke();
      } else {
        const destinationAngle = this.laneAngle(cue.destinationLane);
        const destinationPoint = { x: Math.cos(destinationAngle) * 190, y: Math.sin(destinationAngle) * 190 };
        this.path(hexPoints(destinationPoint, 16, -TURN));
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(Math.cos(destinationAngle) * 214, Math.sin(destinationAngle) * 214);
        ctx.lineTo(Math.cos(destinationAngle) * 203, Math.sin(destinationAngle) * 203);
        ctx.stroke();
      }
    } else if (cue.anomaly === 'mirage') {
      ctx.setLineDash([6, 5]);
      this.path(hexPoints(point, 18, -TURN)); ctx.stroke();
      ctx.setLineDash([]);
    } else {
      this.path(hexPoints(point, 17, -TURN)); ctx.stroke();
      if (cue.futureColor !== null) {
        ctx.globalAlpha = 0.8;
        ctx.fillStyle = VISUAL_COLORS[cue.futureColor];
        this.path(hexPoints(point, 6, -TURN)); ctx.fill();
      }
    }
    ctx.restore();
  }

  private screenEffects(effects: EffectsSnapshot): void {
    const ctx = this.ctx;
    if (effects.screenFlash !== null) {
      const flash = effects.screenFlash;
      ctx.save();
      ctx.globalAlpha = Math.min(0.42, Math.max(0, flash.intensity) * 0.42)
        * Math.min(1, flash.remainingMs / 90);
      ctx.strokeStyle = this.effectTone(flash.tone);
      ctx.lineWidth = 2.5;
      this.path(hexPoints({ x: this.width / 2, y: this.height / 2 },
        (HEX_APOTHEM + 24) * this.scale, -TURN));
      ctx.stroke();
      ctx.restore();
    }
  }

  private effectTone(tone: 'ink' | 'coral' | 'amber'): string {
    return tone === 'ink' ? VISUAL_COLORS.ink : VISUAL_COLORS[tone];
  }

  private path(points: readonly Point[]): void {
    const ctx = this.ctx;
    ctx.beginPath();
    points.forEach((point, index) => {
      const x = this.finite(point.x);
      const y = this.finite(point.y);
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();
  }

  private midpoint(a: Point, b: Point): Point {
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }

  private finite(value: number | undefined, fallback = 0): number {
    return value !== undefined && Number.isFinite(value) ? value : fallback;
  }
}
