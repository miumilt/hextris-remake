import { describe, expect, it } from 'vitest';
import { BonusSystem } from '../src/game/BonusSystem';
import type { BonusType } from '../src/game/progressionTypes';
import type { RandomSource } from '../src/game/random';
import type { GridBlock } from '../src/game/types';

class SequenceRandom implements RandomSource {
  private index = 0;

  public constructor(private readonly values: readonly number[]) {}

  public next(): number {
    const value = this.values[this.index];
    this.index += 1;
    return value ?? 0;
  }
}

const block = (id: number, color: GridBlock['color']): GridBlock => ({ id, color });

function stacks(...sides: readonly (readonly GridBlock[])[]): readonly (readonly GridBlock[])[] {
  return Object.freeze(sides.map((side) => Object.freeze([...side])));
}

function assertDeepFrozen(value: unknown): void {
  if (value === null || typeof value !== 'object') return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const nested of Object.values(value)) assertDeepFrozen(nested);
}

describe('BonusSystem', () => {
  it('keeps one stored token and reports the type it replaced', () => {
    const bonuses = new BonusSystem(new SequenceRandom([]));

    expect(bonuses.collect('pulse')).toEqual({ collected: 'pulse', replaced: null });
    expect(bonuses.collect('cleanse')).toEqual({ collected: 'cleanse', replaced: 'pulse' });
    expect(bonuses.getSnapshot()).toEqual({ stored: 'cleanse', slowRemainingMs: 0 });
  });

  it('does nothing when activation is requested with an empty slot', () => {
    const bonuses = new BonusSystem(new SequenceRandom([]));

    expect(bonuses.activate(stacks([], [], [], [], [], []), 0, 3)).toBeNull();
  });

  it('activates SLOW for exactly six active seconds without removing cells', () => {
    const bonuses = new BonusSystem(new SequenceRandom([]));
    bonuses.collect('slow');

    expect(bonuses.activate(stacks([], [], [], [], [], []), 0, 3)).toEqual({
      type: 'slow', cells: [], scoreDelta: 0,
    });
    expect(bonuses.getMotionMultiplier()).toBe(0.55);
    expect(bonuses.getSnapshot()).toEqual({ stored: null, slowRemainingMs: 6_000 });

    bonuses.update(5_999);
    expect(bonuses.getMotionMultiplier()).toBe(0.55);
    bonuses.update(1);
    expect(bonuses.getMotionMultiplier()).toBe(1);
    expect(bonuses.getSnapshot()).toEqual({ stored: null, slowRemainingMs: 0 });
  });

  it('uses orientation-first clockwise ties to PULSE the outermost cells on the tallest sides', () => {
    const bonuses = new BonusSystem(new SequenceRandom([]));
    const grid = stacks(
      [block(1, 'coral'), block(2, 'amber'), block(3, 'teal')],
      [block(4, 'sky')],
      [block(5, 'coral'), block(6, 'amber'), block(7, 'teal')],
      [],
      [block(8, 'sky'), block(9, 'coral'), block(10, 'amber')],
      [block(11, 'teal'), block(12, 'sky')],
    );
    const before = JSON.stringify(grid);
    bonuses.collect('pulse');

    expect(bonuses.activate(grid, 4, 3)).toEqual({
      type: 'pulse',
      cells: [{ side: 4, index: 2 }, { side: 0, index: 2 }, { side: 2, index: 2 }],
      scoreDelta: 9,
    });
    expect(JSON.stringify(grid)).toBe(before);
  });

  it('extends PULSE targeting through five sides when upgraded', () => {
    const bonuses = new BonusSystem(new SequenceRandom([]));
    const grid = stacks(
      [block(1, 'coral'), block(2, 'amber'), block(3, 'teal')],
      [block(4, 'sky'), block(5, 'coral')],
      [block(6, 'amber'), block(7, 'teal'), block(8, 'sky')],
      [block(9, 'coral')],
      [block(10, 'amber'), block(11, 'teal'), block(12, 'sky')],
      [block(13, 'coral'), block(14, 'amber')],
    );
    bonuses.collect('pulse');

    expect(bonuses.activate(grid, 4, 5)).toEqual({
      type: 'pulse',
      cells: [
        { side: 4, index: 2 }, { side: 0, index: 2 }, { side: 2, index: 2 },
        { side: 5, index: 1 }, { side: 1, index: 1 },
      ],
      scoreDelta: 15,
    });
  });

  it('CLEANSE selects every cell of the orientation-first tallest side in safe collapse order', () => {
    const bonuses = new BonusSystem(new SequenceRandom([]));
    const grid = stacks(
      [block(1, 'coral'), block(2, 'amber'), block(3, 'teal')],
      [block(4, 'sky')],
      [],
      [],
      [block(5, 'coral'), block(6, 'amber'), block(7, 'teal')],
      [],
    );
    bonuses.collect('cleanse');

    expect(bonuses.activate(grid, 4, 3)).toEqual({
      type: 'cleanse',
      cells: [{ side: 4, index: 2 }, { side: 4, index: 1 }, { side: 4, index: 0 }],
      scoreDelta: 9,
    });
  });

  it('COLOR BREAK takes the outermost color from the orientation-first tallest side across the grid', () => {
    const bonuses = new BonusSystem(new SequenceRandom([]));
    const grid = stacks(
      [block(1, 'teal'), block(2, 'coral')],
      [block(3, 'sky'), block(4, 'teal')],
      [block(5, 'amber'), block(6, 'coral'), block(7, 'teal')],
      [block(8, 'teal')],
      [block(9, 'coral'), block(10, 'amber'), block(11, 'sky')],
      [block(12, 'teal'), block(13, 'amber')],
    );
    bonuses.collect('colorBreak');

    expect(bonuses.activate(grid, 2, 3)).toEqual({
      type: 'colorBreak',
      color: 'teal',
      cells: [
        { side: 0, index: 0 }, { side: 1, index: 1 }, { side: 2, index: 2 }, { side: 3, index: 0 }, { side: 5, index: 0 },
      ],
      scoreDelta: 15,
    });
  });

  it('samples the authored weighted sequence and resets stored and timed run state deterministically', () => {
    const values = [0, 4 / 11, 8 / 11, 10 / 11];
    const first = new BonusSystem(new SequenceRandom(values));
    const second = new BonusSystem(new SequenceRandom(values));
    const tokens = (bonuses: BonusSystem): readonly BonusType[] => [
      bonuses.nextToken(1, 2, 150).type,
      bonuses.nextToken(2, 3, 160).type,
      bonuses.nextToken(3, 4, 170).type,
      bonuses.nextToken(4, 5, 180).type,
    ];

    expect(tokens(first)).toEqual(['slow', 'pulse', 'cleanse', 'colorBreak']);
    expect(tokens(second)).toEqual(tokens(new BonusSystem(new SequenceRandom(values))));
    expect(first.nextToken(99, 5, 180)).toEqual({
      id: 99, type: 'slow', lane: 5, distance: 520, speed: 180,
    });

    first.collect('slow');
    first.activate(stacks([], [], [], [], [], []), 0, 3);
    first.reset();
    expect(first.getSnapshot()).toEqual({ stored: null, slowRemainingMs: 0 });
  });

  it('returns deeply frozen tokens, collection directives, activations, and snapshots', () => {
    const bonuses = new BonusSystem(new SequenceRandom([0]));
    const token = bonuses.nextToken(1, 2, 150);
    const collected = bonuses.collect(token.type);
    const activation = bonuses.activate(stacks([block(1, 'coral')], [], [], [], [], []), 0, 3);
    const snapshot = bonuses.getSnapshot();

    assertDeepFrozen(token);
    assertDeepFrozen(collected);
    assertDeepFrozen(activation);
    assertDeepFrozen(snapshot);
  });
});
