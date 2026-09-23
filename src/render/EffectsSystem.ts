import { BLOCK_DEPTH, HEX_APOTHEM, SIDE_COUNT } from '../game/constants';
import type { BlockColor, CellRef, GameEvent } from '../game/types';
import type { AnomalyType, BonusType } from '../game/progressionTypes';
import { getBonusPresentation } from '../presentation/bonusPresentation';
import type { Point } from './geometry';

const MAX_PARTICLES = 180;
const MAX_SHOCKWAVES = 12;
const MAX_LABELS = 6;
const MAX_ASSEMBLIES = 36;
const MAX_FRAGMENTS = 180;
const MAX_LOCAL_CUES = 36;
const MAX_ANOMALY_CUES = 4;
const ORDINARY_EXPIRY_MS = 980;
const MAX_WARNING_CUE_MS = 3_200;
const FLASH_LIFETIME_MS = 160;
const SHAKE_LIFETIME_MS = 120;
const COMBO_LIFETIME_MS = 360;
const CLEAR_SHOCKWAVE_LIFETIME_MS = 360;
const TOP_SIDE_ANGLE = -Math.PI / 2;
const ASSEMBLY_LIFETIME_MS = 180 as const;
const FRACTURE_LIFETIME_MS = 620;
const FRACTURE_ANTICIPATION_MS = 80;
const BONUS_COLLECTION_HOLD_MS = 90;
const LANDING_SQUASH_MS = 110;
const BONUS_IMPACT_LIFETIME_MS = 620 as const;
const COLOR_BREAK_GROUP_COUNT = 16;

const ANOMALY_LABELS: Readonly<Record<AnomalyType, string>> = Object.freeze({
  reverse: 'РЕВЕРС',
  mirage: 'МИРАЖ',
  drift: 'ДРЕЙФ',
  colorShift: 'СМЕНА ЦВЕТА',
  inertia: 'ИНЕРЦИЯ',
});

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

export interface BlockAssembly {
  readonly blockId: number;
  readonly lane: number;
  readonly color: BlockColor;
  readonly ageMs: number;
  readonly lifetimeMs: 180;
}

export interface FractureFragment {
  readonly originX: number;
  readonly originY: number;
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
  readonly rotation: number;
  readonly spin: number;
  readonly size: number;
  readonly color: BlockColor;
  readonly ageMs: number;
  readonly lifetimeMs: number;
  readonly anticipationMs: number;
}

export interface BonusImpact {
  readonly bonus: BonusType;
  readonly removedCount: number;
  readonly ageMs: number;
  readonly lifetimeMs: number;
  readonly targetSide: number | null;
  readonly cutCells: readonly CellRef[];
  readonly removedColors: readonly BlockColor[];
}

export interface Anticipation {
  readonly kind: 'landing' | 'clear' | 'bonus';
  readonly x: number;
  readonly y: number;
  readonly ageMs: number;
  readonly lifetimeMs: number;
}

export interface LandingResponse {
  readonly x: number;
  readonly y: number;
  readonly color: BlockColor;
  readonly ageMs: number;
  readonly lifetimeMs: 110;
}

export interface AnomalyCue {
  readonly anomaly: AnomalyType;
  readonly lanes: readonly number[];
  readonly ageMs: number;
  readonly lifetimeMs: number;
  readonly warning: boolean;
  readonly direction: -1 | 1 | null;
  readonly destinationLane: number | null;
  readonly futureColor: BlockColor | null;
  readonly remainingImpulseMs: number;
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
  readonly kind: 'clear' | 'collection' | 'slow' | 'pulse' | 'cleanse' | 'colorBreak' | 'rescue';
  readonly x: number;
  readonly y: number;
  readonly color: BlockColor | 'ivory';
  readonly ageMs: number;
  readonly lifetimeMs: number;
  readonly intensity: number;
  readonly delayMs: number;
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
  readonly reducedMotion: boolean;
  readonly anticipations: readonly Anticipation[];
  readonly assemblies: readonly BlockAssembly[];
  readonly landings: readonly LandingResponse[];
  readonly fragments: readonly FractureFragment[];
  readonly anomalyCues: readonly AnomalyCue[];
  readonly slowTrailRemainingMs: number;
  readonly bonusImpact: BonusImpact | null;
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

type Mutable<T> = { -readonly [Key in keyof T]: T[Key] };
type MutableAssembly = Mutable<BlockAssembly>;
type MutableFragment = Mutable<FractureFragment>;
type MutableBonusImpact = Mutable<BonusImpact>;
type MutableAnticipation = Mutable<Anticipation>;
type MutableLanding = Mutable<LandingResponse>;
type MutableAnomalyCue = Mutable<AnomalyCue>;

interface MutableFlash extends Omit<LandingFlash, 'ageMs'> {
  ageMs: number;
}

interface MutableCombo extends Omit<ComboImpulse, 'ageMs' | 'remainingMs'> {
  ageMs: number;
}

interface MutableShockwave extends Omit<Shockwave, 'ageMs'> { ageMs: number; }
interface MutableLabel extends Omit<EffectLabel, 'ageMs'> { ageMs: number; }

export class EffectsSystem {
  private anticipations: MutableAnticipation[] = [];
  private assemblies: MutableAssembly[] = [];
  private landings: MutableLanding[] = [];
  private fragments: MutableFragment[] = [];
  private anomalyCues: MutableAnomalyCue[] = [];
  private slowTrailRemainingMs = 0;
  private pulseActivationPending = false;
  private bonusImpact: MutableBonusImpact | null = null;
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
        case 'blockSpawned':
          if (!this.reducedMotion) {
            this.assemblies.push({
              blockId: event.block.id,
              lane: event.block.lane,
              color: event.block.color,
              ageMs: 0,
              lifetimeMs: ASSEMBLY_LIFETIME_MS,
            });
          }
          if (event.block.driftToLane !== undefined) {
            this.upsertAnomalyCue('drift', [event.block.lane], false, 980, { destinationLane: event.block.driftToLane });
          }
          if (event.block.mirageLane !== undefined) {
            this.upsertAnomalyCue('mirage', [event.block.lane], false, 980, { destinationLane: event.block.mirageLane });
          }
          if (event.block.shiftToColor !== undefined) {
            this.upsertAnomalyCue('colorShift', [event.block.lane], false, 980, { futureColor: event.block.shiftToColor });
          }
          break;
        case 'blockLanded':
          this.impact(2, 70);
          if (!this.reducedMotion) {
            const position = this.cellPosition(event.cell, center, orientation);
            this.landings.push({ ...position, color: event.block.color, ageMs: 0, lifetimeMs: LANDING_SQUASH_MS });
            this.addAnticipation('landing', position, LANDING_SQUASH_MS);
            this.flashes.push({
              ...position,
              color: event.block.color,
              ageMs: 0,
              lifetimeMs: FLASH_LIFETIME_MS,
            });
          }
          break;
        case 'bonusCollected': {
          this.impact(0, 0, BONUS_COLLECTION_HOLD_MS);
          const angle = TOP_SIDE_ANGLE + event.token.lane * ((Math.PI * 2) / SIDE_COUNT);
          const position = {
            x: center.x + Math.cos(angle) * event.token.distance,
            y: center.y + Math.sin(angle) * event.token.distance,
          };
          this.addAnticipation('bonus', position, BONUS_COLLECTION_HOLD_MS);
          this.addShockwave({ ...position, kind: 'collection', color: 'ivory', ageMs: 0,
            lifetimeMs: 260, intensity: 0.6, delayMs: BONUS_COLLECTION_HOLD_MS });
          break;
        }
        case 'matchCleared':
          for (const cell of event.cells) {
            this.addAnticipation('clear', this.cellPosition(cell, center, orientation), FRACTURE_ANTICIPATION_MS);
            this.addFractures(cell, event.color, center, orientation,
              event.chain > 1 ? Math.min(12, 8 + event.chain) : 8);
          }
          this.impact(Math.min(8, 2 + event.chain * 2), SHAKE_LIFETIME_MS, 60);
          this.addShockwave({
            kind: 'clear', delayMs: FRACTURE_ANTICIPATION_MS,
            ...this.cellPosition(event.cells[0] ?? { side: 0, index: 0 }, center, orientation),
            color: event.color,
            ageMs: 0,
            lifetimeMs: event.chain > 1 ? 460 : CLEAR_SHOCKWAVE_LIFETIME_MS,
            intensity: event.chain > 1 ? 0.85 : 0.55,
          });
          if (event.chain > 1) this.addLabel(`СЕРИЯ ×${event.chain}`, 'amber', 620);
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
        case 'bonusActivated':
          this.bonusImpact = this.newBonusImpact(event.bonus);
          if (event.bonus === 'slow') {
            if (!this.reducedMotion) this.slowTrailRemainingMs = 6_000;
            this.addShockwave({ ...center, kind: 'slow', delayMs: 0, color: 'ivory', ageMs: 0,
              lifetimeMs: 520, intensity: 0.65 });
            this.flash('ink', 0.35, 100);
          } else if (event.bonus === 'pulse') {
            this.pulseActivationPending = true;
            for (const delayMs of [0, 42, 84]) this.addShockwave({ ...center, kind: 'pulse', delayMs,
              color: 'ivory', ageMs: 0, lifetimeMs: 520, intensity: 0.85 });
          } else {
            this.addShockwave({ ...center, kind: event.bonus, delayMs: 0, color: 'ivory', ageMs: 0,
              lifetimeMs: 520, intensity: 0.65 });
          }
          break;
        case 'bonusRemoved':
          this.bonusImpact = {
            ...this.newBonusImpact(event.bonus),
            removedCount: event.cells.length,
            targetSide: event.bonus === 'cleanse' ? (event.cells[0]?.side ?? null) : null,
            cutCells: event.bonus === 'cleanse' ? event.cells.map((cell) => ({ ...cell })) : [],
            removedColors: [...new Set(event.blocks.map(({ color }) => color))],
          };
          if (event.bonus !== 'slow') {
            event.cells.forEach((cell, index) => {
              const color = event.blocks[index]?.color ?? event.blocks[0]?.color ?? 'coral';
              const delay = event.bonus === 'cleanse'
                ? index * 28
                : event.bonus === 'colorBreak'
                  ? (index % COLOR_BREAK_GROUP_COUNT) * 24
                  : event.bonus === 'pulse' ? index * 20 : 0;
              this.addAnticipation('bonus', this.cellPosition(cell, center, orientation),
                Math.min(FRACTURE_ANTICIPATION_MS + delay, ORDINARY_EXPIRY_MS));
              this.addFractures(cell, color, center, orientation, 8, delay, event.bonus);
            });
          }
          this.impact(7, 180, 80);
          if (event.bonus !== 'pulse' || !this.pulseActivationPending) {
            this.addShockwave({ ...center, kind: event.bonus, delayMs: 0,
              color: 'ivory', ageMs: 0, lifetimeMs: 520, intensity: 1 });
          }
          this.pulseActivationPending = false;
          this.addLabel(getBonusPresentation(event.bonus).label, 'coral', 620);
          this.flash('coral', 0.75, 100);
          break;
        case 'anomalyWarning':
          for (const anomaly of event.anomalies) {
            this.upsertAnomalyCue(anomaly, event.lanes, true, event.warningMs);
          }
          break;
        case 'anomalyStarted':
          for (const anomaly of event.anomalies) {
            this.upsertAnomalyCue(anomaly, event.lanes, false, ORDINARY_EXPIRY_MS);
          }
          this.addLabel(event.anomalies.map((anomaly) => ANOMALY_LABELS[anomaly]).join(' + '), 'amber', 620);
          this.flash('amber', 0.55, 100);
          break;
        case 'anomalyEnded':
          this.anomalyCues = this.anomalyCues.filter(({ anomaly }) => !event.anomalies.includes(anomaly));
          break;
        case 'rotationDelayed':
          this.upsertAnomalyCue('inertia', [], false, ORDINARY_EXPIRY_MS, {
            direction: event.steps, remainingImpulseMs: event.remainingMs,
          });
          break;
        case 'cycleCompleted':
          this.impact(8, 220);
          this.addLabel(`ЦИКЛ ${event.cycle} ЗАВЕРШЁН`, 'amber', 620);
          this.flash('amber', 1, 160);
          break;
        case 'lastStand':
          this.impact(8, 220);
          this.addShockwave({ ...center, kind: 'rescue', delayMs: 0, color: 'ivory', ageMs: 0,
            lifetimeMs: 520, intensity: 0.9 });
          this.addLabel('ПОСЛЕДНИЙ ШАНС', 'coral', 620);
          this.flash('coral', 1, 160);
          break;
        case 'gameOver':
          this.impact(8, 220);
          break;
      }
    }

    this.anticipations = this.anticipations.slice(-MAX_LOCAL_CUES);
    this.assemblies = this.assemblies.slice(-MAX_ASSEMBLIES);
    this.landings = this.landings.slice(-MAX_LOCAL_CUES);
    this.fragments = this.fragments.slice(-MAX_FRAGMENTS);
    this.anomalyCues = this.anomalyCues.slice(-MAX_ANOMALY_CUES);
    this.particles = this.particles.slice(-MAX_PARTICLES);
    this.shockwaves = this.shockwaves.slice(-MAX_SHOCKWAVES);
    this.labels = this.labels.slice(-MAX_LABELS);
  }

  public update(deltaMs: number): void {
    let remainingMs = Number.isFinite(deltaMs) ? Math.min(Math.max(0, deltaMs), 6_000) : 0;
    if (remainingMs > 0) this.pulseActivationPending = false;
    while (remainingMs > 0) {
      const dt = Math.min(remainingMs, 50);
      this.advanceStep(dt);
      remainingMs -= dt;
    }
  }

  private advanceStep(dt: number): void {
    for (const anticipation of this.anticipations) anticipation.ageMs += dt;
    for (const assembly of this.assemblies) assembly.ageMs += dt;
    for (const landing of this.landings) landing.ageMs += dt;
    for (const fragment of this.fragments) {
      const activeMs = this.activeParticleDuration(fragment.ageMs, dt, fragment.anticipationMs);
      fragment.ageMs += dt;
      if (activeMs <= 0) continue;
      const activeSeconds = activeMs / 1000;
      const speed = Math.hypot(fragment.vx, fragment.vy);
      if (speed > 0) {
        fragment.vx += (fragment.vx / speed) * 38 * activeSeconds;
        fragment.vy += (fragment.vy / speed) * 38 * activeSeconds;
      }
      fragment.x += fragment.vx * activeSeconds;
      fragment.y += fragment.vy * activeSeconds;
      fragment.rotation += fragment.spin * activeSeconds;
    }
    if (this.bonusImpact !== null) this.bonusImpact.ageMs += dt;
    for (const cue of this.anomalyCues) {
      cue.ageMs += dt;
      cue.remainingImpulseMs = Math.max(0, cue.remainingImpulseMs - dt);
    }
    this.slowTrailRemainingMs = Math.max(0, this.slowTrailRemainingMs - dt);
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

    this.anticipations = this.anticipations.filter((anticipation) => anticipation.ageMs < anticipation.lifetimeMs).slice(-MAX_LOCAL_CUES);
    this.assemblies = this.assemblies.filter((assembly) => assembly.ageMs < assembly.lifetimeMs).slice(-MAX_ASSEMBLIES);
    this.landings = this.landings.filter((landing) => landing.ageMs < landing.lifetimeMs).slice(-MAX_LOCAL_CUES);
    this.fragments = this.fragments.filter((fragment) => fragment.ageMs < fragment.lifetimeMs).slice(-MAX_FRAGMENTS);
    if (this.bonusImpact !== null && this.bonusImpact.ageMs >= this.bonusImpact.lifetimeMs) this.bonusImpact = null;
    this.anomalyCues = this.anomalyCues.filter((cue) => cue.ageMs < cue.lifetimeMs).slice(-MAX_ANOMALY_CUES);
    this.particles = this.particles.filter((particle) => particle.ageMs < particle.lifetimeMs).slice(-MAX_PARTICLES);
    this.flashes = this.flashes.filter((flash) => flash.ageMs < flash.lifetimeMs);
    this.shockwaves = this.shockwaves.filter((shockwave) => shockwave.ageMs < shockwave.lifetimeMs + shockwave.delayMs);
    this.labels = this.labels.filter((label) => label.ageMs < label.lifetimeMs);
    if (this.combo.ageMs >= this.combo.lifetimeMs) this.combo = this.emptyCombo();
    if (this.shakeRemainingMs === 0) this.shakeMagnitude = 0;
  }

  public snapshot(): EffectsSnapshot {
    const anticipations = Object.freeze(this.anticipations.map((cue) => Object.freeze({ ...cue })));
    const assemblies = Object.freeze(this.assemblies.map((assembly) => Object.freeze({ ...assembly })));
    const landings = Object.freeze(this.landings.map((landing) => Object.freeze({ ...landing })));
    const fragments = Object.freeze(this.fragments.map((fragment) => Object.freeze({ ...fragment })));
    const anomalyCues = Object.freeze(this.anomalyCues.map((cue) => Object.freeze({
      ...cue, lanes: Object.freeze([...cue.lanes]),
    })));
    const particles = Object.freeze(this.particles.map((particle) => Object.freeze({ ...particle })));
    const flashes = Object.freeze(this.flashes.map((flash) => Object.freeze({ ...flash })));
    const shockwaves = Object.freeze(this.shockwaves.map((shockwave) => Object.freeze({ ...shockwave })));
    const labels = Object.freeze(this.labels.map((label) => Object.freeze({ ...label })));
    const combo = Object.freeze({
      ...this.combo,
      remainingMs: Math.max(0, this.combo.lifetimeMs - this.combo.ageMs),
    });
    return Object.freeze({
      reducedMotion: this.reducedMotion,
      anticipations,
      assemblies,
      landings,
      fragments,
      anomalyCues,
      slowTrailRemainingMs: this.slowTrailRemainingMs,
      bonusImpact: this.bonusImpact === null ? null : Object.freeze({
        ...this.bonusImpact,
        cutCells: Object.freeze(this.bonusImpact.cutCells.map((cell) => Object.freeze({ ...cell }))),
        removedColors: Object.freeze([...this.bonusImpact.removedColors]),
      }),
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
    this.anticipations = [];
    this.assemblies = [];
    this.landings = [];
    this.fragments = [];
    this.anomalyCues = [];
    this.slowTrailRemainingMs = 0;
    this.pulseActivationPending = false;
    this.bonusImpact = null;
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

  private addFractures(
    cell: CellRef,
    color: BlockColor,
    center: Point,
    orientation: number,
    count: number,
    extraDelayMs = 0,
    bonus?: BonusType,
  ): void {
    if (this.reducedMotion) return;
    const position = this.cellPosition(cell, center, orientation);
    const sideAngle = this.sideAngle(cell.side, orientation);
    const normal = { x: Math.cos(sideAngle), y: Math.sin(sideAngle) };
    const tangent = { x: -normal.y, y: normal.x };

    for (let index = 0; index < count; index += 1) {
      const tangentScale = bonus === 'pulse' ? 95 : 150;
      const tangentSpeed = (this.random() - 0.5) * tangentScale;
      const outwardSpeed = (bonus === 'pulse' ? 145 : 82) + this.random() * 88;
      this.fragments.push({
        originX: position.x,
        originY: position.y,
        ...position,
        vx: normal.x * outwardSpeed + tangent.x * tangentSpeed,
        vy: normal.y * outwardSpeed + tangent.y * tangentSpeed,
        rotation: this.random() * Math.PI * 2,
        spin: (this.random() - 0.5) * 12,
        size: 9 + this.random() * 7,
        color,
        ageMs: 0,
        lifetimeMs: Math.min(ORDINARY_EXPIRY_MS, FRACTURE_LIFETIME_MS + extraDelayMs),
        anticipationMs: Math.min(ORDINARY_EXPIRY_MS - 1, FRACTURE_ANTICIPATION_MS + extraDelayMs),
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
    if (this.reducedMotion) {
      this.shockwaves = [{ ...shockwave, ageMs: 0, delayMs: 0, lifetimeMs: 140, intensity: 0.3 }];
      return;
    }
    this.shockwaves.push(shockwave);
  }

  private addAnticipation(kind: Anticipation['kind'], point: Point, lifetimeMs: number): void {
    if (this.reducedMotion) return;
    this.anticipations.push({ kind, ...point, ageMs: 0, lifetimeMs });
  }

  private newBonusImpact(bonus: BonusType): MutableBonusImpact {
    return { bonus, removedCount: 0, ageMs: 0, lifetimeMs: this.reducedMotion ? 140 : BONUS_IMPACT_LIFETIME_MS,
      targetSide: null, cutCells: [], removedColors: [] };
  }

  private upsertAnomalyCue(
    anomaly: AnomalyType,
    lanes: readonly number[],
    warning: boolean,
    lifetimeMs: number,
    details: Partial<Pick<AnomalyCue, 'direction' | 'destinationLane' | 'futureColor' | 'remainingImpulseMs'>> = {},
  ): void {
    const previous = this.anomalyCues.find((cue) => cue.anomaly === anomaly);
    this.anomalyCues = this.anomalyCues.filter((cue) => cue.anomaly !== anomaly);
    this.anomalyCues.push({
      anomaly,
      lanes: [...lanes],
      ageMs: 0,
      lifetimeMs: Math.max(0, Math.min(lifetimeMs, warning ? MAX_WARNING_CUE_MS : ORDINARY_EXPIRY_MS)),
      warning,
      direction: details.direction ?? (anomaly === 'reverse' ? -1 : previous?.direction ?? null),
      destinationLane: details.destinationLane ?? (warning ? null : previous?.destinationLane ?? null),
      futureColor: details.futureColor ?? (warning ? null : previous?.futureColor ?? null),
      remainingImpulseMs: details.remainingImpulseMs ?? (warning ? 0 : previous?.remainingImpulseMs ?? 0),
    });
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
