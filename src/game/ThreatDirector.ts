import {
  BUILD_END_MS, CYCLE_DURATION_MS, MAX_FALL_SPEED, MIN_WAVE_INTERVAL_MS,
  PRESSURE_END_MS, SETTLE_END_MS, SIDE_COUNT, SINGLE_ANOMALY_WARNING_MS,
} from './constants';
import type {
  ActiveAnomaly, AnomalyType, CycleSnapshot, DirectorEvent, DirectorModifiers,
  DirectorTick, GamePhase, ThreatPlan, ThreatRequest, WaveProfile,
} from './progressionTypes';
import type { RandomSource } from './random';
import { patternLayout, type WavePattern } from './WaveSpawner';

export interface ThreatDirectorOptions {
  readonly forcedSituationsByCycle?: Readonly<Record<number, ThreatRequest>>;
  /** Compatibility for legacy test fixtures; the same fairness gates apply. */
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
const PATTERN_COST: Readonly<Record<WavePattern, number>> = {
  single: 1, pair: 2, opposite: 2, halfCircle: 3, spiral: 4, circle: 5,
};
const ANOMALY_COST: Readonly<Record<AnomalyType, number>> = {
  mirage: 2, drift: 2, colorShift: 2, reverse: 3, inertia: 3,
};
const PHASE_BUDGET: Readonly<Record<GamePhase, number>> = { settle: 3, build: 6, pressure: 9, release: 0 };
const WEAK_ANOMALIES = new Set<AnomalyType>(['mirage', 'drift', 'colorShift']);
const PATTERNS = Object.keys(PATTERN_COST) as WavePattern[];
const planCost = (request: ThreatRequest): number => PATTERN_COST[request.pattern]
  + request.anomalies.reduce((sum, anomaly) => sum + ANOMALY_COST[anomaly], 0)
  + (request.anomalies.length === 2 ? 2 : 0);
const combinationKey = (request: ThreatRequest): string =>
  `${request.pattern}:${ANOMALIES.filter((type) => request.anomalies.includes(type)).join('+')}`;
const budgetAt = (phase: GamePhase, activeMs: number): number =>
  PHASE_BUDGET[phase] + Math.min(3, Math.floor(activeMs / 180_000));
const preparedAt = (cycle: number): number => (cycle - 1) * CYCLE_DURATION_MS + SETTLE_END_MS;

function legalRequest(request: ThreatRequest, phase: GamePhase, activeMs: number): boolean {
  const { anomalies, pattern } = request;
  if (!PATTERNS.includes(pattern) || anomalies.some((type) => !ANOMALIES.includes(type))) return false;
  if (request.anchorLane !== undefined && (!Number.isInteger(request.anchorLane) || request.anchorLane < 0 || request.anchorLane >= SIDE_COUNT)) return false;
  if (anomalies.length > 2 || new Set(anomalies).size !== anomalies.length) return false;
  if (phase === 'release') return anomalies.length === 0 && pattern === 'single';
  if (activeMs < 90_000 && anomalies.length > 0) return false;
  if (activeMs < 360_000 && anomalies.length > 1) return false;
  if (anomalies.includes('reverse') && anomalies.includes('inertia')) return false;
  if (anomalies.length === 2 && (pattern === 'circle' || pattern === 'spiral')) return false;
  const immediateByLane = new Map<number, number>();
  for (const entry of patternLayout(pattern, request.anchorLane ?? 0)) {
    if (entry.delayMs !== 0) continue;
    const count = (immediateByLane.get(entry.lane) ?? 0) + 1;
    if (count > 2) return false;
    immediateByLane.set(entry.lane, count);
  }
  return planCost(request) <= budgetAt(phase, activeMs);
}
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
const canonicalMs = (value: number): number => {
  const integer = Math.round(value);
  if (Math.abs(value - integer) < 1e-9) return integer;
  return Math.round(value * 1e9) / 1e9;
};
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
  private currentThreat: ThreatPlan | null = null;
  private lastPressureCombination: string | null = null;
  private readonly anomalyCooldowns = new Map<AnomalyType, number>();
  private readonly forcedSituationsByCycle: Readonly<Record<number, ThreatRequest>>;

  public constructor(private readonly random: RandomSource, options: ThreatDirectorOptions = {}) {
    const forced: Record<number, ThreatRequest> = {};
    for (const [cycle, anomalies] of Object.entries(options.forcedAnomaliesByCycle ?? {})) {
      forced[Number(cycle)] = { pattern: 'single', anomalies };
    }
    Object.assign(forced, options.forcedSituationsByCycle);
    for (const [key, request] of Object.entries(forced)) {
      const cycle = Number(key);
      if (!Number.isInteger(cycle) || cycle < 1 || !legalRequest(request, 'pressure', preparedAt(cycle))) {
        throw new RangeError(`Illegal threat request for cycle ${cycle}`);
      }
      const previous = forced[cycle - 1];
      if (previous && (combinationKey(previous) === combinationKey(request)
        || request.anomalies.some((type) => previous.anomalies.includes(type)))) {
        throw new RangeError(`Threat cooldown violated in cycle ${cycle}`);
      }
      forced[cycle] = freeze({ ...request, anomalies: freeze([...request.anomalies]) });
    }
    this.forcedSituationsByCycle = freeze(forced);
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
      threat: this.currentThreat,
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
      forcedPattern: this.phase === 'release' ? 'single' : this.phase === 'pressure' ? this.currentThreat!.pattern : null,
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
    this.anomalyCooldowns.clear();
    this.lastPressureCombination = null;
    this.startCycle();
  }

  private startCycle(): void {
    this.phase = 'settle';
    this.elapsedMs = 0;
    this.currentThreat = this.prepareThreat();
    this.resetAnomalySchedule();
  }

  private advance(stepMs: number): void {
    this.elapsedMs = canonicalMs(this.elapsedMs + stepMs);
    this.totalActiveMs = canonicalMs((this.cycleNumber - 1) * CYCLE_DURATION_MS + this.elapsedMs);
    if (!this.deferredBonus && this.bonusRemainingMs !== null) this.bonusRemainingMs = canonicalMs(this.bonusRemainingMs - stepMs);
    if (this.warning.length > 0) this.warningRemainingMs = canonicalMs(this.warningRemainingMs - stepMs);
    for (const anomaly of this.anomalies) anomaly.remainingMs = canonicalMs(anomaly.remainingMs - stepMs);
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
    if (this.warningAtMs !== null && this.elapsedMs >= this.warningAtMs) {
      this.warning = [...this.currentThreat!.anomalies];
      this.warningAtMs = null;
      this.warningRemainingMs = this.currentThreat!.warningMs;
      events.push({ type: 'anomalyWarning', anomalies: [...this.warning], lanes: this.currentThreat!.lanes,
        warningMs: this.warningRemainingMs, atActiveMs: this.totalActiveMs });
    } else if (this.warning.length > 0 && this.warningRemainingMs <= 0) {
      this.anomalies = this.warning.map((type) => ({
        type,
        remainingMs: Math.max(4_000, ANOMALY_DURATION_MS[type] * modifiers.anomalyDurationMultiplier),
      }));
      this.warning = [];
      events.push({ type: 'anomalyStarted', anomalies: this.anomalies.map(({ type }) => type),
        lanes: this.currentThreat!.lanes, atActiveMs: this.totalActiveMs });
    }
    const expired = this.anomalies.filter(({ remainingMs }) => remainingMs <= 0).map(({ type }) => type);
    if (expired.length > 0) {
      this.anomalies = this.anomalies.filter(({ remainingMs }) => remainingMs > 0);
      events.push({ type: 'anomalyEnded', anomalies: expired, atActiveMs: this.totalActiveMs });
    }

    const nextPhase = phaseAt(this.elapsedMs);
    if (nextPhase !== this.phase) {
      this.phase = nextPhase;
      events.push({ type: 'phaseChanged', phase: this.phase, cycle: this.cycleNumber, atActiveMs: this.totalActiveMs });
      if (this.phase === 'build') {
        events.push({ type: 'situationPrepared', plan: this.currentThreat!, atActiveMs: this.totalActiveMs });
      } else if (this.phase === 'release') {
        if (this.anomalies.length > 0) events.push({ type: 'anomalyEnded',
          anomalies: this.anomalies.map(({ type }) => type), atActiveMs: this.totalActiveMs });
        this.currentThreat = null;
        this.resetAnomalySchedule();
      }
    }
    if (this.elapsedMs >= CYCLE_DURATION_MS) {
      events.push({ type: 'cycleCompleted', cycle: this.cycleNumber, atActiveMs: this.totalActiveMs });
      if (this.cycleNumber % 3 === 0) this.awaitingUpgrade = true;
      else {
        this.cycleNumber += 1;
        this.startCycle();
      }
    }
    if (this.deferredBonus && this.phase === 'settle') {
      bonusDue = true;
      this.scheduleNextBonus(modifiers);
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
    if (this.currentThreat && this.currentThreat.anomalies.length > 0) this.warningAtMs = 42_000;
  }

  private prepareThreat(): ThreatPlan {
    const activeMs = preparedAt(this.cycleNumber);
    const forced = this.forcedSituationsByCycle[this.cycleNumber];
    const anomalySets: readonly (readonly AnomalyType[])[] = activeMs < 90_000
      ? [[]] : [...ANOMALIES.map((type) => [type]), ...COMPATIBLE_ANOMALY_PAIRS];
    const candidates: readonly ThreatRequest[] = forced ? [forced]
      : PATTERNS.flatMap((pattern) => anomalySets.map((anomalies) => ({ pattern, anomalies })));
    const nextForced = this.forcedSituationsByCycle[this.cycleNumber + 1];
    const legal = candidates.filter((request) => legalRequest(request, 'pressure', activeMs)
      && combinationKey(request) !== this.lastPressureCombination
      && !request.anomalies.some((type) => this.anomalyCooldowns.get(type) === this.cycleNumber - 1)
      && (!nextForced || (combinationKey(request) !== combinationKey(nextForced)
        && !request.anomalies.some((type) => nextForced.anomalies.includes(type)))));
    if (legal.length === 0) throw new RangeError(`No legal threat for cycle ${this.cycleNumber}`);
    const request = legal[Math.floor(this.random.next() * legal.length)]!;
    const anchorLane = request.anchorLane ?? Math.floor(this.random.next() * SIDE_COUNT);
    const lanes = freeze(patternLayout(request.pattern, anchorLane).map(({ lane }) => lane));
    const key = combinationKey(request);
    this.lastPressureCombination = key;
    for (const anomaly of request.anomalies) this.anomalyCooldowns.set(anomaly, this.cycleNumber);
    const entryDelayMs = PATTERN_COST[request.pattern] >= 4
      && request.anomalies.some((type) => !WEAK_ANOMALIES.has(type)) ? 450 : 0;
    return freeze({
      pattern: request.pattern, anchorLane, lanes, anomalies: freeze([...request.anomalies]),
      warningMs: request.anomalies.length === 2 ? 3_200 : request.anomalies.length === 1 ? SINGLE_ANOMALY_WARNING_MS : 0,
      entryDelayMs, bonusIncompatible: request.anomalies.length === 2 || entryDelayMs > 0,
      evidence: freeze({ seedCycle: this.cycleNumber, phase: 'pressure', budget: budgetAt('pressure', activeMs),
        spent: planCost(request), combinationKey: key }),
    });
  }

  private scheduleNextBonus(modifiers: DirectorModifiers): void {
    const sampledIntervalMs = 28_000 + Math.floor(this.random.next() * 14_001);
    this.bonusRemainingMs = Math.max(16_000, sampledIntervalMs * modifiers.bonusIntervalMultiplier);
    this.deferredBonus = false;
  }

  private patternWeights(): Readonly<Record<WavePattern, number>> {
    const weights = { ...PATTERN_WEIGHTS.find(({ throughCycle }) => this.cycleNumber <= throughCycle)!.weights };
    for (const pattern of PATTERNS) {
      if (this.phase === 'release' || (this.phase === 'settle' && PATTERN_COST[pattern] > 2)
        || (this.phase === 'build' && pattern === 'circle')) weights[pattern] = 0;
    }
    if (this.phase === 'release') weights.single = 1;
    return weights;
  }

  private frozenTick(events: readonly DirectorEvent[], bonusDue: boolean, upgradeDue: boolean, consumedMs: number): DirectorTick {
    const frozenEvents = freeze(events.map((event) => (
      'anomalies' in event ? freeze({ ...event, anomalies: freeze([...event.anomalies]) }) : freeze({ ...event })
    )));
    return freeze<DirectorTick>({ events: frozenEvents, bonusDue, upgradeDue, consumedMs });
  }
}
