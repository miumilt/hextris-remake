import { BLOCK_COLORS, SIDE_COUNT } from './constants';
import type { BlockColor } from './types';
import type { RandomSource } from './random';
import type { WaveProfile } from './progressionTypes';

export type WavePattern = 'single' | 'pair' | 'opposite' | 'halfCircle' | 'circle' | 'spiral';

export interface SpawnRequest {
  lane: number;
  color: BlockColor;
  speed: number;
}

export interface PatternEntry {
  lane: number;
  color: BlockColor;
  delayMs: number;
}

const OFFSETS: Record<WavePattern, readonly number[]> = {
  single: [0],
  pair: [0, 1],
  opposite: [0, 3],
  halfCircle: [0, 1, 2],
  circle: [0, 1, 2, 3, 4, 5],
  spiral: [0, 1, 2, 3, 4, 5],
};

const WAVE_PATTERNS: readonly WavePattern[] = [
  'single',
  'pair',
  'opposite',
  'halfCircle',
  'circle',
  'spiral',
];
function normalizeLane(lane: number): number {
  return ((lane % SIDE_COUNT) + SIDE_COUNT) % SIDE_COUNT;
}

export function patternLayout(pattern: WavePattern, anchor: number): readonly { readonly lane: number; readonly delayMs: number }[] {
  return OFFSETS[pattern].map((offset, index) => ({
    lane: normalizeLane(anchor + offset),
    delayMs: pattern === 'spiral' ? index * 160 : 0,
  }));
}

function buildPattern(pattern: WavePattern, anchor: number, colorIndexes: readonly number[]): PatternEntry[] {
  if (colorIndexes.length === 0) {
    throw new RangeError('colorIndexes must not be empty');
  }

  return patternLayout(pattern, anchor).map((entry, index) => ({
    ...entry,
    color: BLOCK_COLORS[colorIndexes[index % colorIndexes.length]! % BLOCK_COLORS.length]!,
  }));
}

export class WaveSpawner {
  private waveRemainingMs: number | null = null;
  private pending: PatternEntry[] = [];
  private forcedSequenceActive = false;
  private forcedSequenceIndex = 0;

  public constructor(private readonly random: RandomSource) {}

  public createPattern(
    pattern: WavePattern,
    anchor: number,
    colorIndexes: readonly number[],
  ): PatternEntry[] {
    return buildPattern(pattern, anchor, colorIndexes);
  }

  public getNextEventMs(profile: WaveProfile): number {
    this.validateProfile(profile);
    this.syncForcedSequence(profile);
    this.waveRemainingMs ??= profile.intervalMs;
    const untilPending = this.pending.length === 0
      ? Number.POSITIVE_INFINITY
      : Math.min(...this.pending.map((entry) => entry.delayMs));
    return Math.min(this.waveRemainingMs, untilPending);
  }

  public update(deltaMs: number, profile: WaveProfile): readonly SpawnRequest[] {
    if (deltaMs < 0 || !Number.isFinite(deltaMs)) throw new RangeError('deltaMs must be finite and non-negative');
    this.validateProfile(profile);
    this.syncForcedSequence(profile);
    this.waveRemainingMs ??= profile.intervalMs;

    const ready = this.releaseReady(0, profile.speed);
    let remainingMs = deltaMs;
    while (remainingMs > 0) {
      const untilPending = this.pending.length === 0
        ? Number.POSITIVE_INFINITY
        : Math.min(...this.pending.map((entry) => entry.delayMs));
      const stepMs = Math.min(remainingMs, this.waveRemainingMs, untilPending);

      if (stepMs > 0) {
        ready.push(...this.releaseReady(stepMs, profile.speed));
        this.waveRemainingMs -= stepMs;
        remainingMs -= stepMs;
      }

      if (this.waveRemainingMs <= 0) {
        this.scheduleWave(profile);
        this.waveRemainingMs = profile.intervalMs;
        ready.push(...this.releaseReady(0, profile.speed));
      } else if (stepMs <= 0) {
        throw new Error('Wave spawner could not advance');
      }
    }

    return Object.freeze(ready);
  }

  private releaseReady(deltaMs: number, speed: number): SpawnRequest[] {
    const ready: SpawnRequest[] = [];
    const pending: PatternEntry[] = [];

    for (const entry of this.pending) {
      const delayMs = entry.delayMs - deltaMs;
      if (delayMs <= 0) {
        ready.push({ lane: entry.lane, color: entry.color, speed });
      } else {
        pending.push({ ...entry, delayMs });
      }
    }

    this.pending = pending;
    return ready;
  }

  private scheduleWave(profile: WaveProfile): void {
    const sequence = profile.forcedPatternSequence;
    const pattern = sequence !== null && sequence.length > 0
      ? sequence[this.forcedSequenceIndex++ % sequence.length]!
      : profile.forcedPattern ?? this.selectPattern(profile);
    const anchor = Math.floor(this.random.next() * SIDE_COUNT);
    const colorIndexes = OFFSETS[pattern].map(() => Math.floor(this.random.next() * BLOCK_COLORS.length));

    this.pending.push(...this.createPattern(pattern, anchor, colorIndexes));
  }

  private syncForcedSequence(profile: WaveProfile): void {
    if (profile.forcedPatternSequence === null) {
      this.forcedSequenceActive = false;
      this.forcedSequenceIndex = 0;
    } else if (!this.forcedSequenceActive) {
      this.forcedSequenceActive = true;
      this.forcedSequenceIndex = 0;
    }
  }

  private validateProfile(profile: WaveProfile): void {
    if (profile.intervalMs <= 0 || !Number.isFinite(profile.intervalMs)) {
      throw new RangeError('intervalMs must be finite and positive');
    }
  }

  private selectPattern(profile: WaveProfile): WavePattern {
    const weighted = WAVE_PATTERNS
      .map((pattern) => ({ pattern, weight: profile.patternWeights[pattern] }))
      .filter((entry) => entry.weight > 0);
    const total = weighted.reduce((sum, entry) => sum + entry.weight, 0);
    if (total <= 0) throw new RangeError('At least one pattern weight must be positive');

    const sample = this.random.next() * total;
    let threshold = 0;
    for (const entry of weighted) {
      threshold += entry.weight;
      if (sample < threshold) return entry.pattern;
    }
    return weighted[weighted.length - 1]!.pattern;
  }
}
