import type { GameCommand } from '../game/types';

export class InputController {
  private started = false;

  public constructor(
    private readonly host: Window,
    private readonly send: (command: GameCommand) => void,
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
      // Attached sides render at side - orientation, so positive turns go left.
      this.send({ type: 'rotate', steps: 1 });
    } else if (key === 'd' || key === 'arrowright') {
      event.preventDefault();
      this.send({ type: 'rotate', steps: -1 });
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
