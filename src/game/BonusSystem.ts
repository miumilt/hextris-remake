import { START_DISTANCE } from './constants';
import type {
  BonusActivation,
  BonusCollection,
  BonusSnapshot,
  BonusType,
  FallingBonus,
} from './progressionTypes';
import type { RandomSource } from './random';
import type { CellRef, GridBlock } from './types';

const SLOW_DURATION_MS = 6_000;
const SLOW_MOTION_MULTIPLIER = 0.55;
const BONUS_WEIGHTS: Readonly<Record<BonusType, number>> = {
  slow: 4,
  pulse: 4,
  cleanse: 2,
  colorBreak: 1,
};
const BONUS_TYPES: readonly BonusType[] = ['slow', 'pulse', 'cleanse', 'colorBreak'];

function freeze<T extends object>(value: T): Readonly<T> {
  return Object.freeze(value);
}

function wrapSide(side: number, sideCount: number): number {
  return ((side % sideCount) + sideCount) % sideCount;
}

function frozenCells(cells: readonly CellRef[]): readonly CellRef[] {
  return freeze(cells.map((cell) => freeze({ ...cell })));
}

export class BonusSystem {
  private stored: BonusType | null = null;
  private slowRemainingMs = 0;

  public constructor(private readonly random: RandomSource) {}

  public nextToken(id: number, lane: number, speed: number): FallingBonus {
    return freeze<FallingBonus>({
      id,
      type: this.nextType(),
      lane,
      distance: START_DISTANCE,
      speed,
    });
  }

  public collect(type: BonusType): BonusCollection {
    const replaced = this.stored;
    this.stored = type;
    return freeze<BonusCollection>({ collected: type, replaced });
  }

  public activate(
    stacks: readonly (readonly GridBlock[])[],
    orientation: number,
    pulseSides: number,
  ): BonusActivation | null {
    const type = this.stored;
    if (type === null) return null;

    this.stored = null;
    if (type === 'slow') {
      this.slowRemainingMs = SLOW_DURATION_MS;
      return this.activation(type, []);
    }

    if (type === 'pulse') {
      return this.activation(type, this.pulseCells(stacks, orientation, pulseSides));
    }

    const tallest = this.tallestSide(stacks, orientation);
    if (type === 'cleanse') {
      const cells = tallest === null
        ? []
        : stacks[tallest]!.map((_, index) => ({ side: tallest, index })).reverse();
      return this.activation(type, cells);
    }

    if (tallest === null) return this.activation(type, []);
    const color = stacks[tallest]![stacks[tallest]!.length - 1]!.color;
    const cells = stacks.flatMap((stack, side) => stack
      .map((block, index) => ({ block, side, index }))
      .filter((cell) => cell.block.color === color)
      .map(({ side: matchingSide, index }) => ({ side: matchingSide, index }))
      .reverse());
    return this.activation(type, cells, color);
  }

  public update(deltaMs: number): number {
    if (deltaMs < 0) throw new RangeError('deltaMs must not be negative');
    const slowedMs = Math.min(deltaMs, this.slowRemainingMs);
    this.slowRemainingMs = Math.max(0, this.slowRemainingMs - deltaMs);
    return slowedMs * SLOW_MOTION_MULTIPLIER + (deltaMs - slowedMs);
  }

  public getMotionMultiplier(): number {
    return this.slowRemainingMs > 0 ? SLOW_MOTION_MULTIPLIER : 1;
  }

  public getSnapshot(): BonusSnapshot {
    return freeze<BonusSnapshot>({ stored: this.stored, slowRemainingMs: this.slowRemainingMs });
  }

  public reset(): void {
    this.stored = null;
    this.slowRemainingMs = 0;
  }

  private nextType(): BonusType {
    const totalWeight = BONUS_TYPES.reduce((total, type) => total + BONUS_WEIGHTS[type], 0);
    const sample = this.random.next() * totalWeight;
    let threshold = 0;
    for (const type of BONUS_TYPES) {
      threshold += BONUS_WEIGHTS[type];
      if (sample < threshold) return type;
    }
    return BONUS_TYPES[BONUS_TYPES.length - 1]!;
  }

  private pulseCells(
    stacks: readonly (readonly GridBlock[])[],
    orientation: number,
    pulseSides: number,
  ): readonly CellRef[] {
    const count = Math.max(0, Math.min(Math.trunc(pulseSides), 5, stacks.length));
    return this.orderedSides(stacks, orientation)
      .filter((side) => stacks[side]!.length > 0)
      .slice(0, count)
      .map((side) => ({ side, index: stacks[side]!.length - 1 }));
  }

  private tallestSide(stacks: readonly (readonly GridBlock[])[], orientation: number): number | null {
    return this.orderedSides(stacks, orientation).find((side) => stacks[side]!.length > 0) ?? null;
  }

  private orderedSides(stacks: readonly (readonly GridBlock[])[], orientation: number): number[] {
    const sideOrder = Array.from({ length: stacks.length }, (_, offset) => wrapSide(orientation + offset, stacks.length));
    return sideOrder.sort((left, right) => stacks[right]!.length - stacks[left]!.length);
  }

  private activation(type: BonusType, cells: readonly CellRef[], color?: GridBlock['color']): BonusActivation {
    const frozen = frozenCells(cells);
    const activation = color === undefined
      ? { type, cells: frozen, scoreDelta: frozen.length * 3 }
      : { type, cells: frozen, color, scoreDelta: frozen.length * 3 };
    return freeze<BonusActivation>(activation);
  }
}
