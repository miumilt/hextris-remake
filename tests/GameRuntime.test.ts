import { afterEach, describe, expect, it, vi } from 'vitest';
import { GameEngine } from '../src/game/GameEngine';
import { FIXED_STEP_MS } from '../src/game/constants';
import { GameRuntime } from '../src/runtime/GameRuntime';

afterEach(() => vi.restoreAllMocks());

describe('GameRuntime', () => {
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
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ width: 800, height: 600 } as DOMRect);
    const game = new GameEngine();
    const runtime = new GameRuntime(game, { canvas });
    const before = game.getSnapshot();
    runtime.start();
    expect([canvas.width, canvas.height]).toEqual([1600, 1200]);
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ width: 300, height: 200 } as DOMRect);
    window.dispatchEvent(new Event('resize'));
    expect([canvas.width, canvas.height]).toEqual([600, 400]);
    vi.spyOn(window, 'devicePixelRatio', 'get').mockReturnValue(1);
    document.dispatchEvent(new Event('fullscreenchange'));
    expect([canvas.width, canvas.height]).toEqual([300, 200]);
    expect(game.getSnapshot()).toEqual(before);
    runtime.stop();
  });
});
