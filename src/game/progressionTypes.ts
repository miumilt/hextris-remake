import type { BlockColor } from './types';
import type { WavePattern } from './WaveSpawner';

export type GamePhase = 'settle' | 'build' | 'pressure' | 'release';
export type AnomalyType = 'reverse' | 'mirage' | 'drift' | 'colorShift' | 'inertia';
export type BonusType = 'slow' | 'pulse' | 'cleanse' | 'colorBreak';
export type UpgradeId = 'stabilizer' | 'comboRelay' | 'salvage' | 'deepPulse' | 'anomalyShield' | 'lastStand';

export interface UpgradeChoice {
  readonly id: UpgradeId;
  readonly level: number;
  readonly maxLevel: number;
  readonly label: string;
  readonly description: string;
}

export interface UpgradeSnapshot {
  readonly levels: Readonly<Record<UpgradeId, number>>;
  readonly choices: readonly UpgradeChoice[];
  readonly selectedIndex: number;
}

export interface UpgradeModifiers {
  readonly speedMultiplier: number;
  readonly comboWindowBonusMs: number;
  readonly bonusIntervalMultiplier: number;
  readonly pulseSides: number;
  readonly anomalyDurationMultiplier: number;
  readonly hasLastStand: boolean;
}

export interface UpgradeOffer {
  readonly choices: readonly UpgradeChoice[];
  readonly selectedIndex: number;
}

export interface DirectorModifiers {
  readonly anomalyDurationMultiplier: number;
  readonly bonusIntervalMultiplier: number;
}

export interface WaveProfile {
  readonly intervalMs: number;
  readonly speed: number;
  readonly patternWeights: Readonly<Record<WavePattern, number>>;
  readonly forcedPattern: WavePattern | null;
  readonly forcedPatternSequence: readonly WavePattern[] | null;
}

export interface ThreatEvidence {
  readonly seedCycle: number;
  readonly phase: GamePhase;
  readonly budget: number;
  readonly spent: number;
  readonly combinationKey: string;
}

export interface ThreatPlan {
  readonly pattern: WavePattern;
  readonly anchorLane: number;
  readonly lanes: readonly number[];
  readonly anomalies: readonly AnomalyType[];
  readonly warningMs: number;
  readonly entryDelayMs: number;
  readonly bonusIncompatible: boolean;
  readonly evidence: ThreatEvidence;
}

export type DirectorEvent =
  | { readonly type: 'phaseChanged'; readonly phase: GamePhase; readonly cycle: number }
  | { readonly type: 'anomalyWarning'; readonly anomalies: readonly AnomalyType[] }
  | { readonly type: 'anomalyStarted'; readonly anomalies: readonly AnomalyType[] }
  | { readonly type: 'anomalyEnded'; readonly anomalies: readonly AnomalyType[] }
  | { readonly type: 'cycleCompleted'; readonly cycle: number };

export interface DirectorTick {
  readonly events: readonly DirectorEvent[];
  readonly bonusDue: boolean;
  readonly upgradeDue: boolean;
  readonly consumedMs: number;
}

export interface ActiveAnomaly {
  readonly type: AnomalyType;
  readonly remainingMs: number;
}

export interface CycleSnapshot {
  readonly number: number;
  readonly phase: GamePhase;
  readonly elapsedMs: number;
  readonly totalActiveMs: number;
  readonly durationMs: 75_000;
  readonly progress: number;
  readonly warning: readonly AnomalyType[];
  readonly warningRemainingMs: number;
  readonly anomalies: readonly ActiveAnomaly[];
  readonly threat: ThreatPlan | null;
}

export interface BonusRemoval {
  readonly type: BonusType;
  readonly cells: readonly { readonly side: number; readonly index: number }[];
  readonly color?: BlockColor;
}

export interface FallingBonus {
  readonly id: number;
  readonly type: BonusType;
  readonly lane: number;
  readonly distance: number;
  readonly speed: number;
}

export interface BonusSnapshot {
  readonly stored: BonusType | null;
  readonly slowRemainingMs: number;
}

export interface BonusCollection {
  readonly collected: BonusType;
  readonly replaced: BonusType | null;
}

export interface BonusActivation extends BonusRemoval {
  readonly scoreDelta: number;
}
