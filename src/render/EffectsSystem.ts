import { BLOCK_DEPTH, HEX_APOTHEM, SIDE_COUNT } from '../game/constants';
import type { BlockColor, CellRef, GameEvent } from '../game/types';
import type { Point } from './geometry';

const MAX_PARTICLES = 180;
const PARTICLES_PER_CLEAR = 6;
const PARTICLE_LIFETIME_MS = 700;
const PARTICLE_BURST_DELAY_MS = 70;
const FLASH_LIFETIME_MS = 160;
const SHAKE_LIFETIME_MS = 120;
const COMBO_LIFETIME_MS = 360;
const TOP_SIDE_ANGLE = -Math.PI / 2;

export interface EffectParticle {
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
  readonly rotation: number;
  readonly spin: number;
  readonly color: BlockColor;
  readonly ageMs: number;
  readonly lifetimeMs: number;
  readonly burstDelayMs: number;
}

export interface LandingFlash {
  readonly x: number;
  readonly y: number;
  readonly color: BlockColor;
  readonly ageMs: number;
  readonly lifetimeMs: number;
}

export interface CameraShake {
  readonly magnitude: number;
  readonly remainingMs: number;
}

export interface ComboImpulse {
  readonly multiplier: number;
  readonly x: number;
  readonly y: number;
  readonly ageMs: number;
  readonly lifetimeMs: number;
  readonly remainingMs: number;
}

export interface EffectsSnapshot {
  readonly particles: readonly EffectParticle[];
  readonly flashes: readonly LandingFlash[];
  readonly shake: CameraShake;
  readonly combo: ComboImpulse;
}

export interface EffectsContext {
  readonly center?: Point;
  readonly orientation?: number;
  readonly comboPosition?: Point;
}

interface MutableParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rotation: number;
  spin: number;
  color: BlockColor;
  ageMs: number;
  lifetimeMs: number;
  burstDelayMs: number;
}

interface MutableFlash extends Omit<LandingFlash, 'ageMs'> {
  ageMs: number;
}

interface MutableCombo extends Omit<ComboImpulse, 'ageMs' | 'remainingMs'> {
  ageMs: number;
}

export class EffectsSystem {
  private particles: MutableParticle[] = [];
  private flashes: MutableFlash[] = [];
  private shakeMagnitude = 0;
  private shakeRemainingMs = 0;
  private combo: MutableCombo = this.emptyCombo();

  public constructor(private readonly random: () => number = Math.random) {}

  public consume(events: readonly GameEvent[], context: EffectsContext = {}): void {
    const center = context.center ?? { x: 0, y: 0 };
    const orientation = context.orientation ?? 0;
    const comboPosition = context.comboPosition ?? { x: center.x, y: center.y - 150 };

    for (const event of events) {
      switch (event.type) {
        case 'blockLanded':
          this.flashes.push({
            ...this.cellPosition(event.cell, center, orientation),
            color: event.block.color,
            ageMs: 0,
            lifetimeMs: FLASH_LIFETIME_MS,
          });
          break;
        case 'matchCleared':
          for (const cell of event.cells) this.addClearParticles(cell, event.color, center, orientation);
          this.shakeMagnitude = Math.max(this.shakeMagnitude, Math.min(8, event.chain * 2));
          this.shakeRemainingMs = Math.max(this.shakeRemainingMs, SHAKE_LIFETIME_MS);
          break;
        case 'comboChanged':
          this.combo = {
            multiplier: event.multiplier,
            x: comboPosition.x,
            y: comboPosition.y,
            ageMs: 0,
            lifetimeMs: COMBO_LIFETIME_MS,
          };
          break;
        case 'gameOver':
          this.shakeMagnitude = Math.max(this.shakeMagnitude, 8);
          this.shakeRemainingMs = Math.max(this.shakeRemainingMs, 220);
          break;
      }
    }

    this.particles = this.particles.slice(-MAX_PARTICLES);
  }

  public update(deltaMs: number): void {
    const dt = Number.isFinite(deltaMs) ? Math.max(0, Math.min(deltaMs, 50)) : 0;
    for (const particle of this.particles) {
      const activeMs = this.activeParticleDuration(particle.ageMs, dt, particle.burstDelayMs);
      particle.ageMs += dt;
      particle.x += (particle.vx * activeMs) / 1000;
      particle.y += (particle.vy * activeMs) / 1000;
      particle.rotation += (particle.spin * activeMs) / 1000;
    }
    for (const flash of this.flashes) flash.ageMs += dt;
    this.shakeRemainingMs = Math.max(0, this.shakeRemainingMs - dt);
    this.combo.ageMs += dt;

    this.particles = this.particles.filter((particle) => particle.ageMs < particle.lifetimeMs).slice(-MAX_PARTICLES);
    this.flashes = this.flashes.filter((flash) => flash.ageMs < flash.lifetimeMs);
    if (this.combo.ageMs >= this.combo.lifetimeMs) this.combo = this.emptyCombo();
    if (this.shakeRemainingMs === 0) this.shakeMagnitude = 0;
  }

  public snapshot(): EffectsSnapshot {
    const particles = Object.freeze(this.particles.map((particle) => Object.freeze({ ...particle })));
    const flashes = Object.freeze(this.flashes.map((flash) => Object.freeze({ ...flash })));
    const combo = Object.freeze({
      ...this.combo,
      remainingMs: Math.max(0, this.combo.lifetimeMs - this.combo.ageMs),
    });
    return Object.freeze({
      particles,
      flashes,
      shake: Object.freeze({ magnitude: this.shakeMagnitude, remainingMs: this.shakeRemainingMs }),
      combo,
    });
  }

  public reset(): void {
    this.particles = [];
    this.flashes = [];
    this.shakeMagnitude = 0;
    this.shakeRemainingMs = 0;
    this.combo = this.emptyCombo();
  }

  private addClearParticles(cell: CellRef, color: BlockColor, center: Point, orientation: number): void {
    const position = this.cellPosition(cell, center, orientation);
    const sideAngle = this.sideAngle(cell.side, orientation);
    const normal = { x: Math.cos(sideAngle), y: Math.sin(sideAngle) };
    const tangent = { x: -normal.y, y: normal.x };

    for (let count = 0; count < PARTICLES_PER_CLEAR; count += 1) {
      const tangentSpeed = (this.random() - 0.5) * 180;
      const outwardSpeed = 70 + this.random() * 90;
      this.particles.push({
        ...position,
        vx: normal.x * outwardSpeed + tangent.x * tangentSpeed,
        vy: normal.y * outwardSpeed + tangent.y * tangentSpeed,
        rotation: this.random() * Math.PI * 2,
        spin: (this.random() - 0.5) * 12,
        color,
        ageMs: 0,
        lifetimeMs: PARTICLE_LIFETIME_MS,
        burstDelayMs: PARTICLE_BURST_DELAY_MS,
      });
    }
  }

  private cellPosition(cell: CellRef, center: Point, orientation: number): Point {
    const distance = HEX_APOTHEM + cell.index * BLOCK_DEPTH;
    const angle = this.sideAngle(cell.side, orientation);
    return { x: center.x + Math.cos(angle) * distance, y: center.y + Math.sin(angle) * distance };
  }

  private sideAngle(side: number, orientation: number): number {
    return TOP_SIDE_ANGLE + (((side - orientation) * Math.PI) / (SIDE_COUNT / 2));
  }

  private activeParticleDuration(ageMs: number, dt: number, burstDelayMs: number): number {
    return Math.max(0, ageMs + dt - burstDelayMs) - Math.max(0, ageMs - burstDelayMs);
  }

  private emptyCombo(): MutableCombo {
    return { multiplier: 0, x: 0, y: 0, ageMs: 0, lifetimeMs: 0 };
  }
}
