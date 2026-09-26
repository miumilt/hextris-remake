// @ts-nocheck -- the audited artifact is a standalone JavaScript CLI.
import { describe, expect, it } from 'vitest';
import { QaAudit, assertRunCleared } from '../test-artifacts/run-premium-arcade-qa.mjs';

const base = (ms, changes = {}) => ({
  mode: 'playing', elapsedMs: ms, score: 0, combo: 1, stacks: [], falling: [], fallingBonuses: [],
  bonus: { stored: null, slowRemainingMs: 0 },
  upgrades: { levels: { stabilizer: 0, comboRelay: 0, salvage: 0, deepPulse: 0, anomalyShield: 0, lastStand: 0 }, choices: [] },
  presentation: { transferBonus: null },
  cycle: { totalActiveMs: ms, phase: 'build', number: 6, warning: [], warningRemainingMs: 0,
    anomalies: [], threat: null }, ...changes,
});
const withCycle = (ms, cycle) => base(ms, { cycle: { ...base(ms).cycle, ...cycle } });
const block = (id, bornMs, observedMs, lane = 0) => ({
  id, lane, speed: 500, distance: 520 - (observedMs - bornMs) * 0.5,
});

describe('public browser audit', () => {
  it('rejects a runtime warning that ends 100ms before the required floor', () => {
    const audit = new QaAudit();
    audit.ingest(withCycle(120050, { warning: ['reverse'], warningRemainingMs: 2450 }));
    expect(() => audit.ingest(withCycle(122400, { anomalies: [{ type: 'reverse', remainingMs: 8000 }] })))
      .toThrow(/warning.*reverse.*2500/i);
  });

  it('accepts a full warning with a 50ms onset sampling bound and records each type', () => {
    const audit = new QaAudit();
    audit.ingest(withCycle(120050, { warning: ['reverse'], warningRemainingMs: 2450 }));
    audit.ingest(withCycle(122500, { anomalies: [{ type: 'reverse', remainingMs: 8000 }] }));
    expect(audit.fairness.warningEvidence.reverse.measuredMs).toBe(2450);
    expect(audit.fairness.activeEvidence.reverse).toBe(122500);
  });

  it('rejects a warning that disappears before activation even if the elapsed gap reaches 2500ms', () => {
    const audit = new QaAudit();
    audit.ingest(withCycle(120000, { warning: ['reverse'], warningRemainingMs: 2500 }));
    expect(() => audit.ingest(withCycle(121000, { warning: [], anomalies: [] })))
      .toThrow(/warning.*reverse.*interrupted/i);
  });

  it.each(['paused', 'upgrade'])('does not discard an interrupted warning in %s mode', (mode) => {
    const audit = new QaAudit();
    audit.ingest(withCycle(120000, { warning: ['reverse'], warningRemainingMs: 2500 }));
    expect(() => audit.ingest({ ...withCycle(120000, { warning: [], anomalies: [] }), mode }))
      .toThrow(/warning.*reverse.*interrupted/i);
  });

  it('keeps a paused warning episode until the matching anomaly activates', () => {
    const audit = new QaAudit();
    const warning = withCycle(120000, { warning: ['reverse'], warningRemainingMs: 2500 });
    audit.ingest(warning);
    audit.ingest({ ...warning, mode: 'paused' });
    audit.ingest(warning);
    audit.ingest(withCycle(122500, { anomalies: [{ type: 'reverse', remainingMs: 8000 }] }));
    expect(audit.fairness.warningEvidence.reverse.measuredMs).toBe(2500);
  });

  it('rejects a replacement warning or activation by a different anomaly', () => {
    const warning = withCycle(120000, { warning: ['reverse'], warningRemainingMs: 2500 });
    const replacement = new QaAudit();
    replacement.ingest(warning);
    expect(() => replacement.ingest(withCycle(120050, { warning: ['mirage'], warningRemainingMs: 2500 })))
      .toThrow(/warning.*reverse.*interrupted.*mirage/i);
    const activation = new QaAudit();
    activation.ingest(warning);
    expect(() => activation.ingest(withCycle(122500, {
      anomalies: [{ type: 'mirage', remainingMs: 8000 }],
    }))).toThrow(/warning.*reverse.*different anomalies/i);
  });

  it('fails a 480ms ordinary Build arrival gap using public distance and speed', () => {
    const audit = new QaAudit();
    audit.ingest(base(420100, { falling: [block(1, 420000, 420100, 0)] }));
    expect(() => audit.ingest(base(420600, { falling: [block(1, 420000, 420600, 0), block(2, 420480, 420600, 3)] })))
      .toThrow(/cadence.*480/i);
  });

  it('exempts successive 160ms spiral sub-arrivals while measuring next wave start', () => {
    const audit = new QaAudit();
    audit.ingest(base(420100, { falling: [block(1, 420000, 420100, 0)] }));
    audit.ingest(base(420300, { falling: [block(1, 420000, 420300, 0), block(2, 420160, 420300, 1)] }));
    audit.ingest(base(421000, { falling: [block(3, 420800, 421000, 4)] }));
    expect(audit.fairness.lateArrivalSamples).toEqual([800]);
  });

  it('does not compare active-time births across a slow-motion interval', () => {
    const audit = new QaAudit();
    audit.ingest(base(420100, { falling: [block(1, 420000, 420100, 0)] }));
    expect(() => audit.ingest(base(420300, {
      bonus: { stored: null, slowRemainingMs: 1000 },
      falling: [block(1, 420000, 420300, 0), block(2, 420200, 420300, 3)],
    }))).not.toThrow();
  });

  it('keeps tracking a spiral after another ordinary wave starts', () => {
    const audit = new QaAudit();
    const arrivals = [
      [1, 420000, 0], [2, 420160, 1], [3, 420320, 2], [4, 420480, 3],
      [5, 420500, 1], [6, 420640, 4], [7, 420800, 5],
    ];
    for (const [id, born, lane] of arrivals) {
      const observed = born + 50;
      expect(() => audit.ingest(base(observed, { falling: [block(id, born, observed, lane)] }))).not.toThrow();
    }
    expect(audit.fairness.lateArrivalSamples).toEqual([500]);
  });

  it('rejects retry or menu state retaining any run-only field', () => {
    const clean = base(0, { mode: 'menu' });
    expect(() => assertRunCleared(clean, 'Menu')).not.toThrow();
    for (const stale of [
      { falling: [block(1, 0, 0)] }, { fallingBonuses: [{ id: 2 }] },
      { upgrades: { ...clean.upgrades, levels: { ...clean.upgrades.levels, lastStand: 1 } } },
      { cycle: { ...clean.cycle, warning: ['drift'] } },
      { cycle: { ...clean.cycle, anomalies: [{ type: 'drift', remainingMs: 100 }] } },
      { presentation: { transferBonus: 'pulse' } }, { bonus: { stored: 'pulse', slowRemainingMs: 0 } },
      { score: 1 }, { elapsedMs: 1 },
    ]) expect(() => assertRunCleared({ ...clean, ...stale }, 'Menu')).toThrow(/Menu reset/);
  });

  it('starts warning measurement anew after a run reset', () => {
    const audit = new QaAudit();
    audit.ingest(withCycle(119000, { warning: ['reverse'], warningRemainingMs: 2500 }));
    audit.resetArrivalTracking();
    audit.ingest(withCycle(120050, { warning: ['reverse'], warningRemainingMs: 2450 }));
    audit.ingest(withCycle(122500, { anomalies: [{ type: 'reverse', remainingMs: 8000 }] }));
    expect(audit.fairness.warningEvidence.reverse.measuredMs).toBe(2450);
  });
});
