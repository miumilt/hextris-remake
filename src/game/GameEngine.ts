import {
  BLOCK_COLORS,
  BLOCK_DEPTH,
  COMBO_WINDOW_MS,
  HEX_APOTHEM,
  MAX_STACK_DEPTH,
  SIDE_COUNT,
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

interface DelayedRotation {
  readonly steps: -1 | 1;
  remainingMs: number;
}

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

const canonicalMs = (value: number): number => {
  const integer = Math.round(value);
  return Math.abs(value - integer) < 1e-9 ? integer : value;
};

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
  private anomalyRandom: SeededRandom;
  private director: CycleDirector;
  private bonuses: BonusSystem;
  private upgrades: UpgradeSystem;
  private fallingBonuses: FallingBonus[] = [];
  private motionElapsedMs = 0;
  private fallingBornAt = new Map<number, number>();
  private fallingBonusBornAt = new Map<number, number>();
  private readonly commandQueue: GameCommand[] = [];
  private queuedRotations = 0;
  private pauseQueued = false;
  private delayedRotations: DelayedRotation[] = [];
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
    this.anomalyRandom = new SeededRandom(this.randomSeed ^ 0x414e4f4d);
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
      if (this.queuedRotations + this.delayedRotations.length >= 2) return;
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
    if (deltaMs < 0 || !Number.isFinite(deltaMs)) throw new RangeError('deltaMs must be finite and non-negative');

    if (deltaMs === 0) {
      const directorTick = this.director.update(0, this.upgrades.getModifiers());
      events.push(...directorTick.events);
      this.resolveWorld(events);
      if (directorTick.upgradeDue && this.mode === 'playing') this.enterUpgrade(events);
      return Object.freeze(events);
    }

    let remainingMs = deltaMs;
    while (remainingMs > 0 && this.mode === 'playing') {
      const modifiers = this.upgrades.getModifiers();
      const startProfile = this.director.getWaveProfile();
      const motionMultiplier = this.bonuses.getMotionMultiplier();
      let requestedMs = Math.min(remainingMs, this.director.getNextEventMs(modifiers));
      const slowRemainingMs = this.bonuses.getSnapshot().slowRemainingMs;
      if (slowRemainingMs > 0) requestedMs = Math.min(requestedMs, slowRemainingMs);
      if (this.spawning) {
        requestedMs = Math.min(
          requestedMs,
          this.spawner.getNextEventMs(startProfile) / motionMultiplier,
        );
      }
      if (this.delayedRotations.length > 0) {
        requestedMs = Math.min(
          requestedMs,
          Math.min(...this.delayedRotations.map((rotation) => rotation.remainingMs)),
        );
      }

      const directorTick = this.director.update(requestedMs, modifiers);
      const activeDeltaMs = directorTick.consumedMs;
      events.push(...directorTick.events);
      if (activeDeltaMs <= 0) {
        if (directorTick.upgradeDue) this.enterUpgrade(events);
        break;
      }

      remainingMs -= activeDeltaMs;
      this.elapsedMs = canonicalMs(this.elapsedMs + activeDeltaMs);
      const motionDeltaMs = this.bonuses.update(activeDeltaMs);
      this.motionElapsedMs = canonicalMs(this.motionElapsedMs + motionDeltaMs);
      this.advanceDelayedRotations(activeDeltaMs);
      const profile = this.director.getWaveProfile();
      const spawnSpeed = profile.speed * modifiers.speedMultiplier;
      if (directorTick.bonusDue) this.scheduleBonus(spawnSpeed, events);
      if (this.spawning) {
        this.spawn(this.spawner.update(motionDeltaMs, {
          ...profile,
          speed: spawnSpeed,
        }));
      }
      this.moveAndLand(events);
      this.moveAndCollectBonuses(events);
      this.resolveWorld(events);

      if (directorTick.upgradeDue && this.mode === 'playing') this.enterUpgrade(events);
      if (activeDeltaMs < requestedMs) break;
    }

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
    this.anomalyRandom = new SeededRandom(this.randomSeed ^ 0x414e4f4d);
    this.director = new CycleDirector(new SeededRandom(this.randomSeed ^ 0x4359434c), this.cycleOptions);
    this.bonuses = new BonusSystem(new SeededRandom(this.randomSeed ^ 0x424f4e55));
    this.upgrades = new UpgradeSystem(new SeededRandom(this.randomSeed ^ 0x55504752));
    this.fallingBonuses = [];
    this.motionElapsedMs = 0;
    this.fallingBornAt = new Map();
    this.fallingBonusBornAt = new Map();
    this.commandQueue.length = 0;
    this.queuedRotations = 0;
    this.pauseQueued = false;
    this.delayedRotations = [];
  }

  private applyQueuedCommands(events: GameEvent[]): void {
    for (const command of this.commandQueue) {
      if (command.type === 'rotate') {
        if (this.mode === 'playing') {
          if (this.hasActiveAnomaly('inertia')) {
            this.delayedRotations.push({ steps: command.steps, remainingMs: 180 });
            events.push(Object.freeze({ type: 'rotationDelayed', steps: command.steps, remainingMs: 180 }));
          } else {
            const steps = this.hasActiveAnomaly('reverse')
              ? (-command.steps as -1 | 1)
              : command.steps;
            this.grid.rotate(steps);
          }
        }
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
    const active = new Set(this.director.getSnapshot().anomalies.map((anomaly) => anomaly.type));
    for (const request of requests) {
      let block: FallingBlock = {
        ...this.createBlock(request.color),
        lane: request.lane,
        distance: START_DISTANCE,
        speed: request.speed,
      };
      if (active.has('drift')) {
        block = {
          ...block,
          driftToLane: this.adjacentLane(request.lane),
          driftProgress: 0,
        };
      }
      if (active.has('colorShift')) {
        const colors = BLOCK_COLORS.filter((color) => color !== request.color);
        block = {
          ...block,
          shiftToColor: colors[Math.floor(this.anomalyRandom.next() * colors.length)]!,
          shiftAtDistance: 260,
        };
      }
      if (active.has('mirage')) {
        block = {
          ...block,
          mirageLane: this.adjacentLane(request.lane),
          mirageVisible: true,
        };
      }
      this.falling.push(block);
      this.fallingBornAt.set(block.id, this.motionElapsedMs);
    }
  }

  private adjacentLane(lane: number): number {
    const direction = this.anomalyRandom.next() < 0.5 ? -1 : 1;
    return ((lane + direction) % SIDE_COUNT + SIDE_COUNT) % SIDE_COUNT;
  }

  private hasActiveAnomaly(type: 'reverse' | 'inertia'): boolean {
    return this.director.getSnapshot().anomalies.some((anomaly) => anomaly.type === type);
  }

  private advanceDelayedRotations(deltaMs: number): void {
    const pending: DelayedRotation[] = [];
    for (const rotation of this.delayedRotations) {
      rotation.remainingMs = canonicalMs(rotation.remainingMs - deltaMs);
      if (rotation.remainingMs <= 0) this.grid.rotate(rotation.steps);
      else pending.push(rotation);
    }
    this.delayedRotations = pending;
  }

  private scheduleBonus(speed: number, events: GameEvent[]): void {
    const id = this.nextBlockId++;
    const bonus = this.bonuses.nextToken(id, (id - 1) % 6, speed);
    this.fallingBonuses.push(bonus);
    this.fallingBonusBornAt.set(id, this.motionElapsedMs);
    events.push(Object.freeze({ type: 'bonusScheduled', bonus }));
  }

  private moveAndCollectBonuses(events: GameEvent[]): void {
    const stillFalling: FallingBonus[] = [];
    for (const bonus of this.fallingBonuses) {
      const moved = Object.freeze({
        ...bonus,
        distance: START_DISTANCE - (
          bonus.speed * (this.motionElapsedMs - (this.fallingBonusBornAt.get(bonus.id) ?? this.motionElapsedMs))
        ) / 1000,
      });
      if (moved.distance > HEX_APOTHEM) {
        stillFalling.push(moved);
        continue;
      }

      const collection = this.bonuses.collect(bonus.type);
      this.fallingBonusBornAt.delete(bonus.id);
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

  private moveAndLand(events: GameEvent[]): void {
    const stillFalling: FallingBlock[] = [];

    for (const block of this.falling) {
      const distance = START_DISTANCE - (
        block.speed * (this.motionElapsedMs - (this.fallingBornAt.get(block.id) ?? this.motionElapsedMs))
      ) / 1000;
      let moved: FallingBlock = { ...block, distance };
      if (block.driftToLane !== undefined) {
        moved = {
          ...moved,
          driftProgress: Math.max(0, Math.min(1, (360 - distance) / 160)),
        };
      }
      if (block.mirageLane !== undefined) {
        moved = { ...moved, mirageVisible: distance > 180 };
      }
      if (
        block.shiftToColor !== undefined
        && block.shiftAtDistance !== undefined
        && block.distance > block.shiftAtDistance
        && distance <= block.shiftAtDistance
      ) {
        moved = { ...moved, color: block.shiftToColor };
        events.push(Object.freeze({
          type: 'blockColorShifted',
          blockId: block.id,
          fromColor: block.color,
          toColor: block.shiftToColor,
        }));
      }

      const collisionLane = moved.driftProgress === 1 && moved.driftToLane !== undefined
        ? moved.driftToLane
        : moved.lane;
      const side = this.grid.laneToSide(collisionLane);
      const stackLength = this.grid.snapshot()[side]!.length;
      const landingDistance = HEX_APOTHEM + stackLength * BLOCK_DEPTH;

      if (moved.distance <= landingDistance) {
        const attached: GridBlock = Object.freeze({ id: moved.id, color: moved.color });
        const cell = Object.freeze(this.grid.attach(side, attached));
        this.fallingBornAt.delete(block.id);
        events.push(Object.freeze({ type: 'blockLanded', block: attached, cell }));
      } else {
        stillFalling.push(moved);
      }
    }

    this.falling = stillFalling;
  }

  private resolveWorld(events: GameEvent[]): void {
    this.resolveAndScore(events);
    if (!this.grid.isOverflowed()) return;

    const rescued = this.applyLastStand(events);
    if (!rescued || this.grid.isOverflowed()) {
      this.mode = 'gameOver';
      events.push(Object.freeze({ type: 'gameOver', score: this.score }));
    }
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
