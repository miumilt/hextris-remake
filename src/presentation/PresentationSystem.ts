import type { BonusType, FallingBonus } from '../game/progressionTypes';
import type { GameEvent } from '../game/types';
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
  readonly lifetimeMs: 650;
}

export interface PresentationSnapshot {
  readonly notice: PresentationNotice | null;
  readonly queuedNotices: readonly PresentationNotice[];
  readonly transfer: BonusTransfer | null;
  readonly slotAttentionRemainingMs: number;
  readonly replacedBonus: BonusType | null;
}

interface MutableNotice extends Omit<PresentationNotice, 'ageMs'> { ageMs: number; }
interface MutableTransfer extends Omit<BonusTransfer, 'ageMs'> { ageMs: number; }

const MAX_VISIBLE_NOTICES = 3;
const COLLECTION_LIFETIME_MS = 1400;
const REPLACEMENT_LIFETIME_MS = 950;
const ACTIVATION_LIFETIME_MS = 620;
const SLOT_ATTENTION_MS = 2500;

export class PresentationSystem {
  private notice: MutableNotice | null = null;
  private queuedNotices: MutableNotice[] = [];
  private transfer: MutableTransfer | null = null;
  private slotAttentionRemainingMs = 0;
  private replacedBonus: BonusType | null = null;

  public consume(events: readonly PresentationEvent[]): void {
    const candidates: MutableNotice[] = [];
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
      }
    }
    this.mergeNotices(candidates);
  }

  public update(deltaMs: number): void {
    const dt = Number.isFinite(deltaMs) && deltaMs > 0 ? deltaMs : 0;
    if (dt === 0) return;
    if (this.notice !== null) {
      this.notice.ageMs += dt;
      if (this.notice.ageMs >= this.notice.lifetimeMs) {
        this.notice = this.queuedNotices.shift() ?? null;
      }
    }
    if (this.transfer !== null) {
      this.transfer.ageMs += dt;
      if (this.transfer.ageMs >= this.transfer.lifetimeMs) this.transfer = null;
    }
    this.slotAttentionRemainingMs = Math.max(0, this.slotAttentionRemainingMs - dt);
    if (!this.hasReplacementNotice()) this.replacedBonus = null;
  }

  public snapshot(): PresentationSnapshot {
    return Object.freeze({
      notice: this.freezeNotice(this.notice),
      queuedNotices: Object.freeze(this.queuedNotices.map((notice) => this.freezeNotice(notice)!)),
      transfer: this.transfer === null ? null : Object.freeze({ ...this.transfer }),
      slotAttentionRemainingMs: this.slotAttentionRemainingMs,
      replacedBonus: this.replacedBonus,
    });
  }

  public reset(): void {
    this.notice = null;
    this.queuedNotices = [];
    this.transfer = null;
    this.slotAttentionRemainingMs = 0;
    this.replacedBonus = null;
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

  private hasReplacementNotice(): boolean {
    return [this.notice, ...this.queuedNotices].some((notice) => notice?.title.includes(' ЗАМЕНИЛ '));
  }

  private freezeNotice(notice: MutableNotice | null): PresentationNotice | null {
    return notice === null ? null : Object.freeze({ ...notice });
  }
}
