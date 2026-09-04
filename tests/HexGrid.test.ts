import { describe, expect, it } from 'vitest';
import { HexGrid } from '../src/game/HexGrid';

const block = (id: number, color = 'coral' as const) => ({ id, color });

describe('HexGrid', () => {
  it('maps world lanes through wrapped 60-degree rotation', () => {
    const grid = new HexGrid(12);
    expect(grid.laneToSide(0)).toBe(0);
    grid.rotate(1);
    expect(grid.laneToSide(0)).toBe(1);
    grid.rotate(-1);
    expect(grid.laneToSide(5)).toBe(5);
  });

  it('attaches, collapses, and detects overflow', () => {
    const grid = new HexGrid(2);
    grid.attach(0, block(1));
    grid.attach(0, block(2));
    expect(grid.isOverflowed()).toBe(true);
    grid.collapse([{ side: 0, index: 0 }]);
    expect(grid.snapshot()[0]?.map((item) => item.id)).toEqual([2]);
    expect(grid.isOverflowed()).toBe(false);
  });
});
