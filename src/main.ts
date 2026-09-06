import './styles.css';
import { APP_TITLE } from './game/constants';
import { GameEngine } from './game/GameEngine';
import { GameRuntime } from './runtime/GameRuntime';
import { InputController } from './runtime/InputController';
import { CanvasRenderer } from './render/CanvasRenderer';
import { EffectsSystem } from './render/EffectsSystem';
import { ScreenController } from './ui/ScreenController';

document.title = APP_TITLE;

const canvas = document.querySelector<HTMLCanvasElement>('#game-canvas');
const root = document.querySelector<HTMLElement>('#ui-root');
if (!canvas || !root) throw new Error('Game canvas or screen root is missing');

const engine = new GameEngine();
const effects = new EffectsSystem();
const renderer = new CanvasRenderer(canvas);
const screens = new ScreenController(root);
const input = new InputController(window, (command) => engine.enqueue(command), () => engine.getSnapshot().mode);
let snapshot = engine.getSnapshot();
let effectsSnapshot = effects.snapshot();
const runtime = new GameRuntime(engine, {
  canvas,
  onEvents: (events) => {
    const next = engine.getSnapshot();
    if (next.elapsedMs < snapshot.elapsedMs || (next.mode === 'menu') !== (snapshot.mode === 'menu')) effects.reset();
    snapshot = next;
    effects.consume(events, { orientation: snapshot.orientation });
    effectsSnapshot = effects.snapshot();
  },
  onStep: (ms) => {
    snapshot = engine.getSnapshot();
    if (snapshot.mode !== 'paused') effects.update(ms);
    effectsSnapshot = effects.snapshot();
  },
  onResize: (width, height, dpr) => renderer.resize(width, height, dpr),
  render: (alpha) => {
    renderer.render(snapshot, effectsSnapshot, alpha);
    screens.render(snapshot);
  },
});

const resetSession = (action: () => void): void => {
  action();
  effects.reset();
  effectsSnapshot = effects.snapshot();
  runtime.resetTiming();
  runtime.flush();
};
const togglePause = (): void => {
  engine.enqueue({ type: 'togglePause' });
  runtime.resetTiming();
  runtime.flush();
};
const selectUpgrade = (index: 0 | 1): void => {
  const selectedIndex = engine.getSnapshot().upgrades.selectedIndex;
  const steps = index - selectedIndex;
  if (steps !== 0) engine.enqueue({ type: 'selectUpgrade', steps: steps < 0 ? -1 : 1 });
  runtime.flush();
};
const confirmUpgrade = (): void => {
  engine.enqueue({ type: 'confirmUpgrade' });
  runtime.resetTiming();
  runtime.flush();
};
screens.bind({
  start: () => resetSession(() => engine.start()),
  restart: () => resetSession(() => engine.restart()),
  returnToMenu: () => resetSession(() => engine.returnToMenu()),
  resume: togglePause,
  togglePause,
  selectUpgrade,
  confirmUpgrade,
});

Object.assign(window, {
  render_game_to_text: () => runtime.renderGameToText(),
  advanceTime: (ms: number) => runtime.advanceTime(ms),
});

input.start();
runtime.start();

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    input.stop();
    runtime.stop();
    screens.destroy();
    delete window.render_game_to_text;
    delete window.advanceTime;
  });
}
