import type { GameMode, GameSnapshot } from '../game/types';
import type { AnomalyType, UpgradeChoice, UpgradeId } from '../game/progressionTypes';
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
  reverse: 'РЕВЕРС', mirage: 'МИРАЖ', drift: 'ДРЕЙФ', colorShift: 'СМЕНА ЦВЕТА', inertia: 'ИНЕРЦИЯ',
};
const PHASE_LABELS = { settle: 'СБОР', build: 'РОСТ', pressure: 'ДАВЛЕНИЕ', release: 'РАЗРЯДКА' } as const;
const UPGRADE_LABELS: Readonly<Record<UpgradeId, string>> = {
  stabilizer: 'СТАБИЛИЗАТОР',
  comboRelay: 'РЕЛЕ КОМБО',
  salvage: 'ДОБЫЧА',
  deepPulse: 'ГЛУБОКИЙ ИМПУЛЬС',
  anomalyShield: 'ЩИТ АНОМАЛИЙ',
  lastStand: 'ПОСЛЕДНИЙ ШАНС',
};
const escapeHtml = (value: string): string => value
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

const upgradeButton = (choice: UpgradeChoice, index: number, selected: boolean): string => {
  const id = `upgrade-${choice.id}`;
  return `<button type="button" class="upgrade-choice" data-action="upgrade" data-index="${index}" aria-pressed="${selected}" aria-labelledby="${id}-label ${id}-level" aria-describedby="${id}-description">
    <span class="choice-index" aria-hidden="true">0${index + 1}</span>
    <strong id="${id}-label">${escapeHtml(choice.label)}</strong>
    <span class="choice-description" id="${id}-description">${escapeHtml(choice.description)}</span>
    <span class="choice-level" id="${id}-level">УРОВЕНЬ ${choice.level + 1} / ${choice.maxLevel}</span>
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
          <div class="menu-heading"><span class="eyebrow">ШЕСТЬ СТОРОН / ЕЩЁ ОДНА ПОПЫТКА</span><h1 id="menu-title">HEXTRIS</h1></div>
          <div class="menu-actions">${button('play', 'ИГРАТЬ <span aria-hidden="true">↗</span>', true)}<p class="control-hint">A / D &nbsp; ИЛИ &nbsp; ← / → <span>ВРАЩАТЬ</span><br>ESC <span>ПАУЗА</span></p></div>
        </section>`;
      } else if (mode === 'playing') {
        this.root.innerHTML = `<div class="playing-hud">
          <div class="score"><span class="eyebrow">СЧЁТ</span><output aria-label="Счёт"></output></div>
          <div class="cycle-hud"><span class="cycle-label"></span><div class="cycle-rule" role="progressbar" aria-valuemin="0" aria-valuemax="100"><span></span></div></div>
          <div class="upgrade-rail" aria-label="Полученные улучшения"></div>
          <div class="bonus-host"></div><div class="anomaly-host"></div>
          <div class="presentation-host" aria-live="polite" aria-atomic="true"></div>
        </div>
          <button type="button" class="pause-button" data-action="pause" aria-label="Поставить игру на паузу"><span aria-hidden="true">Ⅱ</span></button>`;
      } else if (mode === 'upgrade') {
        const choices = snapshot.upgrades.choices;
        this.root.innerHTML = `<section class="overlay upgrade-screen" aria-labelledby="upgrade-title">
          <div class="upgrade-heading"><span class="eyebrow">ЦИКЛ ${String(snapshot.cycle.number).padStart(2, '0')} ЗАВЕРШЁН</span><h1 id="upgrade-title">ВЫБЕРИ УЛУЧШЕНИЕ</h1></div>
          <div class="upgrade-choices${choices.length === 1 ? ' singleton' : ''}">${choices.map((choice, index) => upgradeButton(choice, index, index === snapshot.upgrades.selectedIndex)).join('')}</div>
          <p class="upgrade-hint">← / → ВЫБРАТЬ &nbsp; ENTER ПОДТВЕРДИТЬ</p>
        </section>`;
      } else if (mode === 'paused') {
        this.root.innerHTML = `<section class="overlay paused-screen" aria-labelledby="pause-title"><div class="screen-content"><span class="eyebrow">МОЖНО ПЕРЕДОХНУТЬ</span><h1 id="pause-title">ПАУЗА</h1><div class="action-stack">${button('resume', 'ПРОДОЛЖИТЬ', true)}${button('restart', 'НАЧАТЬ ЗАНОВО')}${button('menu', 'В МЕНЮ')}</div></div></section>`;
      } else {
        this.root.innerHTML = `<section class="overlay result-screen" aria-labelledby="result-title"><div class="screen-content"><h1 id="result-title">ИГРА ОКОНЧЕНА</h1><div class="result-score"><span class="eyebrow">ИТОГОВЫЙ СЧЁТ</span><output aria-label="Итоговый счёт"></output></div><div class="action-stack">${button('retry', 'ЕЩЁ РАЗ', true)}${button('menu', 'В МЕНЮ')}</div></div></section>`;
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
    cycleRule?.setAttribute('aria-valuetext', `Цикл ${snapshot.cycle.number}, ${PHASE_LABELS[snapshot.cycle.phase].toLowerCase()}`);
    cycleRule?.style.setProperty('--cycle-progress', `${progress}%`);
    const cycleLabel = this.root.querySelector<HTMLElement>('.cycle-label');
    if (cycleLabel) cycleLabel.textContent = `ЦИКЛ ${String(snapshot.cycle.number).padStart(2, '0')} / ${PHASE_LABELS[snapshot.cycle.phase]}`;

    const bonusHost = this.root.querySelector<HTMLElement>('.bonus-host');
    if (bonusHost) {
      let bonusMarkup = '';
      if (snapshot.bonus.stored !== null) {
        const bonus = getBonusPresentation(snapshot.bonus.stored);
        const attention = presentation.slotAttentionRemainingMs > 0 ? ' attention' : '';
        const replaced = presentation.replacedBonus === null ? '' : ' replaced';
        const previous = presentation.replacedBonus === null
          ? null
          : getBonusPresentation(presentation.replacedBonus);
        const previousGlyph = previous === null
          ? ''
          : `<span class="bonus-glyph previous" data-tone="${previous.tone}" data-replaced-bonus="${previous.label}" aria-hidden="true">${previous.glyph}</span>`;
        bonusMarkup = `<div class="bonus-slot${attention}${replaced}" data-tone="${bonus.tone}" aria-label="Сохранённый бонус: ${bonus.label}">
          ${previousGlyph}<span class="bonus-glyph current" aria-hidden="true">${bonus.glyph}</span>
          <span class="bonus-copy"><strong>${bonus.label}</strong><small><kbd>ПРОБЕЛ</kbd><span aria-hidden="true"> — </span>ИСПОЛЬЗОВАТЬ</small></span>
        </div>`;
      }
      if (snapshot.bonus.slowRemainingMs > 0) {
        const slowProgress = Math.max(0, Math.min(1, snapshot.bonus.slowRemainingMs / 6000));
        const remainingSeconds = (snapshot.bonus.slowRemainingMs / 1000).toFixed(1).replace('.0', '');
        bonusMarkup += `<div class="slow-status${snapshot.bonus.stored === null ? '' : ' with-slot'}" aria-label="Замедление активно">
          <strong>ЗАМЕДЛЕНИЕ АКТИВНО</strong><span>${remainingSeconds} С</span>
          <div class="slow-rule" role="progressbar" aria-label="Осталось замедления" aria-valuemin="0" aria-valuemax="6000" aria-valuenow="${snapshot.bonus.slowRemainingMs}" style="--slow-progress:${Math.round(slowProgress * 100)}%"><span></span></div>
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
        .flatMap(([id, level]) => Array.from({ length: level }, (_, index) => {
          const upgradeId = id as UpgradeId;
          return `<span class="upgrade-mark" data-upgrade="${id}" title="${UPGRADE_LABELS[upgradeId]} — УРОВЕНЬ ${index + 1}"></span>`;
        }));
      upgradeRail.innerHTML = marks.join('');
      upgradeRail.hidden = marks.length === 0;
    }

    const anomalyHost = this.root.querySelector<HTMLElement>('.anomaly-host');
    if (!anomalyHost) return;
    const warning = snapshot.cycle.warning.map((type) => ANOMALY_LABELS[type]);
    const active = snapshot.cycle.anomalies.map((anomaly) => ANOMALY_LABELS[anomaly.type]);
    const text = warning.length > 0 ? `${warning.join(' + ')} ЧЕРЕЗ ${Math.ceil(snapshot.cycle.warningRemainingMs / 1000)} С`
      : active.length > 0 ? `${active.join(' + ')} АКТИВНО` : '';
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
