import type { GameMode } from '../game/types';

export interface ScreenActions {
  start(): void;
  resume(): void;
  restart(): void;
  returnToMenu(): void;
  togglePause(): void;
}

const button = (action: string, label: string, primary = false): string =>
  `<button type="button" class="cut-button${primary ? ' primary' : ''}" data-action="${action}">${label}</button>`;

/** Semantic screens share one delegated listener; score updates preserve focus. */
export class ScreenController {
  private mode: GameMode | null = null;
  private actions: ScreenActions | null = null;

  public constructor(private readonly root: HTMLElement) {
    root.addEventListener('click', this.onClick);
  }

  public bind(actions: ScreenActions): void {
    this.actions = actions;
  }

  public render(mode: GameMode, score: number): void {
    if (mode !== this.mode) {
      this.root.dataset.transition = this.mode === 'menu' && mode === 'playing' ? 'start' : '';
      this.root.dataset.mode = mode;
      this.mode = mode;
      if (mode === 'menu') {
        this.root.innerHTML = `<section class="menu-screen" aria-labelledby="menu-title">
          <div class="menu-heading"><span class="eyebrow">SIX SIDES / ONE MORE TRY</span><h1 id="menu-title">HEXTRIS</h1></div>
          <div class="menu-actions">${button('play', 'PLAY <span aria-hidden="true">↗</span>', true)}<p class="control-hint">A / D &nbsp; or &nbsp; ← / → <span>ROTATE</span><br>ESC <span>PAUSE</span></p></div>
        </section>`;
      } else if (mode === 'playing') {
        this.root.innerHTML = `<div class="score"><span class="eyebrow">SCORE</span><output aria-label="Score"></output></div>
          <button type="button" class="pause-button" data-action="pause" aria-label="Pause game"><span aria-hidden="true">Ⅱ</span></button>`;
      } else if (mode === 'paused') {
        this.root.innerHTML = `<section class="overlay paused-screen" aria-labelledby="pause-title"><div class="screen-content"><span class="eyebrow">TAKE A BREATH</span><h1 id="pause-title">PAUSED</h1><div class="action-stack">${button('resume', 'RESUME', true)}${button('restart', 'RESTART')}${button('menu', 'MENU')}</div></div></section>`;
      } else {
        this.root.innerHTML = `<section class="overlay result-screen" aria-labelledby="result-title"><div class="screen-content"><h1 id="result-title">GAME OVER</h1><div class="result-score"><span class="eyebrow">SCORE</span><output aria-label="Final score"></output></div><div class="action-stack">${button('retry', 'RETRY', true)}${button('menu', 'MENU')}</div></div></section>`;
      }
    }
    const output = this.root.querySelector('output');
    if (output && output.textContent !== String(score)) output.textContent = String(score);
  }

  public destroy(): void {
    this.root.removeEventListener('click', this.onClick);
    this.actions = null;
  }

  private readonly onClick = (event: MouseEvent): void => {
    if (!(event.target instanceof Element)) return;
    const target = event.target.closest<HTMLButtonElement>('button[data-action]');
    if (!target || !this.root.contains(target) || !this.actions) return;
    const handlers: Record<string, () => void> = {
      play: this.actions.start, pause: this.actions.togglePause, resume: this.actions.resume,
      restart: this.actions.restart, retry: this.actions.restart, menu: this.actions.returnToMenu,
    };
    handlers[target.dataset.action ?? '']?.();
  };
}
