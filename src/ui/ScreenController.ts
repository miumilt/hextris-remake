import type { GameMode, GameSnapshot } from '../game/types';
import type { AnomalyType, UpgradeChoice } from '../game/progressionTypes';
import { getBonusPresentation } from '../presentation/bonusPresentation';
import type { PresentationSnapshot } from '../presentation/PresentationSystem';

export interface ScreenActions {
  start(): void;
  resume(): void;
  restart(): void;
  returnToMenu(): void;
  togglePause(): void;
  selectUpgrade(index: 0 | 1): void;
  confirmUpgrade(): void;
}

const button = (action: string, label: string, primary = false): string =>
  `<button type="button" class="cut-button${primary ? ' primary' : ''}" data-action="${action}">${label}</button>`;

const ANOMALY_LABELS: Readonly<Record<AnomalyType, string>> = {
  reverse: 'REVERSE', mirage: 'MIRAGE', drift: 'DRIFT', colorShift: 'COLOR SHIFT', inertia: 'INERTIA',
};
const escapeHtml = (value: string): string => value
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

const upgradeButton = (choice: UpgradeChoice, index: number, selected: boolean): string => {
  const id = `upgrade-${choice.id}`;
  return `<button type="button" class="upgrade-choice" data-action="upgrade" data-index="${index}" aria-pressed="${selected}" aria-labelledby="${id}-label ${id}-level" aria-describedby="${id}-description">
    <span class="choice-index" aria-hidden="true">0${index + 1}</span>
    <strong id="${id}-label">${escapeHtml(choice.label)}</strong>
    <span class="choice-description" id="${id}-description">${escapeHtml(choice.description)}</span>
    <span class="choice-level" id="${id}-level">LEVEL ${choice.level + 1} / ${choice.maxLevel}</span>
  </button>`;
};

/** Semantic screens share one delegated listener; score updates preserve focus. */
export class ScreenController {
  private mode: GameMode | null = null;
  private selectedUpgradeIndex: number | null = null;
  private actions: ScreenActions | null = null;

  public constructor(private readonly root: HTMLElement) {
    root.addEventListener('click', this.onClick);
  }

  public bind(actions: ScreenActions): void {
    this.actions = actions;
  }

  public render(snapshot: GameSnapshot, presentation: PresentationSnapshot): void {
    const { mode } = snapshot;
    if (mode !== this.mode) {
      if (mode !== 'upgrade') this.selectedUpgradeIndex = null;
      this.root.dataset.transition = this.mode === 'menu' && mode === 'playing' ? 'start' : '';
      this.root.dataset.mode = mode;
      this.mode = mode;
      if (mode === 'menu') {
        this.root.innerHTML = `<section class="menu-screen" aria-labelledby="menu-title">
          <div class="menu-heading"><span class="eyebrow">SIX SIDES / ONE MORE TRY</span><h1 id="menu-title">HEXTRIS</h1></div>
          <div class="menu-actions">${button('play', 'PLAY <span aria-hidden="true">↗</span>', true)}<p class="control-hint">A / D &nbsp; or &nbsp; ← / → <span>ROTATE</span><br>ESC <span>PAUSE</span></p></div>
        </section>`;
      } else if (mode === 'playing') {
        this.root.innerHTML = `<div class="playing-hud">
          <div class="score"><span class="eyebrow">SCORE</span><output aria-label="Score"></output></div>
          <div class="cycle-hud"><span class="cycle-label"></span><div class="cycle-rule" role="progressbar" aria-valuemin="0" aria-valuemax="100"><span></span></div></div>
          <div class="upgrade-rail" aria-label="Acquired upgrades"></div>
          <div class="bonus-host"></div><div class="anomaly-host"></div>
          <div class="presentation-host" aria-live="polite" aria-atomic="true"></div>
        </div>
          <button type="button" class="pause-button" data-action="pause" aria-label="Pause game"><span aria-hidden="true">Ⅱ</span></button>`;
      } else if (mode === 'upgrade') {
        const choices = snapshot.upgrades.choices;
        this.root.innerHTML = `<section class="overlay upgrade-screen" aria-labelledby="upgrade-title">
          <div class="upgrade-heading"><span class="eyebrow">CYCLE ${String(snapshot.cycle.number).padStart(2, '0')} COMPLETE</span><h1 id="upgrade-title">CHOOSE UPGRADE</h1></div>
          <div class="upgrade-choices${choices.length === 1 ? ' singleton' : ''}">${choices.map((choice, index) => upgradeButton(choice, index, index === snapshot.upgrades.selectedIndex)).join('')}</div>
          <p class="upgrade-hint">← / → SELECT &nbsp; ENTER CONFIRM</p>
        </section>`;
      } else if (mode === 'paused') {
        this.root.innerHTML = `<section class="overlay paused-screen" aria-labelledby="pause-title"><div class="screen-content"><span class="eyebrow">TAKE A BREATH</span><h1 id="pause-title">PAUSED</h1><div class="action-stack">${button('resume', 'RESUME', true)}${button('restart', 'RESTART')}${button('menu', 'MENU')}</div></div></section>`;
      } else {
        this.root.innerHTML = `<section class="overlay result-screen" aria-labelledby="result-title"><div class="screen-content"><h1 id="result-title">GAME OVER</h1><div class="result-score"><span class="eyebrow">SCORE</span><output aria-label="Final score"></output></div><div class="action-stack">${button('retry', 'RETRY', true)}${button('menu', 'MENU')}</div></div></section>`;
      }
    }
    const output = this.root.querySelector('output');
    if (output && output.textContent !== String(snapshot.score)) output.textContent = String(snapshot.score);
    if (mode === 'playing') this.renderPlayingHud(snapshot, presentation);
    if (mode === 'upgrade') this.renderUpgradeSelection(snapshot);
  }

  public destroy(): void {
    this.root.removeEventListener('click', this.onClick);
    this.actions = null;
    this.selectedUpgradeIndex = null;
  }

  private readonly onClick = (event: MouseEvent): void => {
    if (!(event.target instanceof Element)) return;
    const target = event.target.closest<HTMLButtonElement>('button[data-action]');
    if (!target || !this.root.contains(target) || !this.actions) return;
    const handlers: Record<string, () => void> = {
      play: this.actions.start, pause: this.actions.togglePause, resume: this.actions.resume,
      restart: this.actions.restart, retry: this.actions.restart, menu: this.actions.returnToMenu,
    };
    if (target.dataset.action === 'upgrade') {
      const index = Number(target.dataset.index);
      if (index === 0 || index === 1) {
        this.actions.selectUpgrade(index);
        this.actions.confirmUpgrade();
      }
      return;
    }
    handlers[target.dataset.action ?? '']?.();
  };

  private renderPlayingHud(snapshot: GameSnapshot, presentation: PresentationSnapshot): void {
    const progress = Math.round(snapshot.cycle.progress * 100);
    const cycleRule = this.root.querySelector<HTMLElement>('.cycle-rule');
    cycleRule?.setAttribute('aria-valuenow', String(progress));
    cycleRule?.setAttribute('aria-valuetext', `Cycle ${snapshot.cycle.number}, ${snapshot.cycle.phase}`);
    cycleRule?.style.setProperty('--cycle-progress', `${progress}%`);
    const cycleLabel = this.root.querySelector<HTMLElement>('.cycle-label');
    if (cycleLabel) cycleLabel.textContent = `CYCLE ${String(snapshot.cycle.number).padStart(2, '0')} / ${snapshot.cycle.phase.toUpperCase()}`;

    const bonusHost = this.root.querySelector<HTMLElement>('.bonus-host');
    if (bonusHost) {
      let bonusMarkup = '';
      if (snapshot.bonus.stored !== null) {
        const bonus = getBonusPresentation(snapshot.bonus.stored);
        const attention = presentation.slotAttentionRemainingMs > 0 ? ' attention' : '';
        const replaced = presentation.replacedBonus === null ? '' : ' replaced';
        const slowProgress = Math.max(0, Math.min(1, snapshot.bonus.slowRemainingMs / 6000));
        const slowRule = snapshot.bonus.stored === 'slow'
          ? `<div class="slow-rule" role="progressbar" aria-label="Slow remaining" aria-valuemin="0" aria-valuemax="6000" aria-valuenow="${snapshot.bonus.slowRemainingMs}" style="--slow-progress:${Math.round(slowProgress * 100)}%"><span></span></div>`
          : '';
        bonusMarkup = `<div class="bonus-slot${attention}${replaced}" data-tone="${bonus.tone}" aria-label="Stored bonus: ${bonus.label}">
          <span class="bonus-glyph" aria-hidden="true">${bonus.glyph}</span>
          <span class="bonus-copy"><strong>${bonus.label}</strong><small><kbd>SPACE</kbd><span aria-hidden="true"> — </span>ACTIVATE</small>${slowRule}</span>
        </div>`;
      }
      if (bonusHost.innerHTML !== bonusMarkup) bonusHost.innerHTML = bonusMarkup;
    }

    const presentationHost = this.root.querySelector<HTMLElement>('.presentation-host');
    if (presentationHost) {
      const notice = presentation.notice;
      const noticeMarkup = notice === null ? '' : `<div class="presentation-notice" data-tone="${notice.tone}" role="${notice.assertive ? 'alert' : 'status'}">
        <strong>${escapeHtml(notice.title)}</strong>${notice.body ? `<span>${escapeHtml(notice.body)}</span>` : ''}
      </div>`;
      if (presentationHost.innerHTML !== noticeMarkup) presentationHost.innerHTML = noticeMarkup;
    }

    const upgradeRail = this.root.querySelector<HTMLElement>('.upgrade-rail');
    if (upgradeRail) {
      const marks = Object.entries(snapshot.upgrades.levels)
        .flatMap(([id, level]) => Array.from({ length: level }, (_, index) => `<span class="upgrade-mark" data-upgrade="${id}" title="${id} level ${index + 1}"></span>`));
      upgradeRail.innerHTML = marks.join('');
      upgradeRail.hidden = marks.length === 0;
    }

    const anomalyHost = this.root.querySelector<HTMLElement>('.anomaly-host');
    if (!anomalyHost) return;
    const warning = snapshot.cycle.warning.map((type) => ANOMALY_LABELS[type]);
    const active = snapshot.cycle.anomalies.map((anomaly) => ANOMALY_LABELS[anomaly.type]);
    const text = warning.length > 0 ? `${warning.join(' + ')} IN ${Math.ceil(snapshot.cycle.warningRemainingMs / 1000)}S`
      : active.length > 0 ? `${active.join(' + ')} ACTIVE` : '';
    const anomalyMarkup = text ? `<div class="anomaly-status" role="status">${text}</div>` : '';
    if (anomalyHost.innerHTML !== anomalyMarkup) anomalyHost.innerHTML = anomalyMarkup;
  }

  private renderUpgradeSelection(snapshot: GameSnapshot): void {
    const selectionChanged = this.selectedUpgradeIndex !== snapshot.upgrades.selectedIndex;
    this.root.querySelectorAll<HTMLButtonElement>('[data-action="upgrade"]').forEach((choice, index) => {
      choice.setAttribute('aria-pressed', String(index === snapshot.upgrades.selectedIndex));
      choice.tabIndex = index === snapshot.upgrades.selectedIndex ? 0 : -1;
    });
    if (selectionChanged) {
      this.root.querySelector<HTMLButtonElement>(`[data-action="upgrade"][data-index="${snapshot.upgrades.selectedIndex}"]`)?.focus();
    }
    this.selectedUpgradeIndex = snapshot.upgrades.selectedIndex;
  }
}
