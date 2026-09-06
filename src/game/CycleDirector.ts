import {
  ANOMALY_WARNING_MS,
  CYCLE_DURATION_MS,
  FLOW_END_MS,
  MAX_FALL_SPEED,
  MIN_WAVE_INTERVAL_MS,
  PRESSURE_END_MS,
} from './constants';
import type {
  ActiveAnomaly,
  AnomalyType,
  CycleSnapshot,
  DirectorEvent,
  DirectorModifiers,
  DirectorTick,
  GamePhase,
  WaveProfile,
} from './progressionTypes';
import type { RandomSource } from './random';
import type { WavePattern } from './WaveSpawner';

export interface CycleDirectorOptions {
  readonly flowMs?: number;
  readonly pressureMs?: number;
  readonly surgeMs?: number;
  readonly forcedAnomaliesByCycle?: Readonly<Record<number, readonly AnomalyType[]>>;
}

const ANOMALY_DURATIONS_MS: Readonly<Record<AnomalyType, number>> = {
  reverse: 9_000,
  mirage: 10_000,
  drift: 12_000,
  colorShift: 10_000,
  inertia: 8_000,
};

const ANOMALIES: readonly AnomalyType[] = ['reverse', 'mirage', 'drift', 'colorShift', 'inertia'];
const COMPATIBLE_ANOMALY_PAIRS: readonly (readonly [AnomalyType, AnomalyType])[] = [
  ['reverse', 'mirage'],
  ['reverse', 'drift'],
  ['reverse', 'colorShift'],
  ['mirage', 'drift'],
  ['mirage', 'colorShift'],
  ['mirage', 'inertia'],
  ['drift', 'colorShift'],
  ['drift', 'inertia'],
  ['colorShift', 'inertia'],
];
const SURGE_PATTERNS: readonly WavePattern[] = Object.freeze(['opposite', 'halfCircle', 'spiral', 'circle']);
const PATTERN_WEIGHTS: readonly {
  readonly throughCycle: number;
  readonly weights: Readonly<Record<WavePattern, number>>;
}[] = [
  { throughCycle: 2, weights: { single: 6, pair: 4, opposite: 2, halfCircle: 1, circle: 0, spiral: 1 } },
  { throughCycle: 5, weights: { single: 4, pair: 4, opposite: 3, halfCircle: 3, circle: 1, spiral: 3 } },
  { throughCycle: 8, weights: { single: 2, pair: 3, opposite: 4, halfCircle: 4, circle: 2, spiral: 4 } },
  { throughCycle: Infinity, weights: { single: 1, pair: 2, opposite: 4, halfCircle: 5, circle: 3, spiral: 5 } },
];

interface MutableAnomaly {
  type: AnomalyType;
  remainingMs: number;
}

function freeze<T extends object>(value: T): Readonly<T> {
  return Object.freeze(value);
}

export class CycleDirector {
  private readonly flowEndMs: number;
  private readonly pressureEndMs: number;
  private readonly cycleDurationMs: number;
  private readonly forcedAnomaliesByCycle: Readonly<Record<number, readonly AnomalyType[]>>;

  private cycleNumber = 1;
  private phase: GamePhase = 'flow';
  private elapsedMs = 0;
  private totalActiveMs = 0;
  private awaitingUpgrade = false;
  private bonusRemainingMs: number | null = null;
  private deferredBonus = false;
  private warningAtMs: number | null = null;
  private warning: AnomalyType[] = [];
  private warningRemainingMs = 0;
  private anomalies: MutableAnomaly[] = [];

  public constructor(private readonly random: RandomSource, options: CycleDirectorOptions = {}) {
    const flowMs = options.flowMs ?? FLOW_END_MS;
    const pressureMs = options.pressureMs ?? PRESSURE_END_MS - FLOW_END_MS;
    const surgeMs = options.surgeMs ?? CYCLE_DURATION_MS - PRESSURE_END_MS;
    if (flowMs <= 0 || pressureMs <= 0 || surgeMs <= 0) {
      throw new RangeError('Cycle phase durations must be positive');
    }

    this.flowEndMs = flowMs;
    this.pressureEndMs = flowMs + pressureMs;
    this.cycleDurationMs = flowMs + pressureMs + surgeMs;
    const forcedAnomaliesByCycle = options.forcedAnomaliesByCycle ?? {};
    if (Object.values(forcedAnomaliesByCycle).some((anomalies) => (
      anomalies.includes('reverse') && anomalies.includes('inertia')
    ))) {
      throw new RangeError('reverse and inertia anomalies are incompatible');
    }
    this.forcedAnomaliesByCycle = forcedAnomaliesByCycle;
    this.reset();
  }

  public update(deltaMs: number, modifiers: DirectorModifiers): DirectorTick {
    if (deltaMs < 0) throw new RangeError('deltaMs must not be negative');

    const events: DirectorEvent[] = [];
    let bonusDue = false;
    let remainingMs = deltaMs;
    if (this.bonusRemainingMs === null) this.scheduleNextBonus(modifiers);

    while (remainingMs > 0 && !this.awaitingUpgrade) {
      const boundaryBonusDue = this.processBoundaries(modifiers, events);
      bonusDue ||= boundaryBonusDue;
      if (this.awaitingUpgrade) break;

      const stepMs = Math.min(remainingMs, this.nextBoundaryMs());
      if (stepMs <= 0) throw new Error('Cycle director could not advance');

      this.advance(stepMs);
      remainingMs -= stepMs;
    }

    if (!this.awaitingUpgrade) {
      const boundaryBonusDue = this.processBoundaries(modifiers, events);
      bonusDue ||= boundaryBonusDue;
    }

    return this.frozenTick(events, bonusDue, this.awaitingUpgrade, deltaMs - remainingMs);
  }

  public getSnapshot(): CycleSnapshot {
    const warning = freeze([...this.warning]);
    const anomalies = freeze(this.anomalies.map((anomaly) => freeze<ActiveAnomaly>({ ...anomaly })));

    return freeze<CycleSnapshot>({
      number: this.cycleNumber,
      phase: this.phase,
      elapsedMs: this.elapsedMs,
      durationMs: CYCLE_DURATION_MS,
      progress: Math.min(this.elapsedMs / this.cycleDurationMs, 1),
      warning,
      warningRemainingMs: this.warningRemainingMs,
      anomalies,
    });
  }

  public getWaveProfile(): WaveProfile {
    const activeSeconds = this.totalActiveMs / 1000;
    const speed = Math.min(MAX_FALL_SPEED, 150 + activeSeconds * 1.5);
    const baseInterval = Math.max(MIN_WAVE_INTERVAL_MS, 2700 * Math.exp(-activeSeconds / 150));
    const phaseMultiplier = this.phase === 'pressure' ? 0.78 : this.phase === 'surge' ? 0.52 : 1;
    const forcedPattern = this.phase === 'surge' ? SURGE_PATTERNS[0]! : null;
    const weights = PATTERN_WEIGHTS.find((entry) => this.cycleNumber <= entry.throughCycle)!.weights;

    return freeze<WaveProfile>({
      intervalMs: baseInterval * phaseMultiplier,
      speed,
      patternWeights: freeze({ ...weights }),
      forcedPattern,
      forcedPatternSequence: this.phase === 'surge' ? SURGE_PATTERNS : null,
    });
  }

  public beginNextCycle(): void {
    if (!this.awaitingUpgrade) return;

    this.cycleNumber += 1;
    this.phase = 'flow';
    this.elapsedMs = 0;
    this.awaitingUpgrade = false;
    this.resetAnomalySchedule();
  }

  public reset(): void {
    this.cycleNumber = 1;
    this.phase = 'flow';
    this.elapsedMs = 0;
    this.totalActiveMs = 0;
    this.awaitingUpgrade = false;
    this.deferredBonus = false;
    this.bonusRemainingMs = null;
    this.resetAnomalySchedule();
  }

  private advance(stepMs: number): void {
    this.elapsedMs += stepMs;
    this.totalActiveMs += stepMs;
    if (!this.deferredBonus && this.bonusRemainingMs !== null) this.bonusRemainingMs -= stepMs;
    if (this.warning.length > 0) this.warningRemainingMs -= stepMs;
    for (const anomaly of this.anomalies) anomaly.remainingMs -= stepMs;
  }

  private nextBoundaryMs(): number {
    const boundaries = [this.phaseBoundaryMs() - this.elapsedMs];
    if (this.warningAtMs !== null) boundaries.push(this.warningAtMs - this.elapsedMs);
    if (this.warning.length > 0) boundaries.push(this.warningRemainingMs);
    if (this.anomalies.length > 0) boundaries.push(Math.min(...this.anomalies.map((anomaly) => anomaly.remainingMs)));
    if (!this.deferredBonus && this.bonusRemainingMs !== null) boundaries.push(this.bonusRemainingMs);
    return Math.min(...boundaries.filter((boundary) => boundary > 0));
  }

  private processBoundaries(modifiers: DirectorModifiers, events: DirectorEvent[]): boolean {
    let bonusDue = false;

    if (this.deferredBonus && this.phase === 'flow' && this.elapsedMs > 0) {
      bonusDue = true;
      this.scheduleNextBonus(modifiers);
    }

    if (this.warningAtMs !== null && this.elapsedMs >= this.warningAtMs) {
      this.warning = this.selectAnomalies();
      this.warningAtMs = null;
      this.warningRemainingMs = ANOMALY_WARNING_MS;
      events.push({ type: 'anomalyWarning', anomalies: [...this.warning] });
    } else if (this.warning.length > 0 && this.warningRemainingMs <= 0) {
      this.anomalies = this.warning.map((type) => ({
        type,
        remainingMs: ANOMALY_DURATIONS_MS[type] * modifiers.anomalyDurationMultiplier,
      }));
      this.warning = [];
      events.push({ type: 'anomalyStarted', anomalies: this.anomalies.map((anomaly) => anomaly.type) });
    }

    const expired = this.anomalies.filter((anomaly) => anomaly.remainingMs <= 0).map((anomaly) => anomaly.type);
    if (expired.length > 0) {
      this.anomalies = this.anomalies.filter((anomaly) => anomaly.remainingMs > 0);
      events.push({ type: 'anomalyEnded', anomalies: expired });
    }

    if (this.phase === 'flow' && this.elapsedMs >= this.flowEndMs) {
      this.phase = 'pressure';
      events.push({ type: 'phaseChanged', phase: this.phase, cycle: this.cycleNumber });
    } else if (this.phase === 'pressure' && this.elapsedMs >= this.pressureEndMs) {
      this.phase = 'surge';
      events.push({ type: 'phaseChanged', phase: this.phase, cycle: this.cycleNumber });
    } else if (this.phase === 'surge' && this.elapsedMs >= this.cycleDurationMs) {
      this.awaitingUpgrade = true;
      events.push({ type: 'cycleCompleted', cycle: this.cycleNumber });
    }

    if (!this.deferredBonus && this.bonusRemainingMs !== null && this.bonusRemainingMs <= 0) {
      if (this.phase === 'surge') {
        this.deferredBonus = true;
      } else {
        bonusDue = true;
        this.scheduleNextBonus(modifiers);
      }
    }

    return bonusDue;
  }

  private phaseBoundaryMs(): number {
    if (this.phase === 'flow') return this.flowEndMs;
    if (this.phase === 'pressure') return this.pressureEndMs;
    return this.cycleDurationMs;
  }

  private resetAnomalySchedule(): void {
    this.warningAtMs = null;
    this.warning = [];
    this.warningRemainingMs = 0;
    this.anomalies = [];
    if (this.cycleNumber >= 2) {
      this.warningAtMs = 20_000 + Math.floor(this.random.next() * 8_001);
    }
  }

  private selectAnomalies(): AnomalyType[] {
    const forced = this.forcedAnomaliesByCycle[this.cycleNumber];
    if (forced) return [...forced];

    if (this.cycleNumber >= 6 && this.random.next() < 0.45) {
      return [...COMPATIBLE_ANOMALY_PAIRS[Math.floor(this.random.next() * COMPATIBLE_ANOMALY_PAIRS.length)]!];
    }
    return [ANOMALIES[Math.floor(this.random.next() * ANOMALIES.length)]!];
  }

  private scheduleNextBonus(modifiers: DirectorModifiers): void {
    const sampledIntervalMs = 28_000 + Math.floor(this.random.next() * 14_001);
    this.bonusRemainingMs = Math.max(16_000, sampledIntervalMs * modifiers.bonusIntervalMultiplier);
    this.deferredBonus = false;
  }

  private frozenTick(
    events: readonly DirectorEvent[],
    bonusDue: boolean,
    upgradeDue: boolean,
    consumedMs: number,
  ): DirectorTick {
    const frozenEvents = freeze(events.map((event) => {
      if ('anomalies' in event) return freeze({ ...event, anomalies: freeze([...event.anomalies]) });
      return freeze({ ...event });
    }));
    return freeze<DirectorTick>({ events: frozenEvents, bonusDue, upgradeDue, consumedMs });
  }
}
