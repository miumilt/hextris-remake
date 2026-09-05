import { FIXED_STEP_MS } from '../game/constants';
import type { GameCommand, GameEvent, GameSnapshot } from '../game/types';

export interface RuntimeEngine {
  update(ms: number): readonly GameEvent[];
  getSnapshot(): GameSnapshot;
  enqueue(command: GameCommand): void;
}

export interface GameRuntimeOptions {
  readonly host?: Window;
  readonly canvas?: HTMLCanvasElement;
  readonly onEvents?: (events: readonly GameEvent[]) => void;
  readonly onStep?: (ms: number) => void;
  readonly render?: (alpha: number) => void;
  readonly onResize?: (width: number, height: number, dpr: number) => void;
}

export class GameRuntime {
  private accumulatorMs = 0;
  private lastFrameTime: number | null = null;
  private frameId: number | null = null;
  private running = false;
  private readonly host: Window;

  public constructor(
    private readonly engine: RuntimeEngine,
    private readonly options: GameRuntimeOptions = {},
  ) {
    this.host = options.host ?? window;
  }

  public start(): void {
    if (this.running) return;
    this.running = true;
    this.resetTiming();
    this.host.addEventListener('resize', this.resize);
    this.host.document.addEventListener('fullscreenchange', this.resize);
    this.host.document.addEventListener('visibilitychange', this.onVisibilityChange);
    this.resize();
    this.onVisibilityChange();
    this.frameId = this.host.requestAnimationFrame(this.onFrame);
  }

  public stop(): void {
    this.running = false;
    if (this.frameId !== null) this.host.cancelAnimationFrame(this.frameId);
    this.frameId = null;
    this.host.removeEventListener('resize', this.resize);
    this.host.document.removeEventListener('fullscreenchange', this.resize);
    this.host.document.removeEventListener('visibilitychange', this.onVisibilityChange);
    this.resetTiming();
  }

  /** Call alongside engine.start/restart/returnToMenu to discard the previous session's timing. */
  public resetTiming(): void {
    this.accumulatorMs = 0;
    this.lastFrameTime = null;
  }

  public advanceRealDelta(ms: number): void {
    if (!Number.isFinite(ms) || ms < 0) return;
    this.stepDuration(Math.min(ms, 250 - this.accumulatorMs));
  }

  public advanceTime(ms: number): void {
    if (!Number.isFinite(ms) || ms < 0) return;
    // Explicit stepping owns this interval; the next RAF establishes a fresh baseline.
    this.lastFrameTime = null;
    this.stepDuration(ms);
  }

  public readonly resize = (): void => {
    const canvas = this.options.canvas;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const width = rect.width || this.host.innerWidth;
    const height = rect.height || this.host.innerHeight;
    const dpr = this.host.devicePixelRatio || 1;
    const pixelWidth = Math.max(1, Math.round(width * dpr));
    const pixelHeight = Math.max(1, Math.round(height * dpr));
    if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
    if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
    this.options.onResize?.(width, height, dpr);
    this.options.render?.(this.accumulatorMs / FIXED_STEP_MS);
  };

  public renderGameToText(): string {
    const snapshot = this.engine.getSnapshot();
    return JSON.stringify({
      ...snapshot,
      stacks: snapshot.stacks.flatMap((blocks, side) => blocks.length ? [{ side, blocks }] : []),
      coordinateSystem: 'center origin; +x right; +y down; lanes clockwise from top',
    });
  }

  private stepDuration(durationMs: number): void {
    this.accumulatorMs += durationMs;
    // Tolerance prevents floating point subtraction dropping the 60th step in 1000 ms.
    while (this.accumulatorMs + 1e-8 >= FIXED_STEP_MS) {
      const events = this.engine.update(FIXED_STEP_MS);
      this.options.onEvents?.(events);
      this.options.onStep?.(FIXED_STEP_MS);
      this.accumulatorMs = Math.max(0, this.accumulatorMs - FIXED_STEP_MS);
    }
    this.options.render?.(this.accumulatorMs / FIXED_STEP_MS);
  }

  private readonly onFrame = (time: number): void => {
    if (!this.running) return;
    const delta = this.lastFrameTime === null ? 0 : time - this.lastFrameTime;
    this.lastFrameTime = time;
    this.advanceRealDelta(delta);
    this.frameId = this.host.requestAnimationFrame(this.onFrame);
  };

  private readonly onVisibilityChange = (): void => {
    this.resetTiming();
    if (this.host.document.hidden && this.engine.getSnapshot().mode === 'playing') {
      this.engine.enqueue({ type: 'togglePause' });
      // Flush the pause now: hidden tabs may not receive another animation frame.
      const events = this.engine.update(0);
      this.options.onEvents?.(events);
      this.options.render?.(0);
    }
  };
}
