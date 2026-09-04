import { BLOCK_COLORS, SIDE_COUNT } from './constants';
import type { BlockColor } from './types';
import type { RandomSource } from './random';

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
const START_INTERVAL_MS = 2700;
const MIN_INTERVAL_MS = 600;
const START_SPEED = 150;
const MAX_SPEED = 420;
const DIFFICULTY_RAMP_MS = 180_000;

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
  public intervalMs = START_INTERVAL_MS;
  public speed = START_SPEED;

  private elapsedMs = 0;
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

  public update(deltaMs: number): SpawnRequest[] {
    this.elapsedMs += deltaMs;
    this.updateDifficulty();

    const ready = this.releaseReady(deltaMs);
    this.intervalElapsedMs += deltaMs;
    while (this.intervalElapsedMs >= this.intervalMs) {
      this.intervalElapsedMs -= this.intervalMs;
      this.scheduleWave();
    }

    return ready.concat(this.releaseReady(0));
  }

  private updateDifficulty(): void {
    const progress = Math.min(this.elapsedMs / DIFFICULTY_RAMP_MS, 1);
    this.intervalMs = START_INTERVAL_MS - (START_INTERVAL_MS - MIN_INTERVAL_MS) * progress;
    this.speed = START_SPEED + (MAX_SPEED - START_SPEED) * progress;
  }

  private releaseReady(deltaMs: number): SpawnRequest[] {
    const ready: SpawnRequest[] = [];
    const pending: PatternEntry[] = [];

    for (const entry of this.pending) {
      const delayMs = entry.delayMs - deltaMs;
      if (delayMs <= 0) {
        ready.push({ lane: entry.lane, color: entry.color, speed: this.speed });
      } else {
        pending.push({ ...entry, delayMs });
      }
    }

    this.pending = pending;
    return ready;
  }

  private scheduleWave(): void {
    const pattern = WAVE_PATTERNS[Math.floor(this.random.next() * WAVE_PATTERNS.length)]!;
    const anchor = Math.floor(this.random.next() * SIDE_COUNT);
    const colorIndexes = OFFSETS[pattern].map(() => Math.floor(this.random.next() * BLOCK_COLORS.length));

    this.pending.push(...this.createPattern(pattern, anchor, colorIndexes));
  }
}
