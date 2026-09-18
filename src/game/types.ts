import type { BLOCK_COLORS } from './constants';
import type {
  BonusSnapshot,
  BonusType,
  CycleSnapshot,
  DirectorEvent,
  FallingBonus,
  UpgradeChoice,
  UpgradeId,
  UpgradeSnapshot,
} from './progressionTypes';

declare global {
  interface Window {
    render_game_to_text?: () => string;
    advanceTime?: (ms: number) => void;
  }
}

export type BlockColor = (typeof BLOCK_COLORS)[number];

export interface GridBlock {
  readonly id: number;
  readonly color: BlockColor;
}

export interface CellRef {
  readonly side: number;
  readonly index: number;
}

export interface FallingBlock extends GridBlock {
  readonly lane: number;
  readonly distance: number;
  readonly speed: number;
  readonly driftToLane?: number;
  readonly driftProgress?: number;
  readonly shiftToColor?: BlockColor;
  readonly shiftAtDistance?: number;
  readonly mirageLane?: number;
  readonly mirageVisible?: boolean;
}

export type GameMode = 'menu' | 'playing' | 'paused' | 'upgrade' | 'gameOver';

export type GameCommand =
  | { readonly type: 'rotate'; readonly steps: -1 | 1 }
  | { readonly type: 'togglePause' }
  | { readonly type: 'activateBonus' }
  | { readonly type: 'selectUpgrade'; readonly steps: -1 | 1 }
  | { readonly type: 'confirmUpgrade' };

export type GameEvent =
  | DirectorEvent
  | { readonly type: 'blockSpawned'; readonly block: FallingBlock }
  | { readonly type: 'blockLanded'; readonly block: GridBlock; readonly cell: CellRef }
  | {
      readonly type: 'blockColorShifted';
      readonly blockId: number;
      readonly fromColor: BlockColor;
      readonly toColor: BlockColor;
    }
  | { readonly type: 'rotationDelayed'; readonly steps: -1 | 1; readonly remainingMs: number }
  | {
      readonly type: 'matchCleared';
      readonly cells: readonly CellRef[];
      readonly color: BlockColor;
      readonly chain: number;
    }
  | { readonly type: 'comboChanged'; readonly multiplier: number }
  | { readonly type: 'bonusScheduled'; readonly bonus: FallingBonus }
  | { readonly type: 'bonusCollected'; readonly bonus: BonusType; readonly token: FallingBonus }
  | { readonly type: 'bonusReplaced'; readonly previous: BonusType; readonly replacement: BonusType }
  | { readonly type: 'bonusActivated'; readonly bonus: BonusType }
  | {
      readonly type: 'bonusRemoved';
      readonly bonus: BonusType;
      readonly cells: readonly CellRef[];
      readonly blocks: readonly GridBlock[];
      readonly scoreDelta: number;
    }
  | { readonly type: 'upgradeOffered'; readonly choices: readonly UpgradeChoice[]; readonly selectedIndex: number }
  | { readonly type: 'upgradeSelectionChanged'; readonly selectedIndex: number }
  | { readonly type: 'upgradeSelected'; readonly upgrade: UpgradeId; readonly level: number }
  | {
      readonly type: 'lastStand';
      readonly side: number;
      readonly cells: readonly CellRef[];
      readonly blocks: readonly GridBlock[];
    }
  | { readonly type: 'gameOver'; readonly score: number };

export interface GameSnapshot {
  readonly mode: GameMode;
  readonly score: number;
  readonly combo: number;
  readonly orientation: number;
  readonly stacks: readonly (readonly GridBlock[])[];
  readonly falling: readonly FallingBlock[];
  readonly cycle: CycleSnapshot;
  readonly bonus: BonusSnapshot;
  readonly fallingBonuses: readonly FallingBonus[];
  readonly upgrades: UpgradeSnapshot;
  readonly elapsedMs: number;
}
