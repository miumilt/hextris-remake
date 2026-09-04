import { SIDE_COUNT } from './constants';
import type { BlockColor, CellRef, GridBlock } from './types';

export interface ResolvedGroup {
  color: BlockColor;
  cells: CellRef[];
  chain: number;
}

export interface MatchResolution {
  groups: ResolvedGroup[];
  stacks: GridBlock[][];
}

export function resolveAllMatches(source: readonly (readonly GridBlock[])[]): MatchResolution {
  const stacks = source.map((stack) => [...stack]);
  const groups: ResolvedGroup[] = [];
  let chain = 1;

  while (true) {
    const matches = findDisjointGroups(stacks).filter((cells) => cells.length >= 3);
    if (matches.length === 0) break;

    for (const cells of matches) {
      const first = cells[0]!;
      const color = stacks[first.side]![first.index]!.color;
      groups.push({ color, cells, chain });
    }
    removeCells(stacks, matches.flat());
    chain += 1;
  }

  return { groups, stacks };
}

export function findConnectedGroup(
  stacks: readonly (readonly GridBlock[])[],
  start: CellRef,
): CellRef[] {
  const first = stacks[start.side]?.[start.index];
  if (!first) return [];

  const queue = [start];
  const found: CellRef[] = [];
  const seen = new Set<string>();

  while (queue.length > 0) {
    const cell = queue.shift()!;
    const side = wrapSide(cell.side);
    const key = cellKey(side, cell.index);
    if (seen.has(key)) continue;
    seen.add(key);
    if (stacks[side]?.[cell.index]?.color !== first.color) continue;

    found.push({ side, index: cell.index });
    queue.push(
      { side, index: cell.index - 1 },
      { side, index: cell.index + 1 },
      { side: wrapSide(side - 1), index: cell.index },
      { side: wrapSide(side + 1), index: cell.index },
    );
  }

  return found;
}

function findDisjointGroups(stacks: readonly (readonly GridBlock[])[]): CellRef[][] {
  const groups: CellRef[][] = [];
  const visited = new Set<string>();

  for (let side = 0; side < SIDE_COUNT; side += 1) {
    const stack = stacks[side] ?? [];
    for (let index = 0; index < stack.length; index += 1) {
      const key = cellKey(side, index);
      if (visited.has(key)) continue;

      const group = findConnectedGroup(stacks, { side, index });
      for (const cell of group) visited.add(cellKey(cell.side, cell.index));
      groups.push(group);
    }
  }

  return groups;
}

function removeCells(stacks: GridBlock[][], cells: readonly CellRef[]): void {
  for (let side = 0; side < SIDE_COUNT; side += 1) {
    const indexes = cells
      .filter((cell) => cell.side === side)
      .map((cell) => cell.index)
      .sort((a, b) => b - a);
    for (const index of indexes) stacks[side]?.splice(index, 1);
  }
}

function wrapSide(side: number): number {
  return ((side % SIDE_COUNT) + SIDE_COUNT) % SIDE_COUNT;
}

function cellKey(side: number, index: number): string {
  return `${side}:${index}`;
}
