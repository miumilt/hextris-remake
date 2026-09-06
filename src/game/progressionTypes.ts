import type { BlockColor } from './types';
import type { WavePattern } from './WaveSpawner';

export type GamePhase = 'flow' | 'pressure' | 'surge';
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
}

export interface ActiveAnomaly {
  readonly type: AnomalyType;
  readonly remainingMs: number;
}

export interface CycleSnapshot {
  readonly number: number;
  readonly phase: GamePhase;
  readonly elapsedMs: number;
  readonly durationMs: 55_000;
  readonly progress: number;
  readonly warning: readonly AnomalyType[];
  readonly warningRemainingMs: number;
  readonly anomalies: readonly ActiveAnomaly[];
}

export interface BonusRemoval {
  readonly type: BonusType;
  readonly cells: readonly { readonly side: number; readonly index: number }[];
  readonly color?: BlockColor;
}
