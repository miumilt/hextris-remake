import './styles.css';
import { APP_TITLE } from './game/constants';
import { GameEngine } from './game/GameEngine';
import { GameRuntime } from './runtime/GameRuntime';
import { InputController } from './runtime/InputController';
import { CanvasRenderer } from './render/CanvasRenderer';
import { EffectsSystem } from './render/EffectsSystem';

document.title = APP_TITLE;

const canvas = document.querySelector<HTMLCanvasElement>('#game-canvas');
if (!canvas) throw new Error('Game canvas is missing');

const engine = new GameEngine();
const renderer = new CanvasRenderer(canvas);
const effects = new EffectsSystem();
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
  render: (alpha) => renderer.render(snapshot, effectsSnapshot, alpha),
});
const input = new InputController(window, (command) => engine.enqueue(command));

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
    delete window.render_game_to_text;
    delete window.advanceTime;
  });
}
