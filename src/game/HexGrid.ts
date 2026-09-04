import { MAX_STACK_DEPTH, SIDE_COUNT } from './constants';
import type { CellRef, GridBlock } from './types';

const wrapSide = (value: number) => ((value % SIDE_COUNT) + SIDE_COUNT) % SIDE_COUNT;

export class HexGrid {
  private stacks: GridBlock[][] = Array.from({ length: SIDE_COUNT }, () => []);
  public orientation = 0;

  public constructor(private readonly maxDepth = MAX_STACK_DEPTH) {}

  public rotate(steps: -1 | 1): void {
    this.orientation = wrapSide(this.orientation + steps);
  }

  public laneToSide(lane: number): number {
    return wrapSide(lane + this.orientation);
  }

  public attach(side: number, block: GridBlock): CellRef {
    const wrapped = wrapSide(side);
    this.stacks[wrapped]!.push(block);
    return { side: wrapped, index: this.stacks[wrapped]!.length - 1 };
  }

  public collapse(cells: readonly CellRef[]): void {
    for (let side = 0; side < SIDE_COUNT; side += 1) {
      const indexes = cells
        .filter((cell) => cell.side === side)
        .map((cell) => cell.index)
        .sort((a, b) => b - a);
      for (const index of indexes) this.stacks[side]!.splice(index, 1);
    }
  }

  public replaceStacks(stacks: readonly (readonly GridBlock[])[]): void {
    if (stacks.length !== SIDE_COUNT) {
      throw new RangeError(`stacks must contain exactly ${SIDE_COUNT} sides`);
    }

    this.stacks = stacks.map((stack) => [...stack]);
  }

  public isOverflowed(): boolean {
    return this.stacks.some((stack) => stack.length >= this.maxDepth);
  }

  public snapshot(): readonly (readonly GridBlock[])[] {
    return this.stacks.map((stack) => [...stack]);
  }
}
