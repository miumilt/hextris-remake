import type { GameCommand, GameMode } from '../game/types';

export class InputController {
  private started = false;

  public constructor(
    private readonly host: Window,
    private readonly send: (command: GameCommand) => void,
    private readonly getMode: () => GameMode = () => 'playing',
  ) {}

  public start(): void {
    if (this.started) return;
    this.started = true;
    this.host.addEventListener('keydown', this.onKeyDown);
  }

  public stop(): void {
    this.started = false;
    this.host.removeEventListener('keydown', this.onKeyDown);
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.repeat) return;
    const key = event.key.toLowerCase();
    const document = this.host.document;
    if (key === 'a' || key === 'arrowleft') {
      event.preventDefault();
      if (this.getMode() === 'upgrade') this.send({ type: 'selectUpgrade', steps: -1 });
      else if (this.getMode() === 'playing') {
        // Attached sides render at side - orientation, so positive turns go left.
        this.send({ type: 'rotate', steps: 1 });
      }
    } else if (key === 'd' || key === 'arrowright') {
      event.preventDefault();
      if (this.getMode() === 'upgrade') this.send({ type: 'selectUpgrade', steps: 1 });
      else if (this.getMode() === 'playing') this.send({ type: 'rotate', steps: -1 });
    } else if (key === ' ' || key === 'space' || key === 'spacebar') {
      const mode = this.getMode();
      if (mode === 'playing' || mode === 'upgrade') {
        event.preventDefault();
        this.send({ type: mode === 'playing' ? 'activateBonus' : 'confirmUpgrade' });
      }
    } else if (key === 'enter' && this.getMode() === 'upgrade') {
      event.preventDefault();
      this.send({ type: 'confirmUpgrade' });
    } else if (key === 'escape' && !document.fullscreenElement) {
      event.preventDefault();
      this.send({ type: 'togglePause' });
    } else if (key === 'f') {
      // Fullscreen may be unsupported or rejected by browser policy.
      if (document.fullscreenElement) void document.exitFullscreen?.().catch(() => {});
      else void document.documentElement.requestFullscreen?.().catch(() => {});
    }
  };
}
