import {
  BUILD_END_MS, CYCLE_DURATION_MS, MAX_FALL_SPEED, MIN_WAVE_INTERVAL_MS,
  PRESSURE_END_MS, SETTLE_END_MS, SINGLE_ANOMALY_WARNING_MS,
} from './constants';
import type {
  ActiveAnomaly, AnomalyType, CycleSnapshot, DirectorEvent, DirectorModifiers,
  DirectorTick, GamePhase, WaveProfile,
} from './progressionTypes';
import type { RandomSource } from './random';
import type { WavePattern } from './WaveSpawner';

export interface ThreatDirectorOptions {
  readonly forcedAnomaliesByCycle?: Readonly<Record<number, readonly AnomalyType[]>>;
}

export const ANOMALY_DURATION_MS: Readonly<Record<AnomalyType, number>> = {
  reverse: 9_000, mirage: 10_000, drift: 12_000, colorShift: 10_000, inertia: 8_000,
};

const ANOMALIES: readonly AnomalyType[] = ['reverse', 'mirage', 'drift', 'colorShift', 'inertia'];
const COMPATIBLE_ANOMALY_PAIRS: readonly (readonly [AnomalyType, AnomalyType])[] = [
  ['reverse', 'mirage'], ['reverse', 'drift'], ['reverse', 'colorShift'],
  ['mirage', 'drift'], ['mirage', 'colorShift'], ['mirage', 'inertia'],
  ['drift', 'colorShift'], ['drift', 'inertia'], ['colorShift', 'inertia'],
];
const PATTERN_WEIGHTS: readonly {
  readonly throughCycle: number;
  readonly weights: Readonly<Record<WavePattern, number>>;
}[] = [
  { throughCycle: 2, weights: { single: 6, pair: 4, opposite: 2, halfCircle: 1, circle: 0, spiral: 1 } },
  { throughCycle: 5, weights: { single: 4, pair: 4, opposite: 3, halfCircle: 3, circle: 1, spiral: 3 } },
  { throughCycle: 8, weights: { single: 2, pair: 3, opposite: 4, halfCircle: 4, circle: 2, spiral: 4 } },
  { throughCycle: Infinity, weights: { single: 1, pair: 2, opposite: 4, halfCircle: 5, circle: 3, spiral: 5 } },
];
const PHASE_INTERVAL_MULTIPLIER: Readonly<Record<GamePhase, number>> = {
  settle: 1, build: 1, pressure: 0.9, release: 1.8,
};

interface MutableAnomaly { type: AnomalyType; remainingMs: number; }

const freeze = <T extends object>(value: T): Readonly<T> => Object.freeze(value);
const phaseAt = (elapsedMs: number): GamePhase => {
  if (elapsedMs < SETTLE_END_MS) return 'settle';
  if (elapsedMs < BUILD_END_MS) return 'build';
  if (elapsedMs < PRESSURE_END_MS) return 'pressure';
  return 'release';
};
const baseSpeedAt = (activeMs: number): number => {
  const seconds = activeMs / 1000;
  return Math.min(MAX_FALL_SPEED, 150 + 450 * (1 - Math.exp(-seconds / 300)));
};
const baseIntervalAt = (activeMs: number): number => {
  const seconds = activeMs / 1000;
  return Math.max(MIN_WAVE_INTERVAL_MS, 500 + 2100 * Math.exp(-seconds / 180));
};

/** Deterministic owner of phase pacing and active-time difficulty curves. */
export class ThreatDirector {
  private cycleNumber = 1;
  private phase: GamePhase = 'settle';
  private elapsedMs = 0;
  private totalActiveMs = 0;
  private awaitingUpgrade = false;
  private bonusRemainingMs: number | null = null;
  private deferredBonus = false;
  private warningAtMs: number | null = null;
  private warning: AnomalyType[] = [];
  private warningRemainingMs = 0;
  private anomalies: MutableAnomaly[] = [];
  private readonly forcedAnomaliesByCycle: Readonly<Record<number, readonly AnomalyType[]>>;

  public constructor(private readonly random: RandomSource, options: ThreatDirectorOptions = {}) {
    const forced = options.forcedAnomaliesByCycle ?? {};
    if (Object.values(forced).some((anomalies) => anomalies.includes('reverse') && anomalies.includes('inertia'))) {
      throw new RangeError('reverse and inertia anomalies are incompatible');
    }
    this.forcedAnomaliesByCycle = forced;
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
      if (stepMs <= 0) throw new Error('Threat director could not advance');
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
    return freeze<CycleSnapshot>({
      number: this.cycleNumber,
      phase: this.phase,
      elapsedMs: this.elapsedMs,
      totalActiveMs: this.totalActiveMs,
      durationMs: CYCLE_DURATION_MS,
      progress: Math.min(this.elapsedMs / CYCLE_DURATION_MS, 1),
      warning: freeze([...this.warning]),
      warningRemainingMs: this.warningRemainingMs,
      anomalies: freeze(this.anomalies.map((anomaly) => freeze<ActiveAnomaly>({ ...anomaly }))),
      threat: null,
    });
  }

  public getWaveProfile(): WaveProfile {
    const intervalMs = Math.max(
      MIN_WAVE_INTERVAL_MS,
      baseIntervalAt(this.totalActiveMs) * PHASE_INTERVAL_MULTIPLIER[this.phase],
    );
    return freeze<WaveProfile>({
      intervalMs,
      speed: baseSpeedAt(this.totalActiveMs),
      patternWeights: freeze({ ...this.patternWeights() }),
      forcedPattern: null,
      forcedPatternSequence: null,
    });
  }

  public getNextEventMs(modifiers: DirectorModifiers): number {
    if (this.awaitingUpgrade) return 0;
    if (this.bonusRemainingMs === null) this.scheduleNextBonus(modifiers);
    return this.nextBoundaryMs();
  }

  public beginNextCycle(): void {
    if (!this.awaitingUpgrade) return;
    this.cycleNumber += 1;
    this.startCycle();
    this.awaitingUpgrade = false;
  }

  public reset(): void {
    this.cycleNumber = 1;
    this.totalActiveMs = 0;
    this.awaitingUpgrade = false;
    this.bonusRemainingMs = null;
    this.deferredBonus = false;
    this.startCycle();
  }

  private startCycle(): void {
    this.phase = 'settle';
    this.elapsedMs = 0;
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
    if (this.anomalies.length > 0) boundaries.push(Math.min(...this.anomalies.map(({ remainingMs }) => remainingMs)));
    if (!this.deferredBonus && this.bonusRemainingMs !== null) boundaries.push(this.bonusRemainingMs);
    return Math.min(...boundaries.filter((boundary) => boundary > 0));
  }

  private processBoundaries(modifiers: DirectorModifiers, events: DirectorEvent[]): boolean {
    let bonusDue = false;
    if (this.deferredBonus && this.phase === 'settle' && this.elapsedMs > 0) {
      bonusDue = true;
      this.scheduleNextBonus(modifiers);
    }
    if (this.warningAtMs !== null && this.elapsedMs >= this.warningAtMs) {
      this.warning = this.selectAnomalies();
      this.warningAtMs = null;
      this.warningRemainingMs = SINGLE_ANOMALY_WARNING_MS;
      events.push({ type: 'anomalyWarning', anomalies: [...this.warning] });
    } else if (this.warning.length > 0 && this.warningRemainingMs <= 0) {
      this.anomalies = this.warning.map((type) => ({
        type,
        remainingMs: Math.max(4_000, ANOMALY_DURATION_MS[type] * modifiers.anomalyDurationMultiplier),
      }));
      this.warning = [];
      events.push({ type: 'anomalyStarted', anomalies: this.anomalies.map(({ type }) => type) });
    }
    const expired = this.anomalies.filter(({ remainingMs }) => remainingMs <= 0).map(({ type }) => type);
    if (expired.length > 0) {
      this.anomalies = this.anomalies.filter(({ remainingMs }) => remainingMs > 0);
      events.push({ type: 'anomalyEnded', anomalies: expired });
    }

    const nextPhase = phaseAt(this.elapsedMs);
    if (nextPhase !== this.phase) {
      this.phase = nextPhase;
      events.push({ type: 'phaseChanged', phase: this.phase, cycle: this.cycleNumber });
    }
    if (this.elapsedMs >= CYCLE_DURATION_MS) {
      events.push({ type: 'cycleCompleted', cycle: this.cycleNumber });
      if (this.cycleNumber % 3 === 0) this.awaitingUpgrade = true;
      else {
        this.cycleNumber += 1;
        this.startCycle();
      }
    }
    if (!this.deferredBonus && this.bonusRemainingMs !== null && this.bonusRemainingMs <= 0) {
      if (this.phase === 'release') this.deferredBonus = true;
      else {
        bonusDue = true;
        this.scheduleNextBonus(modifiers);
      }
    }
    return bonusDue;
  }

  private phaseBoundaryMs(): number {
    if (this.phase === 'settle') return SETTLE_END_MS;
    if (this.phase === 'build') return BUILD_END_MS;
    if (this.phase === 'pressure') return PRESSURE_END_MS;
    return CYCLE_DURATION_MS;
  }

  private resetAnomalySchedule(): void {
    this.warningAtMs = null;
    this.warning = [];
    this.warningRemainingMs = 0;
    this.anomalies = [];
    if (this.cycleNumber >= 2) this.warningAtMs = 20_000 + Math.floor(this.random.next() * 8_001);
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

  private patternWeights(): Readonly<Record<WavePattern, number>> {
    return PATTERN_WEIGHTS.find(({ throughCycle }) => this.cycleNumber <= throughCycle)!.weights;
  }

  private frozenTick(events: readonly DirectorEvent[], bonusDue: boolean, upgradeDue: boolean, consumedMs: number): DirectorTick {
    const frozenEvents = freeze(events.map((event) => (
      'anomalies' in event ? freeze({ ...event, anomalies: freeze([...event.anomalies]) }) : freeze({ ...event })
    )));
    return freeze<DirectorTick>({ events: frozenEvents, bonusDue, upgradeDue, consumedMs });
  }
}
