import { afterEach, describe, expect, it, vi } from 'vitest';
import { GameEngine } from '../src/game/GameEngine';
import { FIXED_STEP_MS } from '../src/game/constants';
import { GameRuntime } from '../src/runtime/GameRuntime';
import { PresentationSystem } from '../src/presentation/PresentationSystem';
import { EffectsSystem } from '../src/render/EffectsSystem';
import type { GameSnapshot } from '../src/game/types';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('GameRuntime', () => {
  it('advances the engine opening through the public fixed-step hook', () => {
    const engine = new GameEngine({ spawning: false, randomSeed: 31 });
    const presentation = new PresentationSystem();
    engine.start();
    presentation.beginRun(engine.getSnapshot().opening.previewLanes);
    const runtime = new GameRuntime(engine, {
      onStep: (ms) => presentation.update(ms, engine.getSnapshot().mode),
    });
    runtime.advanceTime(600);
    expect(engine.getSnapshot().opening.remainingMs).toBeCloseTo(600);
    expect(presentation.snapshot().opening?.stage).toBe('guides');
  });

  it('exposes concise presentation and effect status through public QA JSON', () => {
    const engine = new GameEngine({ spawning: false, randomSeed: 31 });
    const presentation = new PresentationSystem();
    const effects = new EffectsSystem();
    engine.start();
    presentation.beginRun(engine.getSnapshot().opening.previewLanes);
    const token = { id: 7, type: 'pulse' as const, lane: 2, distance: 72, speed: 150 };
    presentation.consume([{ type: 'bonusCollected', bonus: 'pulse', token }]);
    effects.consume([{ type: 'anomalyWarning', anomalies: ['reverse'], lanes: [0],
      warningMs: 2_500, atActiveMs: 95_000 }]);
    const runtime = new GameRuntime(engine, {
      getPresentationSnapshot: () => presentation.snapshot(),
      getEffectsSnapshot: () => effects.snapshot(),
    });
    const state = JSON.parse(runtime.renderGameToText());
    expect(state).toMatchObject({
      mode: 'playing', elapsedMs: 0,
      opening: { remainingMs: 1200, previewLanes: engine.getSnapshot().opening.previewLanes },
      cycle: { number: 1, phase: 'settle', progress: 0, threat: expect.any(Object) },
      presentation: { openingStage: 'assemble', noticeTitle: 'БОНУС: ИМПУЛЬС',
        transferBonus: 'pulse', transferAgeMs: 0 },
      effects: { hitStopRemainingMs: 0, activeCueKinds: expect.arrayContaining(['warning:reverse']) },
    });
    expect(JSON.stringify(state)).not.toMatch(/particles|originX|originY/);
  });

  it('freezes visual clocks while paused and clears them before restart flush', () => {
    const presentation = new PresentationSystem();
    const effects = new EffectsSystem();
    presentation.beginRun([1, 2]);
    presentation.update(500, 'playing');
    const token = { id: 7, type: 'pulse' as const, lane: 2, distance: 72, speed: 150 };
    presentation.consume([{ type: 'bonusCollected', bonus: 'pulse', token }]);
    effects.consume([{ type: 'bonusCollected', bonus: 'pulse', token }]);
    const before = { presentation: presentation.snapshot(), effects: effects.snapshot() };
    presentation.update(5_000, 'paused');
    expect(presentation.snapshot()).toEqual(before.presentation);
    effects.reset();
    presentation.reset();
    presentation.beginRun([1, 2]);
    expect(presentation.snapshot()).toMatchObject({ transfer: null, opening: { ageMs: 0 } });
    expect(effects.snapshot().hitStopRemainingMs).toBe(0);
  });

  it('replays the same seed after a partial opening and bonus transfer', () => {
    const clean = new GameEngine({ randomSeed: 31, maxStackDepth: 100 });
    clean.start();
    const pristinePreview = clean.getSnapshot().opening.previewLanes;
    const pristineEvents = clean.update(90_000);
    const pristineSnapshot = clean.getSnapshot();

    const replay = new GameEngine({ randomSeed: 31, maxStackDepth: 100 });
    const presentation = new PresentationSystem();
    replay.start();
    presentation.beginRun(replay.getSnapshot().opening.previewLanes);
    replay.update(600);
    presentation.consume([{ type: 'bonusCollected', bonus: 'pulse',
      token: { id: 7, type: 'pulse', lane: 2, distance: 72, speed: 150 } }]);
    presentation.update(300, 'playing');
    replay.restart();
    presentation.reset();
    presentation.beginRun(replay.getSnapshot().opening.previewLanes);
    expect(presentation.snapshot()).toMatchObject({ opening: { ageMs: 0, previewLanes: pristinePreview },
      transfer: null, notice: null });
    expect(replay.update(90_000)).toEqual(pristineEvents);
    expect(replay.getSnapshot()).toEqual(pristineSnapshot);
  });
  it('flushes commands and synchronizes consumers immediately without advancing time', () => {
    const game = new GameEngine({ spawning: false });
    game.start();
    let mode = 'menu';
    const order: string[] = [];
    const runtime = new GameRuntime(game, {
      onEvents: () => { mode = game.getSnapshot().mode; order.push('events'); },
      render: () => order.push(mode),
    });
    runtime.advanceTime(10);
    order.length = 0;
    game.enqueue({ type: 'togglePause' });
    runtime.flush();
    expect(order).toEqual(['events', 'paused']);
    expect(game.getSnapshot().elapsedMs).toBe(0);
    game.restart();
    runtime.resetTiming();
    runtime.flush();
    expect(mode).toBe('playing');
    runtime.advanceTime(10);
    expect(game.getSnapshot().elapsedMs).toBe(0);
  });
  it('caps real frames but advances all explicit time, renders once, and rejects invalid time', () => {
    const game = new GameEngine({ spawning: false });
    game.start();
    const render = vi.fn();
    const runtime = new GameRuntime(game, { render });
    runtime.advanceRealDelta(10_000);
    expect(game.getSnapshot().elapsedMs).toBeCloseTo(250);
    expect(render).toHaveBeenCalledOnce();
    runtime.advanceTime(1000);
    expect(game.getSnapshot().elapsedMs).toBeCloseTo(1250);
    expect(render).toHaveBeenCalledTimes(2);
    for (const value of [-1, NaN, Infinity]) runtime.advanceTime(value);
    runtime.advanceTime(FIXED_STEP_MS);
    expect(game.getSnapshot().elapsedMs).toBeCloseTo(1250 + FIXED_STEP_MS);
  });
  it('preserves fractional time and produces equal results for different chunks', () => {
    const run = (chunks: number[]) => {
      const game = new GameEngine({ spawning: false });
      game.start();
      game.debugSpawn({ lane: 0, color: 'sky', speed: 120 });
      const runtime = new GameRuntime(game);
      chunks.forEach((ms) => runtime.advanceRealDelta(ms));
      return game.getSnapshot();
    };
    expect(run([100, 100, 100])).toEqual(run([16, 17, 33, 34, 50, 50, 100]));
    expect(run([1, 1, 1, 13, 1]).elapsedMs).toBeCloseTo(FIXED_STEP_MS);
  });
  it('forwards landing events and fixed timing to effects before rendering', () => {
    const game = new GameEngine({ spawning: false });
    game.start();
    game.debugSpawn({ lane: 0, color: 'sky', speed: 100_000 });
    const order: string[] = [];
    const runtime = new GameRuntime(game, {
      onEvents: (events) => order.push(...events.map((event) => event.type)),
      onStep: () => order.push('step'),
      render: () => order.push('render'),
    });
    runtime.advanceTime(FIXED_STEP_MS);
    expect(order).toEqual(['blockLanded', 'step', 'render']);
    expect(JSON.parse(runtime.renderGameToText())).toMatchObject({
      mode: 'playing', score: 0, combo: 1, orientation: 0,
      falling: [], stacks: [{ side: 0, blocks: [{ id: 1, color: 'sky' }] }],
      coordinateSystem: 'center origin; +x right; +y down; lanes clockwise from top',
    });
  });
  it('includes falling position and elapsed time in automation state', () => {
    const game = new GameEngine({ spawning: false });
    game.start();
    game.debugSpawn({ lane: 2, color: 'coral', speed: 120 });
    const runtime = new GameRuntime(game);
    runtime.advanceTime(1000);
    const state = JSON.parse(runtime.renderGameToText());
    expect(state.falling).toEqual([{ id: 1, lane: 2, color: 'coral', speed: 120, distance: 400 }]);
    expect(state.elapsedMs).toBeCloseTo(1000);
    expect(state.stacks).toEqual([]);
  });
  it('delivers empty events before each step and render with current movement, rotation, and pause state', () => {
    const game = new GameEngine({ spawning: false });
    game.start();
    game.debugSpawn({ lane: 0, color: 'sky', speed: 120 });
    let snapshot = game.getSnapshot();
    const order: string[] = [];
    const observed: { mode: string; orientation: number; distance: number }[] = [];
    const runtime = new GameRuntime(game, {
      onEvents: (events) => {
        order.push(`events:${events.length}`);
        snapshot = game.getSnapshot();
      },
      onStep: () => {
        order.push(`step:${snapshot.mode}`);
      },
      render: () => {
        order.push(`render:${snapshot.mode}`);
        observed.push({ mode: snapshot.mode, orientation: snapshot.orientation, distance: snapshot.falling[0]!.distance });
      },
    });
    runtime.advanceTime(FIXED_STEP_MS);
    game.enqueue({ type: 'rotate', steps: 1 });
    runtime.advanceTime(FIXED_STEP_MS);
    game.enqueue({ type: 'togglePause' });
    runtime.advanceTime(FIXED_STEP_MS);
    expect(order).toEqual([
      'events:0', 'step:playing', 'render:playing',
      'events:0', 'step:playing', 'render:playing',
      'events:0', 'step:paused', 'render:paused',
    ]);
    expect(observed).toEqual([
      { mode: 'playing', orientation: 0, distance: 518 },
      { mode: 'playing', orientation: 1, distance: 516 },
      { mode: 'paused', orientation: 1, distance: 516 },
    ]);
  });
  it('resets fractional time when starting a new session', () => {
    const game = new GameEngine({ spawning: false });
    game.start();
    const runtime = new GameRuntime(game);
    runtime.advanceTime(10);
    game.restart();
    runtime.resetTiming();
    runtime.advanceTime(10);
    expect(game.getSnapshot().elapsedMs).toBe(0);
  });
  it('owns one RAF loop, cancels it on stop, and resumes without a time jump', () => {
    const frames = new Map<number, FrameRequestCallback>();
    let id = 0;
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => { frames.set(++id, callback); return id; });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((handle) => { frames.delete(handle); });
    const frame = (time: number) => { const entry = [...frames][0]!; frames.delete(entry[0]); entry[1](time); };
    const game = new GameEngine({ spawning: false });
    game.start();
    const runtime = new GameRuntime(game);
    runtime.start(); runtime.start();
    expect(frames.size).toBe(1);
    frame(100); frame(200);
    expect(game.getSnapshot().elapsedMs).toBeCloseTo(100);
    runtime.stop();
    expect(frames.size).toBe(0);
    runtime.start(); frame(20_000);
    expect(game.getSnapshot().elapsedMs).toBeCloseTo(100);
    runtime.stop();
  });
  it('pauses immediately on hiding, does not auto-resume, and removes lifecycle handlers', () => {
    vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(1);
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    const game = new GameEngine({ spawning: false });
    game.start();
    const runtime = new GameRuntime(game);
    runtime.start();
    hidden.mockReturnValue(true);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(game.getSnapshot().mode).toBe('paused');
    hidden.mockReturnValue(false);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(game.getSnapshot().mode).toBe('paused');
    runtime.stop(); game.restart();
    hidden.mockReturnValue(true);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(game.getSnapshot().mode).toBe('playing');
  });
  it('resizes canvas at DPR on resize and fullscreenchange without changing game state', () => {
    vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(1);
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
    vi.spyOn(window, 'devicePixelRatio', 'get').mockReturnValue(2);
    const canvas = document.createElement('canvas');
    const width = vi.spyOn(canvas, 'clientWidth', 'get').mockReturnValue(800);
    const height = vi.spyOn(canvas, 'clientHeight', 'get').mockReturnValue(600);
    // During enter-field, scale and rotation distort this rectangle.
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ width: 700, height: 540 } as DOMRect);
    const game = new GameEngine();
    const runtime = new GameRuntime(game, { canvas });
    const before = game.getSnapshot();
    runtime.start();
    expect([canvas.width, canvas.height]).toEqual([1600, 1200]);
    width.mockReturnValue(300);
    height.mockReturnValue(200);
    window.dispatchEvent(new Event('resize'));
    expect([canvas.width, canvas.height]).toEqual([600, 400]);
    vi.spyOn(window, 'devicePixelRatio', 'get').mockReturnValue(1);
    document.dispatchEvent(new Event('fullscreenchange'));
    expect([canvas.width, canvas.height]).toEqual([300, 200]);
    expect(game.getSnapshot()).toEqual(before);
    runtime.stop();
  });
  it('uses the viewport when canvas layout dimensions are unavailable', () => {
    const canvas = document.createElement('canvas');
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1280);
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(720);
    vi.spyOn(window, 'devicePixelRatio', 'get').mockReturnValue(1);
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ width: 900, height: 500 } as DOMRect);
    const runtime = new GameRuntime(new GameEngine(), { canvas });
    runtime.resize();
    expect([canvas.width, canvas.height]).toEqual([1280, 720]);
  });

  it('composes presentation and effects before a four-input canvas render and resets both before flush', async () => {
    vi.resetModules();
    document.body.innerHTML = '<canvas id="game-canvas"></canvas><div id="ui-root"></div>';
    vi.stubGlobal('matchMedia', () => ({ matches: false }));

    const seeded = new GameEngine({ spawning: false });
    seeded.start();
    let snapshot: GameSnapshot = { ...seeded.getSnapshot(), elapsedMs: 100, mode: 'menu' };
    const order: string[] = [];
    const renderInputs: unknown[][] = [];
    let runtimeOptions: {
      onEvents?(events: readonly unknown[]): void;
      onStep?(ms: number): void;
      render?(alpha: number): void;
    } = {};
    let screenActions: { start(): void } | null = null;
    let effectsState = { channel: 'effects-live' };
    let presentationState = { channel: 'presentation-live', opening: null as null | { ageMs: number; previewLanes: readonly number[] } };

    class FakeEngine {
      public getSnapshot() { order.push('engine-snapshot'); return snapshot; }
      public enqueue() {}
      public start() { snapshot = { ...snapshot, elapsedMs: 0, mode: 'playing' }; }
      public restart() { snapshot = { ...snapshot, elapsedMs: 0, mode: 'playing' }; }
      public returnToMenu() { snapshot = { ...snapshot, elapsedMs: 0, mode: 'menu' }; }
    }
    class FakeEffects {
      public consume() { order.push('effects-consume'); }
      public update() { order.push('effects-update'); }
      public snapshot() { return effectsState; }
      public reset() { order.push('effects-reset'); effectsState = { channel: 'effects-empty' }; }
    }
    class FakePresentation {
      public consume() { order.push('presentation-consume'); }
      public update() { order.push('presentation-update'); }
      public snapshot() { return presentationState; }
      public reset() { order.push('presentation-reset'); presentationState = { channel: 'presentation-empty', opening: null }; }
      public beginRun(lanes: readonly number[]) {
        order.push('presentation-begin');
        presentationState = { channel: 'presentation-run', opening: { ageMs: 0, previewLanes: lanes } };
      }
    }
    class FakeRenderer {
      public resize() {}
      public render(...inputs: unknown[]) { order.push('canvas-render'); renderInputs.push(inputs); }
    }
    class FakeScreens {
      public bind(actions: { start(): void }) { screenActions = actions; }
      public render() { order.push('screen-render'); }
      public destroy() {}
    }
    class FakeInput { public start() {} public stop() {} }
    class FakeRuntime {
      public constructor(_engine: unknown, options: typeof runtimeOptions) { runtimeOptions = options; }
      public start() {}
      public stop() {}
      public resetTiming() { order.push('runtime-reset'); }
      public flush() {
        order.push('runtime-flush');
        runtimeOptions.onEvents?.([]);
        runtimeOptions.render?.(0);
      }
      public advanceTime() {}
      public renderGameToText() { return '{}'; }
    }

    const mocked = [
      '../src/game/GameEngine', '../src/render/EffectsSystem', '../src/presentation/PresentationSystem',
      '../src/render/CanvasRenderer', '../src/ui/ScreenController', '../src/runtime/InputController',
      '../src/runtime/GameRuntime',
    ];
    vi.doMock('../src/game/GameEngine', () => ({ GameEngine: FakeEngine }));
    vi.doMock('../src/render/EffectsSystem', () => ({ EffectsSystem: FakeEffects }));
    vi.doMock('../src/presentation/PresentationSystem', () => ({ PresentationSystem: FakePresentation }));
    vi.doMock('../src/render/CanvasRenderer', () => ({ CanvasRenderer: FakeRenderer }));
    vi.doMock('../src/ui/ScreenController', () => ({ ScreenController: FakeScreens }));
    vi.doMock('../src/runtime/InputController', () => ({ InputController: FakeInput }));
    vi.doMock('../src/runtime/GameRuntime', () => ({ GameRuntime: FakeRuntime }));

    try {
      await import('../src/main');
      snapshot = { ...snapshot, mode: 'playing' };
      runtimeOptions.onEvents?.([]);
      order.length = 0;
      runtimeOptions.onEvents?.([]);
      runtimeOptions.onStep?.(FIXED_STEP_MS);
      runtimeOptions.render?.(0.5);
      expect(order).toEqual([
        'engine-snapshot', 'presentation-consume', 'effects-consume',
        'engine-snapshot', 'presentation-update', 'effects-update',
        'canvas-render', 'screen-render',
      ]);
      expect(renderInputs.at(-1)).toHaveLength(4);

      snapshot = { ...snapshot, mode: 'menu', elapsedMs: 100 };
      order.length = 0;
      screenActions!.start();
      expect(order.slice(0, 5)).toEqual([
        'effects-reset', 'presentation-reset', 'engine-snapshot', 'presentation-begin', 'runtime-reset',
      ]);
      expect(renderInputs.at(-1)?.[1]).toEqual({ channel: 'effects-empty' });
      expect(renderInputs.at(-1)?.[2]).toEqual({ channel: 'presentation-run',
        opening: { ageMs: 0, previewLanes: seeded.getSnapshot().opening.previewLanes } });
    } finally {
      for (const module of mocked) vi.doUnmock(module);
      vi.resetModules();
    }
  });
});
