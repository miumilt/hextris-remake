import { describe, expect, it } from 'vitest';
import { UpgradeSystem } from '../src/game/UpgradeSystem';
import type { RandomSource } from '../src/game/random';
import { SeededRandom } from '../src/game/random';

class SequenceRandom implements RandomSource {
  public next(): number {
    return 0;
  }
}

function assertDeepFrozen(value: unknown): void {
  if (value === null || typeof value !== 'object') return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const nested of Object.values(value)) assertDeepFrozen(nested);
}

describe('UpgradeSystem', () => {
  it('offers player-facing upgrade names and descriptions in Russian', () => {
    const upgrades = new UpgradeSystem(new SequenceRandom());

    expect(upgrades.offer()?.choices).toEqual([
      {
        id: 'stabilizer', level: 0, maxLevel: 3,
        label: 'СТАБИЛИЗАТОР', description: 'СКОРОСТЬ ПАДЕНИЯ −4%',
      },
      {
        id: 'comboRelay', level: 0, maxLevel: 3,
        label: 'РЕЛЕ КОМБО', description: 'ОКНО КОМБО +300 МС',
      },
    ]);
  });

  it('offers two distinct seeded choices, clamps selection, and confirms only the selected choice', () => {
    const first = new UpgradeSystem(new SeededRandom(73));
    const second = new UpgradeSystem(new SeededRandom(73));

    const firstOffer = first.offer();
    const secondOffer = second.offer();

    expect(firstOffer).toEqual(secondOffer);
    expect(firstOffer?.choices).toHaveLength(2);
    expect(new Set(firstOffer?.choices.map((choice) => choice.id)).size).toBe(2);
    expect(firstOffer?.selectedIndex).toBe(0);

    first.moveSelection(-99);
    expect(first.getSnapshot().selectedIndex).toBe(0);
    expect(first.confirm()).toBe(firstOffer?.choices[0]?.id ?? null);
    expect(first.getSnapshot().levels[firstOffer?.choices[0]?.id ?? 'stabilizer']).toBe(1);
    expect(first.getSnapshot().choices).toEqual([]);

    const nextOffer = first.offer();
    first.moveSelection(99);
    expect(first.getSnapshot().selectedIndex).toBe(1);
    expect(first.confirm()).toBe(nextOffer?.choices[1]?.id ?? null);
    expect(first.confirm()).toBeNull();
  });

  it('applies every capped modifier, excludes maxed choices, and reaches all-maxed through a singleton offer', () => {
    const upgrades = new UpgradeSystem(new SequenceRandom());
    const confirmed: string[] = [];
    const offeredIds: string[] = [];

    for (let selection = 0; selection < 15; selection += 1) {
      const offer = upgrades.offer();
      expect(offer).not.toBeNull();
      if (offer === null) throw new Error('Expected an upgrade offer');
      offeredIds.push(...offer.choices.map((choice) => choice.id));
      if (selection === 14) expect(offer.choices).toHaveLength(1);
      upgrades.moveSelection(-1);
      const selected = upgrades.confirm();
      expect(selected).toBe(offer.choices[0]?.id ?? null);
      if (selected !== null) confirmed.push(selected);
    }

    expect(confirmed).toEqual([
      'stabilizer', 'stabilizer', 'stabilizer',
      'comboRelay', 'comboRelay', 'comboRelay',
      'salvage', 'salvage', 'salvage',
      'deepPulse', 'deepPulse',
      'anomalyShield', 'anomalyShield', 'anomalyShield',
      'lastStand',
    ]);
    expect(offeredIds.slice(6)).not.toContain('stabilizer');
    expect(upgrades.getModifiers()).toEqual({
      speedMultiplier: 0.88,
      comboWindowBonusMs: 900,
      bonusIntervalMultiplier: 0.55,
      pulseSides: 5,
      anomalyDurationMultiplier: 0.55,
      hasLastStand: true,
    });
    expect(upgrades.offer()).toBeNull();

    expect(upgrades.consumeLastStand()).toBe(true);
    expect(upgrades.consumeLastStand()).toBe(false);
    expect(upgrades.getModifiers().hasLastStand).toBe(false);
  });

  it('returns deeply immutable defensive offers, snapshots, and modifiers, then resets the run state', () => {
    const upgrades = new UpgradeSystem(new SeededRandom(11));
    const offer = upgrades.offer();
    const snapshot = upgrades.getSnapshot();
    const modifiers = upgrades.getModifiers();
    const frozenSnapshot = JSON.stringify(snapshot);

    assertDeepFrozen(offer);
    assertDeepFrozen(snapshot);
    assertDeepFrozen(modifiers);
    expect(() => Object.assign(snapshot.levels, { stabilizer: 99 })).toThrow(TypeError);
    expect(() => Object.assign(snapshot.choices[0]!, { label: 'MUTATED' })).toThrow(TypeError);

    upgrades.confirm();
    expect(JSON.stringify(snapshot)).toBe(frozenSnapshot);

    upgrades.reset();
    expect(upgrades.getSnapshot()).toEqual({
      levels: {
        stabilizer: 0,
        comboRelay: 0,
        salvage: 0,
        deepPulse: 0,
        anomalyShield: 0,
        lastStand: 0,
      },
      choices: [],
      selectedIndex: 0,
    });
    expect(upgrades.getModifiers()).toEqual({
      speedMultiplier: 1,
      comboWindowBonusMs: 0,
      bonusIntervalMultiplier: 1,
      pulseSides: 3,
      anomalyDurationMultiplier: 1,
      hasLastStand: false,
    });
  });
});
