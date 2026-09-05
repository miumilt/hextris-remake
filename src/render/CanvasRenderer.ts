import { BLOCK_COLORS, BLOCK_DEPTH, FIXED_STEP_MS, HEX_APOTHEM, MAX_STACK_DEPTH, START_DISTANCE, VISUAL_COLORS } from '../game/constants';
import type { BlockColor, GameSnapshot } from '../game/types';
import type { EffectsSnapshot } from './EffectsSystem';
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

/** Canvas owns visual time and transitions; snapshots are never changed. */
export class CanvasRenderer {
  private readonly ctx: CanvasRenderingContext2D;
  private width = 1;
  private height = 1;
  private dpr = 1;
  private scale = 1;
  private lastSnapshot: GameSnapshot | null = null;
  private targetOrientation = 0;
  private fromOrientation = 0;
  private turnStartedAt = 0;
  private readonly plates = new Map<number, PlateMotion>();
  private readonly seenPlates = new Set<number>();
  private readonly grain = new Float32Array(1800);

  public constructor(private readonly canvas: HTMLCanvasElement) {
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
    return { x: this.width / 2 + point.x * this.scale, y: this.height / 2 + point.y * this.scale };
  }

  public render(snapshot: GameSnapshot, effects: EffectsSnapshot, alpha: number): void {
    const fraction = Number.isFinite(alpha) ? Math.max(0, Math.min(1, alpha)) : 0;
    const time = snapshot.elapsedMs + (snapshot.mode === 'playing' ? fraction * FIXED_STEP_MS : 0);
    this.syncMotion(snapshot, time);
    const orientation = this.orientationAt(time);
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.globalAlpha = 1;
    this.background();
    ctx.save();
    ctx.translate(this.width / 2, this.height / 2);
    ctx.scale(this.scale, this.scale);
    // The menu has visual motion even while engine elapsed time is zero.
    this.guides(snapshot.mode === 'menu' ? performance.now() : time);
    const shake = effects.shake.magnitude;
    ctx.translate(Math.sin(effects.shake.remainingMs * 0.31) * shake, Math.cos(effects.shake.remainingMs * 0.43) * shake * 0.6);

    for (const block of snapshot.falling) {
      const distance = block.distance + (snapshot.mode === 'playing' ? block.speed * (1 - fraction) * FIXED_STEP_MS / 1000 : 0);
      this.trail(-Math.PI / 2 + block.lane * TURN, distance, block.color);
    }

    if (snapshot.mode === 'menu') {
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
      this.hex(-orientation * TURN);
      for (let side = 0; side < snapshot.stacks.length; side += 1) {
        for (const block of snapshot.stacks[side]!) {
          const motion = this.plates.get(block.id)!;
          const distance = motion.from + (motion.to - motion.from) * ease((time - motion.startedAt) / COLLAPSE_MS);
          this.plate(-Math.PI / 2 + (side - orientation) * TURN, distance, block.color);
        }
      }
      for (const block of snapshot.falling) {
        const distance = block.distance + (snapshot.mode === 'playing' ? block.speed * (1 - fraction) * FIXED_STEP_MS / 1000 : 0);
        this.plate(-Math.PI / 2 + block.lane * TURN, distance, block.color);
      }
    }
    this.worldEffects(effects);
    ctx.restore();
    this.combo(effects);
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

  private guides(time: number): void {
    const ctx = this.ctx;
    ctx.lineWidth = 1 / this.scale;
    ctx.strokeStyle = 'rgba(141,145,140,0.075)';
    const safeRadius = (HEX_APOTHEM + MAX_STACK_DEPTH * BLOCK_DEPTH) / Math.cos(Math.PI / 6);
    this.path(hexPoints(ORIGIN, safeRadius, -TURN)); ctx.stroke();
    ctx.save();
    ctx.rotate(time * 0.000006);
    this.path(hexPoints(ORIGIN, 510, -TURN)); ctx.stroke();
    ctx.strokeStyle = 'rgba(141,145,140,0.045)';
    this.path(hexPoints(ORIGIN, 575, -TURN + 0.13)); ctx.stroke();
    ctx.restore();
    ctx.strokeStyle = 'rgba(141,145,140,0.10)';
    for (let lane = 0; lane < 6; lane += 1) {
      const angle = -Math.PI / 2 + lane * TURN;
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

  private shade(color: BlockColor): string {
    return { coral: '#B9574D', amber: '#B88A38', teal: '#478277', sky: '#56829C' }[color];
  }

  private trail(angle: number, distance: number, color: BlockColor): void {
    const ctx = this.ctx;
    ctx.save();
    for (let step = 3; step >= 1; step -= 1) {
      ctx.globalAlpha = 0.025 * (4 - step);
      this.path(blockQuad(ORIGIN, angle, distance + step * 14, 10));
      ctx.fillStyle = VISUAL_COLORS[color]; ctx.fill();
    }
    ctx.restore();
  }

  private worldEffects(effects: EffectsSnapshot): void {
    const ctx = this.ctx;
    for (const flash of effects.flashes) {
      const life = Math.max(0, 1 - flash.ageMs / flash.lifetimeMs);
      ctx.save(); ctx.globalAlpha = life * 0.7;
      const angle = Math.atan2(flash.y, flash.x);
      const distance = Math.hypot(flash.x, flash.y);
      this.path(blockQuad(ORIGIN, angle, distance + 2, 3 + life * 8));
      ctx.fillStyle = VISUAL_COLORS.ink; ctx.fill(); ctx.restore();
    }
    const contracting = new Set<string>();
    for (const particle of effects.particles) {
      if (particle.ageMs < particle.burstDelayMs) {
        // Six particles share each cleared plate's origin during the anticipation.
        // Draw its contracting silhouette once, without retaining game-state ghosts.
        const key = `${particle.x.toFixed(3)},${particle.y.toFixed(3)},${particle.color}`;
        if (!contracting.has(key)) {
          contracting.add(key);
          const progress = particle.ageMs / particle.burstDelayMs;
          const scale = 1 - progress * 0.6;
          ctx.save();
          ctx.globalAlpha = 1 - progress * 0.7;
          ctx.translate(particle.x, particle.y);
          ctx.scale(scale, scale);
          ctx.translate(-particle.x, -particle.y);
          this.plate(Math.atan2(particle.y, particle.x), Math.hypot(particle.x, particle.y), particle.color);
          ctx.restore();
        }
        continue;
      }
      const life = Math.max(0, 1 - particle.ageMs / particle.lifetimeMs);
      ctx.save(); ctx.translate(particle.x, particle.y); ctx.rotate(particle.rotation);
      ctx.globalAlpha = life;
      ctx.fillStyle = VISUAL_COLORS[particle.color];
      const size = 3 + life * 3;
      ctx.fillRect(-size / 2, -size / 2, size, size * 0.7);
      ctx.restore();
    }
  }

  private combo(effects: EffectsSnapshot): void {
    const impulse = effects.combo;
    if (impulse.multiplier < 2 || impulse.remainingMs <= 0) return;
    const ctx = this.ctx;
    const life = Math.max(0, 1 - impulse.ageMs / impulse.lifetimeMs);
    // Score is centered at the top in the screen composition; this layer never shakes.
    ctx.save(); ctx.globalAlpha = life;
    ctx.fillStyle = VISUAL_COLORS.amber;
    ctx.font = '600 20px Arial, sans-serif'; ctx.textAlign = 'left';
    ctx.fillText(`×${impulse.multiplier}`, this.width / 2 + 62, 75 - (1 - life) * 12);
    ctx.restore();
  }

  private path(points: readonly Point[]): void {
    const ctx = this.ctx;
    ctx.beginPath();
    points.forEach((point, index) => index === 0 ? ctx.moveTo(point.x, point.y) : ctx.lineTo(point.x, point.y));
    ctx.closePath();
  }
}
