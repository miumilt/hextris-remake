import {
  BLOCK_DEPTH,
  COMBO_WINDOW_MS,
  HEX_APOTHEM,
  MAX_STACK_DEPTH,
  START_DISTANCE,
} from './constants';
import { HexGrid } from './HexGrid';
import { BonusSystem } from './BonusSystem';
import { CycleDirector, type CycleDirectorOptions } from './CycleDirector';
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
import { UpgradeSystem } from './UpgradeSystem';
import type { FallingBonus, UpgradeChoice } from './progressionTypes';

export interface GameEngineOptions {
  readonly randomSeed?: number;
  readonly maxStackDepth?: number;
  readonly spawning?: boolean;
  readonly cycle?: CycleDirectorOptions;
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
  private director: CycleDirector;
  private bonuses: BonusSystem;
  private upgrades: UpgradeSystem;
  private fallingBonuses: FallingBonus[] = [];
  private readonly commandQueue: GameCommand[] = [];
  private queuedRotations = 0;
  private pauseQueued = false;
  private readonly randomSeed: number;
  private readonly maxStackDepth: number;
  private readonly spawning: boolean;
  private readonly cycleOptions: CycleDirectorOptions;

  public constructor(options: GameEngineOptions = {}) {
    this.randomSeed = options.randomSeed ?? 1;
    this.maxStackDepth = options.maxStackDepth ?? MAX_STACK_DEPTH;
    this.spawning = options.spawning ?? true;
    this.cycleOptions = options.cycle ?? {};
    this.grid = new HexGrid(this.maxStackDepth);
    this.spawner = new WaveSpawner(new SeededRandom(this.randomSeed));
    this.director = new CycleDirector(new SeededRandom(this.randomSeed ^ 0x4359434c), this.cycleOptions);
    this.bonuses = new BonusSystem(new SeededRandom(this.randomSeed ^ 0x424f4e55));
    this.upgrades = new UpgradeSystem(new SeededRandom(this.randomSeed ^ 0x55504752));
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
    } else if (command.type === 'togglePause') {
      if (this.pauseQueued) return;
      this.pauseQueued = true;
    }

    this.commandQueue.push(command);
  }

  public update(deltaMs: number): readonly GameEvent[] {
    const events: GameEvent[] = [];
    this.applyQueuedCommands(events);
    if (this.mode !== 'playing') return Object.freeze(events);

    this.elapsedMs += deltaMs;
    const modifiers = this.upgrades.getModifiers();
    const directorTick = this.director.update(deltaMs, modifiers);
    events.push(...directorTick.events);
    this.bonuses.update(deltaMs);
    const motionDeltaMs = deltaMs * this.bonuses.getMotionMultiplier();
    const profile = this.director.getWaveProfile();
    const spawnSpeed = profile.speed * modifiers.speedMultiplier;
    if (directorTick.bonusDue) this.scheduleBonus(spawnSpeed, events);
    if (this.spawning) {
      this.spawn(this.spawner.update(motionDeltaMs, {
        ...profile,
        speed: spawnSpeed,
      }));
    }
    this.moveAndLand(motionDeltaMs, events);
    this.moveAndCollectBonuses(motionDeltaMs, events);
    this.resolveAndScore(events);

    if (this.grid.isOverflowed()) {
      const rescued = this.applyLastStand(events);
      if (!rescued || this.grid.isOverflowed()) {
        this.mode = 'gameOver';
        events.push(Object.freeze({ type: 'gameOver', score: this.score }));
      }
    }

    if (directorTick.upgradeDue && this.mode === 'playing') this.enterUpgrade(events);

    return Object.freeze(events);
  }

  public getSnapshot(): GameSnapshot {
    const stacks = this.grid.snapshot().map((stack) => Object.freeze([...stack]));
    const falling = this.falling.map((block) => Object.freeze({ ...block }));
    const fallingBonuses = this.fallingBonuses.map((bonus) => Object.freeze({ ...bonus }));
    return Object.freeze({
      mode: this.mode,
      score: this.score,
      combo: this.combo,
      orientation: this.grid.orientation,
      stacks: Object.freeze(stacks),
      falling: Object.freeze(falling),
      cycle: this.director.getSnapshot(),
      bonus: this.bonuses.getSnapshot(),
      fallingBonuses: Object.freeze(fallingBonuses),
      upgrades: this.upgrades.getSnapshot(),
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
    this.director = new CycleDirector(new SeededRandom(this.randomSeed ^ 0x4359434c), this.cycleOptions);
    this.bonuses = new BonusSystem(new SeededRandom(this.randomSeed ^ 0x424f4e55));
    this.upgrades = new UpgradeSystem(new SeededRandom(this.randomSeed ^ 0x55504752));
    this.fallingBonuses = [];
    this.commandQueue.length = 0;
    this.queuedRotations = 0;
    this.pauseQueued = false;
  }

  private applyQueuedCommands(events: GameEvent[]): void {
    for (const command of this.commandQueue) {
      if (command.type === 'rotate') {
        if (this.mode === 'playing') this.grid.rotate(command.steps);
        continue;
      }
      if (command.type === 'togglePause') {
        if (this.mode === 'playing') this.mode = 'paused';
        else if (this.mode === 'paused') this.mode = 'playing';
        continue;
      }
      if (command.type === 'selectUpgrade') {
        if (this.mode === 'upgrade') {
          this.upgrades.moveSelection(command.steps);
          events.push(Object.freeze({
            type: 'upgradeSelectionChanged',
            selectedIndex: this.upgrades.getSnapshot().selectedIndex,
          }));
        }
        continue;
      }
      if (command.type === 'activateBonus') {
        if (this.mode === 'playing') this.activateBonus(events);
        continue;
      }
      if (command.type === 'confirmUpgrade' && this.mode === 'upgrade') {
        const upgrade = this.upgrades.confirm();
        if (upgrade !== null) {
          events.push(Object.freeze({
            type: 'upgradeSelected',
            upgrade,
            level: this.upgrades.getSnapshot().levels[upgrade],
          }));
          this.director.beginNextCycle();
          this.mode = 'playing';
        }
      }
    }

    this.commandQueue.length = 0;
    this.queuedRotations = 0;
    this.pauseQueued = false;
  }

  private activateBonus(events: GameEvent[]): void {
    const activation = this.bonuses.activate(
      this.grid.snapshot(),
      this.grid.orientation,
      this.upgrades.getModifiers().pulseSides,
    );
    if (activation === null) return;

    events.push(Object.freeze({ type: 'bonusActivated', bonus: activation.type }));
    if (activation.cells.length === 0) return;

    const cells = Object.freeze(activation.cells.map((cell) => Object.freeze({ ...cell })));
    const blocks = this.grid.remove(cells);
    this.score += activation.scoreDelta;
    events.push(Object.freeze({
      type: 'bonusRemoved',
      bonus: activation.type,
      cells,
      blocks,
      scoreDelta: activation.scoreDelta,
    }));
  }

  private enterUpgrade(events: GameEvent[]): void {
    const completedCycle = this.director.getSnapshot().number;
    const offer = this.upgrades.offer();
    if (offer === null) {
      this.score += completedCycle * 100;
      this.director.beginNextCycle();
      return;
    }

    this.mode = 'upgrade';
    const choices = Object.freeze(offer.choices.map((choice) => Object.freeze<UpgradeChoice>({ ...choice })));
    events.push(Object.freeze({ type: 'upgradeOffered', choices, selectedIndex: offer.selectedIndex }));
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

  private scheduleBonus(speed: number, events: GameEvent[]): void {
    const id = this.nextBlockId++;
    const bonus = this.bonuses.nextToken(id, (id - 1) % 6, speed);
    this.fallingBonuses.push(bonus);
    events.push(Object.freeze({ type: 'bonusScheduled', bonus }));
  }

  private moveAndCollectBonuses(deltaMs: number, events: GameEvent[]): void {
    const stillFalling: FallingBonus[] = [];
    for (const bonus of this.fallingBonuses) {
      const moved = Object.freeze({
        ...bonus,
        distance: bonus.distance - (bonus.speed * deltaMs) / 1000,
      });
      if (moved.distance > HEX_APOTHEM) {
        stillFalling.push(moved);
        continue;
      }

      const collection = this.bonuses.collect(bonus.type);
      events.push(Object.freeze({ type: 'bonusCollected', bonus: collection.collected }));
      if (collection.replaced !== null) {
        events.push(Object.freeze({
          type: 'bonusReplaced',
          previous: collection.replaced,
          replacement: collection.collected,
        }));
      }
    }
    this.fallingBonuses = stillFalling;
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
    const comboWindowMs = COMBO_WINDOW_MS + this.upgrades.getModifiers().comboWindowBonusMs;

    for (const group of resolution.groups) {
      const insideWindow = this.elapsedMs - this.lastMatchAtMs <= comboWindowMs;
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

  private applyLastStand(events: GameEvent[]): boolean {
    if (!this.upgrades.consumeLastStand()) return false;

    const stacks = this.grid.snapshot();
    let tallestSide = this.grid.orientation;
    for (let offset = 1; offset < stacks.length; offset += 1) {
      const side = (this.grid.orientation + offset) % stacks.length;
      if (stacks[side]!.length > stacks[tallestSide]!.length) tallestSide = side;
    }
    const cells = Object.freeze(stacks[tallestSide]!
      .map((_, index) => Object.freeze({ side: tallestSide, index }))
      .reverse());
    const blocks = this.grid.remove(cells);
    events.push(Object.freeze({ type: 'lastStand', side: tallestSide, cells, blocks }));
    return true;
  }

  private createBlock(color: BlockColor): GridBlock {
    return Object.freeze({ id: this.nextBlockId++, color });
  }
}
