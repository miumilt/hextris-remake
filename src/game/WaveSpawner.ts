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

function buildPattern(pattern: WavePattern, anchor: number, colorIndexes: readonly number[]): PatternEntry[] {
  if (colorIndexes.length === 0) {
    throw new RangeError('colorIndexes must not be empty');
  }

  return OFFSETS[pattern].map((offset, index) => ({
    lane: normalizeLane(anchor + offset),
    color: BLOCK_COLORS[colorIndexes[index % colorIndexes.length]! % BLOCK_COLORS.length]!,
    delayMs: pattern === 'spiral' ? index * 160 : 0,
  }));
}

export class WaveSpawner {
  private intervalElapsedMs = 0;
  private pending: PatternEntry[] = [];

  public constructor(private readonly random: RandomSource) {}

  public createPattern(
    pattern: WavePattern,
    anchor: number,
    colorIndexes: readonly number[],
  ): PatternEntry[] {
    return buildPattern(pattern, anchor, colorIndexes);
  }

  public update(deltaMs: number, profile: WaveProfile): readonly SpawnRequest[] {
    const ready = this.releaseReady(deltaMs, profile.speed);
    this.intervalElapsedMs += deltaMs;
    while (this.intervalElapsedMs >= profile.intervalMs) {
      this.intervalElapsedMs -= profile.intervalMs;
      this.scheduleWave(profile);
    }

    return Object.freeze(ready.concat(this.releaseReady(0, profile.speed)));
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
    const pattern = profile.forcedPattern ?? this.selectPattern(profile);
    const anchor = Math.floor(this.random.next() * SIDE_COUNT);
    const colorIndexes = OFFSETS[pattern].map(() => Math.floor(this.random.next() * BLOCK_COLORS.length));

    this.pending.push(...this.createPattern(pattern, anchor, colorIndexes));
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
