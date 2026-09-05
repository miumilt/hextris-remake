import './styles.css';
import { APP_TITLE } from './game/constants';
import { GameEngine } from './game/GameEngine';
import { GameRuntime } from './runtime/GameRuntime';
import { InputController } from './runtime/InputController';

document.title = APP_TITLE;

const canvas = document.querySelector<HTMLCanvasElement>('#game-canvas');
if (!canvas) throw new Error('Game canvas is missing');

const engine = new GameEngine();
const runtime = new GameRuntime(engine, { canvas });
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
