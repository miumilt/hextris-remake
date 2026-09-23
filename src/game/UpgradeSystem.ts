import type { UpgradeChoice, UpgradeId, UpgradeModifiers, UpgradeOffer, UpgradeSnapshot, WaveProfile } from './progressionTypes';
import { MAX_FALL_SPEED, MIN_WAVE_INTERVAL_MS } from './constants';
import type { RandomSource } from './random';

const DEFINITIONS: Readonly<Record<UpgradeId, Omit<UpgradeChoice, 'level'>>> = {
  stabilizer: { id: 'stabilizer', maxLevel: 3, label: 'СТАБИЛИЗАТОР', description: 'СКОРОСТЬ ПАДЕНИЯ −4%' },
  comboRelay: { id: 'comboRelay', maxLevel: 3, label: 'РЕЛЕ КОМБО', description: 'ОКНО КОМБО +300 МС' },
  salvage: { id: 'salvage', maxLevel: 3, label: 'ДОБЫЧА', description: 'БОНУСЫ ПОЯВЛЯЮТСЯ НА 15% ЧАЩЕ' },
  deepPulse: { id: 'deepPulse', maxLevel: 2, label: 'ГЛУБОКИЙ ИМПУЛЬС', description: 'ИМПУЛЬС ЗАХВАТЫВАЕТ +1 СТОРОНУ' },
  anomalyShield: { id: 'anomalyShield', maxLevel: 3, label: 'ЩИТ АНОМАЛИЙ', description: 'ВРЕМЯ АНОМАЛИЙ −15%' },
  lastStand: { id: 'lastStand', maxLevel: 1, label: 'ПОСЛЕДНИЙ ШАНС', description: 'ПЕРЕЖИТЬ ОДНО ПЕРЕПОЛНЕНИЕ' },
};

const UPGRADE_IDS: readonly UpgradeId[] = [
  'stabilizer', 'comboRelay', 'salvage', 'deepPulse', 'anomalyShield', 'lastStand',
];

export const clampWaveProfile = (profile: WaveProfile, speedMultiplier: number): WaveProfile =>
  Object.freeze({
    ...profile,
    speed: Math.min(MAX_FALL_SPEED, profile.speed * speedMultiplier),
    intervalMs: Math.max(MIN_WAVE_INTERVAL_MS, profile.intervalMs),
  });

function freeze<T extends object>(value: T): Readonly<T> {
  return Object.freeze(value);
}

function initialLevels(): Record<UpgradeId, number> {
  return {
    stabilizer: 0,
    comboRelay: 0,
    salvage: 0,
    deepPulse: 0,
    anomalyShield: 0,
    lastStand: 0,
  };
}

export class UpgradeSystem {
  private levels = initialLevels();
  private choices: readonly UpgradeChoice[] = [];
  private selectedIndex = 0;

  public constructor(private readonly random: RandomSource) {}

  public offer(): UpgradeOffer | null {
    if (this.choices.length > 0) return this.currentOffer();

    const available = UPGRADE_IDS.filter((id) => this.levels[id] < DEFINITIONS[id].maxLevel);
    if (available.length === 0) return null;

    const count = Math.min(2, available.length);
    const choices: UpgradeChoice[] = [];
    for (let index = 0; index < count; index += 1) {
      const selected = Math.min(available.length - 1, Math.floor(this.random.next() * available.length));
      const id = available.splice(selected, 1)[0]!;
      choices.push(freeze({ ...DEFINITIONS[id], level: this.levels[id] }));
    }

    this.choices = freeze(choices);
    this.selectedIndex = 0;
    return this.currentOffer();
  }

  public moveSelection(steps: number): void {
    if (this.choices.length === 0 || !Number.isFinite(steps)) return;
    this.selectedIndex = Math.max(0, Math.min(this.choices.length - 1, this.selectedIndex + Math.trunc(steps)));
  }

  public confirm(): UpgradeId | null {
    const selected = this.choices[this.selectedIndex];
    if (!selected) return null;

    this.levels[selected.id] += 1;
    this.choices = [];
    this.selectedIndex = 0;
    return selected.id;
  }

  public getSnapshot(): UpgradeSnapshot {
    return freeze<UpgradeSnapshot>({
      levels: freeze({ ...this.levels }),
      choices: freeze([...this.choices]),
      selectedIndex: this.selectedIndex,
    });
  }

  public getModifiers(): UpgradeModifiers {
    const levels = this.levels;
    return freeze<UpgradeModifiers>({
      speedMultiplier: 1 - levels.stabilizer * 0.04,
      comboWindowBonusMs: levels.comboRelay * 300,
      bonusIntervalMultiplier: 1 - levels.salvage * 0.15,
      pulseSides: 3 + levels.deepPulse,
      anomalyDurationMultiplier: Math.max(4_000 / 8_000, 1 - levels.anomalyShield * 0.15),
      hasLastStand: levels.lastStand > 0,
    });
  }

  public consumeLastStand(): boolean {
    if (this.levels.lastStand === 0) return false;
    this.levels.lastStand = 0;
    return true;
  }

  public reset(): void {
    this.levels = initialLevels();
    this.choices = [];
    this.selectedIndex = 0;
  }

  private currentOffer(): UpgradeOffer {
    return freeze<UpgradeOffer>({
      choices: freeze([...this.choices]),
      selectedIndex: this.selectedIndex,
    });
  }
}
