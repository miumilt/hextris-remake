import { afterEach, describe, expect, it, vi } from 'vitest';
import { GameEngine } from '../src/game/GameEngine';
import { InputController } from '../src/runtime/InputController';

const cleanups: (() => void)[] = [];
afterEach(() => { cleanups.splice(0).forEach((cleanup) => cleanup()); vi.restoreAllMocks(); });

function setup() {
  const game = new GameEngine({ spawning: false });
  game.start();
  const input = new InputController(window, (command) => game.enqueue(command));
  input.start();
  cleanups.push(() => input.stop());
  return { game, input };
}

describe('InputController', () => {
  it.each([['ArrowLeft', 5], ['a', 5], ['A', 5], ['ArrowRight', 1], ['d', 1], ['D', 1]] as const)(
    'maps %s to one rotation and prevents browser navigation', (key, orientation) => {
      const { game } = setup();
      const event = new KeyboardEvent('keydown', { key, cancelable: true });
      window.dispatchEvent(event);
      game.update(0);
      expect(game.getSnapshot().orientation).toBe(orientation);
      expect(event.defaultPrevented).toBe(true);
    },
  );
  it('ignores repeats and removes its listener on stop; start is idempotent', () => {
    const { game, input } = setup();
    input.start();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', repeat: true }));
    game.update(0);
    expect(game.getSnapshot().orientation).toBe(0);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd' }));
    game.update(0);
    expect(game.getSnapshot().orientation).toBe(1);
    input.stop();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd' }));
    game.update(0);
    expect(game.getSnapshot().orientation).toBe(1);
    input.start();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd' }));
    game.update(0);
    expect(game.getSnapshot().orientation).toBe(2);
  });
  it('pauses and resumes with Escape but leaves fullscreen Escape to the browser', () => {
    const { game } = setup();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    game.update(0);
    expect(game.getSnapshot().mode).toBe('paused');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    game.update(0);
    expect(game.getSnapshot().mode).toBe('playing');
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: document.documentElement });
    cleanups.push(() => { Reflect.deleteProperty(document, 'fullscreenElement'); });
    const event = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
    window.dispatchEvent(event);
    game.update(0);
    expect(game.getSnapshot().mode).toBe('playing');
    expect(event.defaultPrevented).toBe(false);
  });
  it('requests fullscreen with F and handles rejected requests', async () => {
    setup();
    const request = vi.fn().mockRejectedValue(new Error('denied'));
    Object.defineProperty(document.documentElement, 'requestFullscreen', { configurable: true, value: request });
    cleanups.push(() => { delete (document.documentElement as Partial<HTMLElement>).requestFullscreen; });
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F' }));
    await Promise.resolve();
    expect(request).toHaveBeenCalledOnce();
  });
  it('exits fullscreen with F and handles rejected exits', async () => {
    setup();
    const exit = vi.fn().mockRejectedValue(new Error('denied'));
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: document.documentElement });
    Object.defineProperty(document, 'exitFullscreen', { configurable: true, value: exit });
    cleanups.push(() => {
      Reflect.deleteProperty(document, 'fullscreenElement');
      Reflect.deleteProperty(document, 'exitFullscreen');
    });
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f' }));
    await Promise.resolve();
    expect(exit).toHaveBeenCalledOnce();
  });
});
