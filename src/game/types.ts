import type { BLOCK_COLORS } from './constants';

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
}

export type GameMode = 'menu' | 'playing' | 'paused' | 'gameOver';

export type GameCommand =
  | { type: 'rotate'; steps: -1 | 1 }
  | { type: 'togglePause' };

export type GameEvent =
  | { readonly type: 'blockLanded'; readonly block: GridBlock; readonly cell: CellRef }
  | {
      readonly type: 'matchCleared';
      readonly cells: readonly CellRef[];
      readonly color: BlockColor;
      readonly chain: number;
    }
  | { readonly type: 'comboChanged'; readonly multiplier: number }
  | { readonly type: 'gameOver'; readonly score: number };

export interface GameSnapshot {
  readonly mode: GameMode;
  readonly score: number;
  readonly combo: number;
  readonly orientation: number;
  readonly stacks: readonly (readonly GridBlock[])[];
  readonly falling: readonly FallingBlock[];
  readonly elapsedMs: number;
}
