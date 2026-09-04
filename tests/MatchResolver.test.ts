import { describe, expect, it } from 'vitest';
import { findConnectedGroup, resolveAllMatches } from '../src/game/MatchResolver';
import type { GridBlock } from '../src/game/types';

const b = (id: number, color: GridBlock['color']): GridBlock => ({ id, color });

describe('resolveAllMatches', () => {
  it('finds only adjacent cells of the starting color', () => {
    const stacks = [[b(1, 'teal')], [b(2, 'coral')], [], [], [], [b(3, 'teal'), b(4, 'teal')]];

    const cells = findConnectedGroup(stacks, { side: 0, index: 0 });

    expect(cells.map(({ side, index }) => `${side}:${index}`).sort()).toEqual(['0:0', '5:0', '5:1']);
  });

  it('clears a vertical group of three but keeps a pair', () => {
    const stacks = [
      [b(1, 'coral'), b(2, 'coral'), b(3, 'coral')],
      [b(4, 'sky'), b(5, 'sky')],
      [], [], [], [],
    ];

    const result = resolveAllMatches(stacks);

    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]?.cells).toHaveLength(3);
    expect(result.stacks[0]).toEqual([]);
    expect(result.stacks[1]).toHaveLength(2);
  });

  it('wraps connectivity between side five and side zero', () => {
    const stacks = [[b(1, 'teal')], [], [], [], [], [b(2, 'teal'), b(3, 'teal')]];

    const result = resolveAllMatches(stacks);

    expect(result.groups[0]?.cells).toHaveLength(3);
  });

  it('rechecks after collapse and reports a second chain', () => {
    const stacks = [
      [b(1, 'coral'), b(2, 'coral'), b(3, 'coral'), b(4, 'amber')],
      [b(5, 'amber')],
      [b(6, 'amber')],
      [], [], [],
    ];

    const result = resolveAllMatches(stacks);

    expect(result.groups.map((group) => group.chain)).toEqual([1, 2]);
  });
});
