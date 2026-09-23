import type { AnomalyType, BonusType, FallingBonus } from '../game/progressionTypes';
import type { GameEvent, GameMode } from '../game/types';
import { getBonusPresentation } from './bonusPresentation';

export type NoticePriority = 1 | 2 | 3 | 4;
export type PresentationTone = 'ivory' | 'sky' | 'amber' | 'teal' | 'coral';

export type PresentationEvent =
  | Exclude<GameEvent, { readonly type: 'bonusCollected' }>
  | {
      readonly type: 'bonusCollected';
      readonly bonus: BonusType;
      readonly token: FallingBonus;
    };

export interface PresentationNotice {
  readonly title: string;
  readonly body: string;
  readonly tone: PresentationTone;
  readonly priority: NoticePriority;
  readonly ageMs: number;
  readonly lifetimeMs: number;
  readonly assertive: boolean;
}

export interface BonusTransfer {
  readonly bonus: BonusType;
  readonly lane: number;
  readonly distance: number;
  readonly ageMs: number;
  readonly delayMs: 90;
  readonly lifetimeMs: 800;
}

export type OpeningStage = 'assemble' | 'guides' | 'ready';

export interface OpeningPresentation {
  readonly stage: OpeningStage;
  readonly ageMs: number;
  readonly lifetimeMs: 1200;
  readonly previewLanes: readonly number[];
}

export interface PresentationSnapshot {
  // Optional during the renderer/HUD migration; snapshots produced here always include opening.
  readonly opening?: OpeningPresentation | null;
  readonly notice: PresentationNotice | null;
  readonly queuedNotices: readonly PresentationNotice[];
  readonly transfer: BonusTransfer | null;
  readonly slotAttentionRemainingMs: number;
  readonly replacedBonus: BonusType | null;
}

interface MutableNotice extends Omit<PresentationNotice, 'ageMs'> { ageMs: number; }
interface MutableTransfer extends Omit<BonusTransfer, 'ageMs'> { ageMs: number; }
interface MutableOpening { ageMs: number; previewLanes: readonly number[]; }

const MAX_VISIBLE_NOTICES = 3;
const COLLECTION_LIFETIME_MS = 1700;
const REPLACEMENT_LIFETIME_MS = 1700;
const ACTIVATION_LIFETIME_MS = 900;
const FIRST_ANOMALY_LIFETIME_MS = 1800;
const REPLACED_GLYPH_LIFETIME_MS = 800;
const SLOT_ATTENTION_MS = 2500;

export const ANOMALY_PRESENTATION: Readonly<Record<AnomalyType, { label: string; explanation: string }>> = Object.freeze({
  reverse: Object.freeze({ label: 'РЕВЕРС', explanation: 'УПРАВЛЕНИЕ МЕНЯЕТСЯ МЕСТАМИ' }),
  mirage: Object.freeze({ label: 'МИРАЖ', explanation: 'СЛЕДУЙ ЗА САМЫМ ПЛОТНЫМ СЛЕДОМ' }),
  drift: Object.freeze({ label: 'ДРЕЙФ', explanation: 'КОНТУР ПОКАЗЫВАЕТ МЕСТО ПРИЗЕМЛЕНИЯ' }),
  colorShift: Object.freeze({ label: 'СМЕНА ЦВЕТА', explanation: 'ВНУТРЕННЯЯ ГРАНЬ ПОКАЗЫВАЕТ БУДУЩИЙ ЦВЕТ' }),
  inertia: Object.freeze({ label: 'ИНЕРЦИЯ', explanation: 'ПОВОРОТ СРАБАТЫВАЕТ С ЗАДЕРЖКОЙ' }),
});

const FALLBACK_ANOMALY_PRESENTATION = Object.freeze({
  label: 'АНОМАЛИЯ',
  explanation: 'СЛЕДИ ЗА ПРЕДУПРЕЖДЕНИЕМ',
});

const openingStageAt = (ageMs: number): OpeningStage =>
  ageMs < 320 ? 'assemble' : ageMs < 760 ? 'guides' : 'ready';

export class PresentationSystem {
  private opening: MutableOpening | null = null;
  private notice: MutableNotice | null = null;
  private queuedNotices: MutableNotice[] = [];
  private transfer: MutableTransfer | null = null;
  private slotAttentionRemainingMs = 0;
  private replacedBonus: BonusType | null = null;
  private replacedBonusRemainingMs = 0;
  private readonly firstSeenAnomalies = new Set<AnomalyType>();
  private announcedPressureCycle: number | null = null;

  public beginRun(previewLanes: readonly number[]): void {
    this.reset();
    this.opening = { ageMs: 0, previewLanes: Object.freeze([...previewLanes]) };
  }

  public consume(events: readonly PresentationEvent[]): void {
    const candidates: MutableNotice[] = [];
    const firstSeenCandidates: { notice: MutableNotice; anomalies: readonly AnomalyType[] }[] = [];
    for (const event of events) {
      switch (event.type) {
        case 'bonusCollected': {
          const bonus = getBonusPresentation(event.bonus);
          const replacedInBatch = events.some((candidate) => candidate.type === 'bonusReplaced'
            && candidate.replacement === event.bonus);
          if (!replacedInBatch) {
            candidates.push(this.createNotice(
              `БОНУС: ${bonus.label}`, bonus.description, bonus.tone, 3, COLLECTION_LIFETIME_MS,
            ));
          }
          this.transfer = {
            bonus: event.bonus,
            lane: event.token.lane,
            distance: event.token.distance,
            ageMs: 0,
            delayMs: 90,
            lifetimeMs: 800,
          };
          this.slotAttentionRemainingMs = SLOT_ATTENTION_MS;
          break;
        }
        case 'bonusReplaced': {
          const replacement = getBonusPresentation(event.replacement);
          const previous = getBonusPresentation(event.previous);
          candidates.push(this.createNotice(
            `${replacement.label} ЗАМЕНИЛ ${previous.label}`,
            replacement.description,
            replacement.tone,
            3,
            REPLACEMENT_LIFETIME_MS,
          ));
          this.replacedBonus = event.previous;
          this.replacedBonusRemainingMs = REPLACED_GLYPH_LIFETIME_MS;
          break;
        }
        case 'bonusActivated': {
          const bonus = getBonusPresentation(event.bonus);
          candidates.push(this.createNotice(
            `${bonus.label} АКТИВИРОВАН`, bonus.activationCopy, bonus.tone, 4, ACTIVATION_LIFETIME_MS,
          ));
          break;
        }
        case 'matchCleared':
          if (event.chain > 1) {
            candidates.push(this.createNotice(`СЕРИЯ ×${event.chain}`, '', 'amber', 1, 620));
          }
          break;
        case 'lastStand':
          candidates.push(this.createNotice('ПОСЛЕДНИЙ ШАНС', 'ПЕРЕПОЛНЕНИЕ ПЕРЕЖИТО', 'coral', 4, 900, true));
          break;
        case 'gameOver':
          candidates.push(this.createNotice('ИГРА ОКОНЧЕНА', `ИТОГОВЫЙ СЧЁТ ${event.score}`, 'ivory', 4, 900, true));
          break;
        case 'phaseChanged':
          if (event.phase === 'pressure' && this.announcedPressureCycle !== event.cycle) {
            this.announcedPressureCycle = event.cycle;
            candidates.push(this.createNotice('ДАВЛЕНИЕ', '', 'ivory', 2, 900));
          }
          break;
        case 'anomalyStarted': {
          const descriptions = event.anomalies.map((anomaly) => {
            const metadata = Object.prototype.hasOwnProperty.call(ANOMALY_PRESENTATION, anomaly)
              ? ANOMALY_PRESENTATION[anomaly]
              : FALLBACK_ANOMALY_PRESENTATION;
            const firstSeen = !this.firstSeenAnomalies.has(anomaly);
            return { anomaly, metadata, firstSeen };
          });
          if (descriptions.length > 0) {
            const title = descriptions.map(({ metadata }) => metadata.label).join(' + ');
            const body = descriptions.filter(({ firstSeen }) => firstSeen)
              .map(({ metadata }) => metadata.explanation).join(' · ');
            const notice = this.createNotice(title, body, 'coral', 3,
              body ? FIRST_ANOMALY_LIFETIME_MS : 900);
            candidates.push(notice);
            firstSeenCandidates.push({
              notice,
              anomalies: descriptions.filter(({ firstSeen }) => firstSeen).map(({ anomaly }) => anomaly),
            });
          }
          break;
        }
      }
    }
    this.mergeNotices(candidates);
    for (const { notice, anomalies } of firstSeenCandidates) {
      if (this.notice !== notice && !this.queuedNotices.includes(notice)) continue;
      for (const anomaly of anomalies) this.firstSeenAnomalies.add(anomaly);
    }
  }

  public update(deltaMs: number, mode: GameMode = 'playing'): void {
    if (mode !== 'playing') return;
    const dt = Number.isFinite(deltaMs) && deltaMs > 0 ? deltaMs : 0;
    if (dt === 0) return;
    if (this.opening !== null) {
      this.opening.ageMs += dt;
      if (this.opening.ageMs >= 1200) this.opening = null;
    }
    let noticeTimeMs = dt;
    while (this.notice !== null && noticeTimeMs > 0) {
      const untilExpiryMs = this.notice.lifetimeMs - this.notice.ageMs;
      if (noticeTimeMs < untilExpiryMs) {
        this.notice.ageMs += noticeTimeMs;
        break;
      }
      noticeTimeMs -= untilExpiryMs;
      this.notice = this.queuedNotices.shift() ?? null;
    }
    if (this.transfer !== null) {
      this.transfer.ageMs += dt;
      if (this.transfer.ageMs >= this.transfer.delayMs + this.transfer.lifetimeMs) this.transfer = null;
    }
    this.slotAttentionRemainingMs = Math.max(0, this.slotAttentionRemainingMs - dt);
    this.replacedBonusRemainingMs = Math.max(0, this.replacedBonusRemainingMs - dt);
    if (this.replacedBonusRemainingMs === 0) this.replacedBonus = null;
  }

  public snapshot(): PresentationSnapshot {
    return Object.freeze({
      opening: this.opening === null ? null : Object.freeze({
        stage: openingStageAt(this.opening.ageMs),
        ageMs: this.opening.ageMs,
        lifetimeMs: 1200,
        previewLanes: this.opening.previewLanes,
      }),
      notice: this.freezeNotice(this.notice),
      queuedNotices: Object.freeze(this.queuedNotices.map((notice) => this.freezeNotice(notice)!)),
      transfer: this.transfer === null ? null : Object.freeze({ ...this.transfer }),
      slotAttentionRemainingMs: this.slotAttentionRemainingMs,
      replacedBonus: this.replacedBonus,
    });
  }

  public reset(): void {
    this.opening = null;
    this.notice = null;
    this.queuedNotices = [];
    this.transfer = null;
    this.slotAttentionRemainingMs = 0;
    this.replacedBonus = null;
    this.replacedBonusRemainingMs = 0;
    this.firstSeenAnomalies.clear();
    this.announcedPressureCycle = null;
  }

  private createNotice(
    title: string,
    body: string,
    tone: PresentationTone,
    priority: NoticePriority,
    lifetimeMs: number,
    assertive = false,
  ): MutableNotice {
    return { title, body, tone, priority, ageMs: 0, lifetimeMs, assertive };
  }

  private mergeNotices(candidates: readonly MutableNotice[]): void {
    const combined = [
      ...(this.notice === null ? [] : [this.notice]),
      ...this.queuedNotices,
      ...candidates,
    ];
    const ranked = combined
      .map((notice, order) => ({ notice, order }))
      .sort((left, right) => right.notice.priority - left.notice.priority
        || Number(right.notice.assertive) - Number(left.notice.assertive)
        || left.order - right.order);
    const titles = new Set<string>();
    const unique = ranked
      .filter(({ notice }) => {
        if (titles.has(notice.title)) return false;
        titles.add(notice.title);
        return true;
      })
      .slice(0, MAX_VISIBLE_NOTICES)
      .map(({ notice }) => notice);
    this.notice = unique.shift() ?? null;
    this.queuedNotices = unique;
  }

  private freezeNotice(notice: MutableNotice | null): PresentationNotice | null {
    return notice === null ? null : Object.freeze({ ...notice });
  }
}
