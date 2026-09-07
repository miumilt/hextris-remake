import { BLOCK_DEPTH, HEX_APOTHEM, SIDE_COUNT } from '../game/constants';
import type { BlockColor, CellRef, GameEvent } from '../game/types';
import type { Point } from './geometry';

const MAX_PARTICLES = 180;
const MAX_SHOCKWAVES = 12;
const MAX_LABELS = 6;
const PARTICLES_PER_CLEAR = 6;
const PARTICLE_LIFETIME_MS = 700;
const PARTICLE_BURST_DELAY_MS = 70;
const FLASH_LIFETIME_MS = 160;
const SHAKE_LIFETIME_MS = 120;
const COMBO_LIFETIME_MS = 360;
const CLEAR_SHOCKWAVE_LIFETIME_MS = 360;
const TOP_SIDE_ANGLE = -Math.PI / 2;

const progressionLabel = (value: string): string => value.replace(/([a-z])([A-Z])/g, '$1 $2').toUpperCase();

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

export interface Shockwave {
  readonly x: number;
  readonly y: number;
  readonly color: BlockColor | 'ivory';
  readonly ageMs: number;
  readonly lifetimeMs: number;
  readonly intensity: number;
}

export interface EffectLabel {
  readonly text: string;
  readonly tone: 'ink' | 'coral' | 'amber';
  readonly ageMs: number;
  readonly lifetimeMs: number;
}

export interface ScreenFlash {
  readonly tone: 'ink' | 'coral' | 'amber';
  readonly intensity: number;
  readonly remainingMs: number;
}

export interface EffectsSnapshot {
  readonly particles: readonly EffectParticle[];
  readonly flashes: readonly LandingFlash[];
  readonly shake: CameraShake;
  readonly combo: ComboImpulse;
  readonly shockwaves: readonly Shockwave[];
  readonly labels: readonly EffectLabel[];
  readonly screenFlash: ScreenFlash | null;
  readonly hitStopRemainingMs: number;
}

export interface EffectsOptions {
  readonly random?: () => number;
  readonly reducedMotion?: boolean;
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

interface MutableShockwave extends Omit<Shockwave, 'ageMs'> { ageMs: number; }
interface MutableLabel extends Omit<EffectLabel, 'ageMs'> { ageMs: number; }

export class EffectsSystem {
  private particles: MutableParticle[] = [];
  private flashes: MutableFlash[] = [];
  private shakeMagnitude = 0;
  private shakeRemainingMs = 0;
  private combo: MutableCombo = this.emptyCombo();
  private shockwaves: MutableShockwave[] = [];
  private labels: MutableLabel[] = [];
  private screenFlash: ScreenFlash | null = null;
  private hitStopRemainingMs = 0;
  private readonly random: () => number;
  private readonly reducedMotion: boolean;

  public constructor(options: EffectsOptions = {}) {
    this.random = options.random ?? Math.random;
    this.reducedMotion = options.reducedMotion ?? false;
  }

  public consume(events: readonly GameEvent[], context: EffectsContext = {}): void {
    const center = context.center ?? { x: 0, y: 0 };
    const orientation = context.orientation ?? 0;
    const comboPosition = context.comboPosition ?? { x: center.x, y: center.y - 150 };

    for (const event of events) {
      switch (event.type) {
        case 'blockLanded':
          this.impact(2, 70);
          if (!this.reducedMotion) {
            this.flashes.push({
              ...this.cellPosition(event.cell, center, orientation),
              color: event.block.color,
              ageMs: 0,
              lifetimeMs: FLASH_LIFETIME_MS,
            });
          }
          break;
        case 'matchCleared':
          for (const cell of event.cells) this.addClearParticles(
            cell,
            event.color,
            center,
            orientation,
            event.chain > 1 ? PARTICLES_PER_CLEAR + event.chain * 2 : PARTICLES_PER_CLEAR,
          );
          this.impact(Math.min(8, 2 + event.chain * 2), SHAKE_LIFETIME_MS, 60);
          this.addShockwave({
            ...this.cellPosition(event.cells[0] ?? { side: 0, index: 0 }, center, orientation),
            color: event.color,
            ageMs: 0,
            lifetimeMs: event.chain > 1 ? 460 : CLEAR_SHOCKWAVE_LIFETIME_MS,
            intensity: event.chain > 1 ? 0.85 : 0.55,
          });
          if (event.chain > 1) this.addLabel(`CHAIN ×${event.chain}`, 'amber', 620);
          break;
        case 'comboChanged':
          if (!this.reducedMotion) {
            this.combo = {
              multiplier: event.multiplier,
              x: comboPosition.x,
              y: comboPosition.y,
              ageMs: 0,
              lifetimeMs: COMBO_LIFETIME_MS,
            };
          }
          break;
        case 'bonusRemoved':
          this.impact(7, 180, 80);
          this.addShockwave({
            ...center,
            color: 'ivory',
            ageMs: 0,
            lifetimeMs: 520,
            intensity: 1,
          });
          this.addLabel(progressionLabel(event.bonus), 'coral', 620);
          this.flash('coral', 0.75, 100);
          break;
        case 'anomalyStarted':
          this.addLabel(event.anomalies.map(progressionLabel).join(' + '), 'amber', 620);
          this.flash('amber', 0.55, 100);
          break;
        case 'cycleCompleted':
          this.impact(8, 220);
          this.addLabel(`CYCLE ${event.cycle} COMPLETE`, 'amber', 620);
          this.flash('amber', 1, 160);
          break;
        case 'lastStand':
          this.impact(8, 220);
          this.addLabel('LAST STAND', 'coral', 620);
          this.flash('coral', 1, 160);
          break;
        case 'gameOver':
          this.impact(8, 220);
          break;
      }
    }

    this.particles = this.particles.slice(-MAX_PARTICLES);
    this.shockwaves = this.shockwaves.slice(-MAX_SHOCKWAVES);
    this.labels = this.labels.slice(-MAX_LABELS);
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
    for (const shockwave of this.shockwaves) shockwave.ageMs += dt;
    for (const label of this.labels) label.ageMs += dt;
    this.shakeRemainingMs = Math.max(0, this.shakeRemainingMs - dt);
    this.hitStopRemainingMs = Math.max(0, this.hitStopRemainingMs - dt);
    if (this.screenFlash !== null) {
      const remainingMs = Math.max(0, this.screenFlash.remainingMs - dt);
      this.screenFlash = remainingMs === 0 ? null : { ...this.screenFlash, remainingMs };
    }
    this.combo.ageMs += dt;

    this.particles = this.particles.filter((particle) => particle.ageMs < particle.lifetimeMs).slice(-MAX_PARTICLES);
    this.flashes = this.flashes.filter((flash) => flash.ageMs < flash.lifetimeMs);
    this.shockwaves = this.shockwaves.filter((shockwave) => shockwave.ageMs < shockwave.lifetimeMs);
    this.labels = this.labels.filter((label) => label.ageMs < label.lifetimeMs);
    if (this.combo.ageMs >= this.combo.lifetimeMs) this.combo = this.emptyCombo();
    if (this.shakeRemainingMs === 0) this.shakeMagnitude = 0;
  }

  public snapshot(): EffectsSnapshot {
    const particles = Object.freeze(this.particles.map((particle) => Object.freeze({ ...particle })));
    const flashes = Object.freeze(this.flashes.map((flash) => Object.freeze({ ...flash })));
    const shockwaves = Object.freeze(this.shockwaves.map((shockwave) => Object.freeze({ ...shockwave })));
    const labels = Object.freeze(this.labels.map((label) => Object.freeze({ ...label })));
    const combo = Object.freeze({
      ...this.combo,
      remainingMs: Math.max(0, this.combo.lifetimeMs - this.combo.ageMs),
    });
    return Object.freeze({
      particles,
      flashes,
      shake: Object.freeze({ magnitude: this.shakeMagnitude, remainingMs: this.shakeRemainingMs }),
      combo,
      shockwaves,
      labels,
      screenFlash: this.screenFlash === null ? null : Object.freeze({ ...this.screenFlash }),
      hitStopRemainingMs: this.hitStopRemainingMs,
    });
  }

  public reset(): void {
    this.particles = [];
    this.flashes = [];
    this.shakeMagnitude = 0;
    this.shakeRemainingMs = 0;
    this.combo = this.emptyCombo();
    this.shockwaves = [];
    this.labels = [];
    this.screenFlash = null;
    this.hitStopRemainingMs = 0;
  }

  private addClearParticles(
    cell: CellRef,
    color: BlockColor,
    center: Point,
    orientation: number,
    count: number = PARTICLES_PER_CLEAR,
  ): void {
    if (this.reducedMotion) return;
    const position = this.cellPosition(cell, center, orientation);
    const sideAngle = this.sideAngle(cell.side, orientation);
    const normal = { x: Math.cos(sideAngle), y: Math.sin(sideAngle) };
    const tangent = { x: -normal.y, y: normal.x };

    for (let index = 0; index < count; index += 1) {
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

  private impact(magnitude: number, durationMs: number, hitStopMs = 0): void {
    if (this.reducedMotion) return;
    this.shakeMagnitude = Math.max(this.shakeMagnitude, magnitude);
    this.shakeRemainingMs = Math.max(this.shakeRemainingMs, durationMs);
    this.hitStopRemainingMs = Math.max(this.hitStopRemainingMs, hitStopMs);
  }

  private addShockwave(shockwave: MutableShockwave): void {
    if (!this.reducedMotion) this.shockwaves.push(shockwave);
  }

  private addLabel(text: string, tone: EffectLabel['tone'], lifetimeMs: number): void {
    this.labels.push({ text, tone, ageMs: 0, lifetimeMs });
  }

  private flash(tone: ScreenFlash['tone'], intensity: number, remainingMs: number): void {
    if (this.reducedMotion) return;
    if (this.screenFlash === null || intensity >= this.screenFlash.intensity) {
      this.screenFlash = { tone, intensity, remainingMs: Math.max(remainingMs, this.screenFlash?.remainingMs ?? 0) };
      return;
    }
    this.screenFlash = { ...this.screenFlash, remainingMs: Math.max(this.screenFlash.remainingMs, remainingMs) };
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
