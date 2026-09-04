import type { BLOCK_COLORS } from './constants';

export type BlockColor = (typeof BLOCK_COLORS)[number];

export interface GridBlock {
  id: number;
  color: BlockColor;
}

export interface CellRef {
  side: number;
  index: number;
}

export interface FallingBlock extends GridBlock {
  lane: number;
  distance: number;
  speed: number;
}

export type GameMode = 'menu' | 'playing' | 'paused' | 'gameOver';

export type GameCommand =
  | { type: 'rotate'; steps: -1 | 1 }
  | { type: 'togglePause' };

export type GameEvent =
  | { type: 'blockLanded'; block: GridBlock; cell: CellRef }
  | { type: 'matchCleared'; cells: readonly CellRef[]; color: BlockColor; chain: number }
  | { type: 'comboChanged'; multiplier: number }
  | { type: 'gameOver'; score: number };

export interface GameSnapshot {
  mode: GameMode;
  score: number;
  combo: number;
  orientation: number;
  stacks: readonly (readonly GridBlock[])[];
  falling: readonly FallingBlock[];
  elapsedMs: number;
}
