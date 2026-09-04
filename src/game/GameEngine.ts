import {
  BLOCK_DEPTH,
  COMBO_WINDOW_MS,
  HEX_APOTHEM,
  MAX_STACK_DEPTH,
  START_DISTANCE,
} from './constants';
import { HexGrid } from './HexGrid';
import { resolveAllMatches } from './MatchResolver';
import { SeededRandom } from './random';
import type {
  BlockColor,
  FallingBlock,
  GameCommand,
  GameEvent,
  GameMode,
  GameSnapshot,
  GridBlock,
} from './types';
import { WaveSpawner, type SpawnRequest } from './WaveSpawner';

export interface GameEngineOptions {
  readonly randomSeed?: number;
  readonly maxStackDepth?: number;
  readonly spawning?: boolean;
}

export interface DebugPlacement {
  readonly side: number;
  readonly count: number;
}

export class GameEngine {
  private mode: GameMode = 'menu';
  private score = 0;
  private combo = 1;
  private elapsedMs = 0;
  private lastMatchAtMs = Number.NEGATIVE_INFINITY;
  private nextBlockId = 1;
  private grid: HexGrid;
  private falling: FallingBlock[] = [];
  private spawner: WaveSpawner;
  private readonly commandQueue: GameCommand[] = [];
  private queuedRotations = 0;
  private pauseQueued = false;
  private readonly randomSeed: number;
  private readonly maxStackDepth: number;
  private readonly spawning: boolean;

  public constructor(options: GameEngineOptions = {}) {
    this.randomSeed = options.randomSeed ?? 1;
    this.maxStackDepth = options.maxStackDepth ?? MAX_STACK_DEPTH;
    this.spawning = options.spawning ?? true;
    this.grid = new HexGrid(this.maxStackDepth);
    this.spawner = new WaveSpawner(new SeededRandom(this.randomSeed));
  }

  public start(): void {
    this.resetState();
    this.mode = 'playing';
  }

  public restart(): void {
    this.resetState();
    this.mode = 'playing';
  }

  public returnToMenu(): void {
    this.resetState();
    this.mode = 'menu';
  }

  public enqueue(command: GameCommand): void {
    if (command.type === 'rotate') {
      if (this.mode !== 'playing') return;
      if (this.queuedRotations >= 2) return;
      this.queuedRotations += 1;
    } else {
      if (this.pauseQueued) return;
      this.pauseQueued = true;
    }

    this.commandQueue.push(command);
  }

  public update(deltaMs: number): readonly GameEvent[] {
    const events: GameEvent[] = [];
    this.applyQueuedCommands();
    if (this.mode !== 'playing') return Object.freeze(events);

    this.elapsedMs += deltaMs;
    if (this.spawning) this.spawn(this.spawner.update(deltaMs));
    this.moveAndLand(deltaMs, events);
    this.resolveAndScore(events);

    if (this.grid.isOverflowed()) {
      this.mode = 'gameOver';
      events.push(Object.freeze({ type: 'gameOver', score: this.score }));
    }

    return Object.freeze(events);
  }

  public getSnapshot(): GameSnapshot {
    const stacks = this.grid.snapshot().map((stack) => Object.freeze([...stack]));
    const falling = this.falling.map((block) => Object.freeze({ ...block }));
    return Object.freeze({
      mode: this.mode,
      score: this.score,
      combo: this.combo,
      orientation: this.grid.orientation,
      stacks: Object.freeze(stacks),
      falling: Object.freeze(falling),
      elapsedMs: this.elapsedMs,
    });
  }

  /** Deterministic test helper. Production composition must never call this method. */
  public debugSpawn(request: SpawnRequest): void {
    this.spawn([request]);
  }

  /** Deterministic test helper. Production composition must never call this method. */
  public debugAttachGroup(color: BlockColor, placements: readonly DebugPlacement[]): void {
    for (const placement of placements) {
      for (let index = 0; index < placement.count; index += 1) {
        this.grid.attach(placement.side, this.createBlock(color));
      }
    }
  }

  private resetState(): void {
    this.score = 0;
    this.combo = 1;
    this.elapsedMs = 0;
    this.lastMatchAtMs = Number.NEGATIVE_INFINITY;
    this.nextBlockId = 1;
    this.grid = new HexGrid(this.maxStackDepth);
    this.falling = [];
    this.spawner = new WaveSpawner(new SeededRandom(this.randomSeed));
    this.commandQueue.length = 0;
    this.queuedRotations = 0;
    this.pauseQueued = false;
  }

  private applyQueuedCommands(): void {
    for (const command of this.commandQueue) {
      if (command.type === 'rotate') {
        if (this.mode === 'playing') this.grid.rotate(command.steps);
        continue;
      }

      if (this.mode === 'playing') this.mode = 'paused';
      else if (this.mode === 'paused') this.mode = 'playing';
    }

    this.commandQueue.length = 0;
    this.queuedRotations = 0;
    this.pauseQueued = false;
  }

  private spawn(requests: readonly SpawnRequest[]): void {
    for (const request of requests) {
      this.falling.push({
        ...this.createBlock(request.color),
        lane: request.lane,
        distance: START_DISTANCE,
        speed: request.speed,
      });
    }
  }

  private moveAndLand(deltaMs: number, events: GameEvent[]): void {
    const stillFalling: FallingBlock[] = [];

    for (const block of this.falling) {
      const side = this.grid.laneToSide(block.lane);
      const stackLength = this.grid.snapshot()[side]!.length;
      const landingDistance = HEX_APOTHEM + stackLength * BLOCK_DEPTH;
      const moved = { ...block, distance: block.distance - (block.speed * deltaMs) / 1000 };

      if (moved.distance <= landingDistance) {
        const attached: GridBlock = Object.freeze({ id: block.id, color: block.color });
        const cell = Object.freeze(this.grid.attach(side, attached));
        events.push(Object.freeze({ type: 'blockLanded', block: attached, cell }));
      } else {
        stillFalling.push(moved);
      }
    }

    this.falling = stillFalling;
  }

  private resolveAndScore(events: GameEvent[]): void {
    const resolution = resolveAllMatches(this.grid.snapshot());

    for (const group of resolution.groups) {
      const insideWindow = this.elapsedMs - this.lastMatchAtMs <= COMBO_WINDOW_MS;
      this.combo = insideWindow ? this.combo + 1 : 1;
      this.score += group.cells.length ** 2 * this.combo;
      this.lastMatchAtMs = this.elapsedMs;
      const cells = Object.freeze(group.cells.map((cell) => Object.freeze({ ...cell })));
      events.push(
        Object.freeze({ type: 'matchCleared', cells, color: group.color, chain: group.chain }),
        Object.freeze({ type: 'comboChanged', multiplier: this.combo }),
      );
    }

    this.grid.replaceStacks(resolution.stacks);
  }

  private createBlock(color: BlockColor): GridBlock {
    return Object.freeze({ id: this.nextBlockId++, color });
  }
}
