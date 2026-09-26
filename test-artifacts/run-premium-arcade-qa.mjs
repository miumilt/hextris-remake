// Public-control browser audit. Run with the Vite server at http://127.0.0.1:5173/.
// All decisions use rendered DOM, ordinary keyboard input, advanceTime and
// render_game_to_text; no engine internals or test-only game controls are used.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const url = process.env.HEXTRIS_QA_URL ?? 'http://127.0.0.1:5173/';
const output = resolve('test-artifacts/premium-arcade-qa');
const sizes = [{ width: 1280, height: 720 }, { width: 1920, height: 1080 }];
const names = [
  '01-menu', '02-opening-assemble', '03-opening-guides', '04-opening-ready',
  '05-first-wave', '06-first-90-seconds', '07-anomaly-warning', '08-anomaly-active',
  '09-bonus-falling', '10-bonus-collected', '11-bonus-stored', '12-bonus-replaced',
  '13-slow', '14-pulse', '15-cleanse', '16-color-break', '17-clear', '18-chain',
  '19-pressure', '20-release', '21-third-cycle-upgrade', '22-five-minute-profile',
  '23-late-cap', '24-last-stand', '25-game-over', '26-retry-reset',
  '27-reduced-motion-opening', '28-reduced-motion-bonus', '29-paused-transient',
];
const captured = new Map();
const errors = [];
const runs = [];
const fairness = { firstAnomalyAtMs: null, shortestWarningMs: null, firstDoubleAtMs: null,
  fastestFalling: 0, lateArrivalSamples: [], warningEvidence: {}, activeEvidence: {} };
const anomalyTypes = ['reverse', 'mirage', 'drift', 'colorShift', 'inertia'];
const pausedCategories = new Set();
const requiredPaused = ['opening', 'warning', 'anomaly', 'bonus-falling', 'bonus-transfer', 'slow', 'upgrade'];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function state(page) {
  return JSON.parse(await page.evaluate(() => window.render_game_to_text()));
}

async function advance(page, ms) {
  await page.evaluate((duration) => window.advanceTime(duration), ms);
  return state(page);
}

async function capture(page, name, snapshot = null) {
  if (captured.has(name)) return;
  const payload = snapshot ?? await state(page);
  const files = [];
  for (const size of sizes) {
    await page.setViewportSize(size);
    const basename = `${name}-${size.width}x${size.height}`;
    await page.screenshot({ path: resolve(output, `${basename}.png`), animations: 'disabled' });
    await writeFile(resolve(output, `${basename}.json`), `${JSON.stringify(payload, null, 2)}\n`);
    files.push(basename);
  }
  await page.setViewportSize(sizes[0]);
  captured.set(name, { mode: payload.mode, elapsedMs: payload.elapsedMs, files });
  console.log(`captured ${name} at ${payload.elapsedMs}ms`);
}

export function assertRunCleared(snapshot, label) {
  const cycle = snapshot.cycle;
  assert(snapshot.elapsedMs === 0 && snapshot.score === 0 && snapshot.combo === 1
    && snapshot.stacks.length === 0 && snapshot.falling.length === 0
    && snapshot.fallingBonuses.length === 0 && snapshot.bonus.stored === null
    && snapshot.bonus.slowRemainingMs === 0
    && Object.values(snapshot.upgrades.levels).every((level) => level === 0)
    && snapshot.upgrades.choices.length === 0 && cycle.totalActiveMs === 0
    && cycle.warning.length === 0 && cycle.warningRemainingMs === 0
    && cycle.anomalies.length === 0 && snapshot.presentation.transferBonus === null,
  `${label} reset retained run-only state`);
}

export class QaAudit {
  constructor() {
    this.fairness = { firstAnomalyAtMs: null, shortestWarningMs: null, firstDoubleAtMs: null,
      fastestFalling: 0, lateArrivalSamples: [], slowCadenceSamplesExcluded: 0,
      warningEvidence: {}, activeEvidence: {} };
    this.warningEpisode = null;
    this.seenIds = new Set();
    this.waves = [];
    this.wasSlow = false;
  }

  resetArrivalTracking() {
    this.seenIds.clear();
    this.waves = [];
    this.wasSlow = false;
    this.warningEpisode = null;
  }

  ingest(snapshot) {
  const fairness = this.fairness;
  const cycle = snapshot.cycle;
  if (cycle.anomalies.length > 0) {
    fairness.firstAnomalyAtMs ??= cycle.totalActiveMs;
    assert(cycle.totalActiveMs >= 90_000, 'Anomaly started before 90 active seconds');
    if (cycle.anomalies.length > 1) {
      fairness.firstDoubleAtMs ??= cycle.totalActiveMs;
      assert(cycle.totalActiveMs >= 360_000, 'Double anomaly started before 360 active seconds');
    }
  }
  if (cycle.warning.length > 0) {
    const key = `${cycle.number}:${cycle.warning.join('+')}`;
    assert(this.warningEpisode === null || this.warningEpisode.key === key,
      `Runtime warning ${this.warningEpisode?.types.join('+')} was interrupted by ${cycle.warning.join('+')}`);
    if (this.warningEpisode === null) this.warningEpisode = {
      key, types: [...cycle.warning], firstObservedMs: cycle.totalActiveMs,
      firstRemainingMs: cycle.warningRemainingMs,
    };
  } else if (this.warningEpisode && cycle.anomalies.length > 0) {
    const episode = this.warningEpisode;
    assert(episode.types.every((type) => cycle.anomalies.some((anomaly) => anomaly.type === type)),
      `Runtime warning ${episode.types.join('+')} activated different anomalies`);
    const measuredMs = cycle.totalActiveMs - episode.firstObservedMs;
    const requiredMs = episode.types.length > 1 ? 3_200 : 2_500;
    // The first visible snapshot can be at most one 50ms sampling step after onset.
    assert(measuredMs + 50 + 1e-6 >= requiredMs,
      `Runtime warning ${episode.types.join('+')} was shorter than ${requiredMs}ms (${measuredMs}ms observed)`);
    fairness.shortestWarningMs = Math.min(fairness.shortestWarningMs ?? Infinity, measuredMs);
    for (const type of episode.types) fairness.warningEvidence[type] = {
      firstObservedMs: episode.firstObservedMs, activatedMs: cycle.totalActiveMs,
      measuredMs, samplingBoundMs: 50, requiredMs,
    };
    this.warningEpisode = null;
  } else if (this.warningEpisode) {
    assert(false, `Runtime warning ${this.warningEpisode.types.join('+')} was interrupted before activation`);
  }
  for (const anomaly of cycle.anomalies) fairness.activeEvidence[anomaly.type] ??= cycle.totalActiveMs;
  if (snapshot.mode === 'upgrade') assert(cycle.number === 3 || cycle.number % 3 === 0,
    `Upgrade appeared at cycle ${cycle.number}`);
  for (const block of snapshot.falling) {
    fairness.fastestFalling = Math.max(fairness.fastestFalling, block.speed);
    assert(block.speed <= 600 + 1e-6, `Falling block exceeded 600: ${block.speed}`);
  }
  if (cycle.totalActiveMs >= 420_000 && snapshot.mode === 'playing') {
    const slow = snapshot.bonus.slowRemainingMs > 0;
    if (slow || this.wasSlow) {
      for (const block of snapshot.falling) this.seenIds.add(block.id);
      this.waves = [];
      fairness.slowCadenceSamplesExcluded++;
      this.wasSlow = slow;
      return;
    }
    const arrivals = snapshot.falling.filter((block) => !this.seenIds.has(block.id))
      .map((block) => ({ id: block.id, lane: block.lane, phase: cycle.phase,
        // Distance is public; invert motion to recover the birth instant below tick resolution.
        bornMs: cycle.totalActiveMs - (520 - block.distance) * 1000 / block.speed }))
      .sort((a, b) => a.bornMs - b.bornMs || a.id - b.id);
    for (const arrival of arrivals) {
      this.seenIds.add(arrival.id);
      const spiral = (arrival.phase === 'build' || arrival.phase === 'pressure')
        ? this.waves.find((wave) => wave.count < 6 && wave.last
          && arrival.lane === (wave.last.lane + 1) % 6
          && Math.abs(arrival.bornMs - wave.last.bornMs - 160) <= 2)
        : null;
      if (spiral) {
        spiral.last = arrival;
        spiral.count++;
        continue;
      }
      const latest = this.waves.at(-1);
      if (latest && Math.abs(arrival.bornMs - latest.startMs) <= 2) continue;
      if (latest) {
        const gap = arrival.bornMs - latest.startMs;
        assert(gap >= 500 - 1e-5, `Late ordinary cadence ${gap.toFixed(1)}ms below 500ms: `
          + `next=${JSON.stringify(arrival)} waves=${JSON.stringify(this.waves)}`);
        fairness.lateArrivalSamples.push(gap);
      }
      this.waves.push({ startMs: arrival.bornMs, last: arrival, count: 1 });
      this.waves = this.waves.filter((wave) => arrival.bornMs - wave.last.bornMs <= 960);
    }
  }
  }
}

const auditState = new QaAudit();

function audit(snapshot) {
  auditState.ingest(snapshot);
  Object.assign(fairness, auditState.fairness);
}

function normalCoverageComplete() {
  return names.filter((name) => !name.startsWith('27-') && !name.startsWith('28-'))
    .every((name) => captured.has(name))
    && anomalyTypes.every((type) => captured.has(`warning-${type}`) && captured.has(`active-${type}`))
    && requiredPaused.every((category) => pausedCategories.has(category))
    && fairness.lateArrivalSamples.length > 0;
}

async function observe(page, snapshot) {
  audit(snapshot);
  const stage = snapshot.presentation.openingStage;
  if (stage === 'assemble') await capture(page, '02-opening-assemble', snapshot);
  if (stage === 'guides') await capture(page, '03-opening-guides', snapshot);
  if (stage === 'ready') await capture(page, '04-opening-ready', snapshot);
  if (snapshot.mode === 'playing' && snapshot.elapsedMs >= 1_200 && snapshot.falling.length > 0)
    await capture(page, '05-first-wave', snapshot);
  if (snapshot.mode === 'playing' && snapshot.elapsedMs >= 89_000 && snapshot.elapsedMs < 90_000)
    await capture(page, '06-first-90-seconds', snapshot);
  if (snapshot.cycle.warning.length) await capture(page, '07-anomaly-warning', snapshot);
  if (snapshot.cycle.anomalies.length) await capture(page, '08-anomaly-active', snapshot);
  for (const type of anomalyTypes) {
    if (snapshot.cycle.warning.includes(type)) await capture(page, `warning-${type}`, snapshot);
    if (snapshot.cycle.anomalies.some((anomaly) => anomaly.type === type))
      await capture(page, `active-${type}`, snapshot);
  }
  if (snapshot.fallingBonuses.length) await capture(page, '09-bonus-falling', snapshot);
  if (snapshot.presentation.transferBonus) await capture(page, '10-bonus-collected', snapshot);
  if (snapshot.bonus.stored && !snapshot.presentation.transferBonus
    && !snapshot.presentation.noticeTitle?.startsWith('БОНУС:'))
    await capture(page, '11-bonus-stored', snapshot);
  if (snapshot.presentation.noticeTitle?.includes('ЗАМЕНИЛ')) await capture(page, '12-bonus-replaced', snapshot);
  if (snapshot.bonus.slowRemainingMs > 0) await capture(page, '13-slow', snapshot);
  if (snapshot.presentation.noticeTitle === 'ИМПУЛЬС АКТИВИРОВАН') await capture(page, '14-pulse', snapshot);
  if (snapshot.presentation.noticeTitle === 'ОЧИСТКА АКТИВИРОВАН') await capture(page, '15-cleanse', snapshot);
  if (snapshot.presentation.noticeTitle === 'ЦВЕТОВОЙ ВЗРЫВ АКТИВИРОВАН')
    await capture(page, '16-color-break', snapshot);
  if (snapshot.score > 0) await capture(page, '17-clear', snapshot);
  if (snapshot.combo > 1) await capture(page, '18-chain', snapshot);
  if (snapshot.cycle.phase === 'pressure' && snapshot.mode === 'playing') await capture(page, '19-pressure', snapshot);
  if (snapshot.cycle.phase === 'release' && snapshot.mode === 'playing') await capture(page, '20-release', snapshot);
  if (snapshot.mode === 'upgrade' && snapshot.cycle.number === 3)
    await capture(page, '21-third-cycle-upgrade', snapshot);
  if (snapshot.cycle.totalActiveMs >= 320_000 && snapshot.cycle.totalActiveMs < 420_000
    && snapshot.cycle.phase === 'build' && snapshot.mode === 'playing')
    await capture(page, '22-five-minute-profile', snapshot);
  if (snapshot.cycle.totalActiveMs >= 420_000 && snapshot.mode === 'playing')
    await capture(page, '23-late-cap', snapshot);
  if (snapshot.presentation.noticeTitle?.includes('ПОСЛЕДН')) await capture(page, '24-last-stand', snapshot);
  if (snapshot.mode === 'gameOver') await capture(page, '25-game-over', snapshot);
}

async function pauseTransient(page, snapshot) {
  const categories = [];
  if (snapshot.mode === 'playing') {
    if (snapshot.opening.remainingMs > 0) categories.push('opening');
    if (snapshot.cycle.warning.length) categories.push('warning');
    if (snapshot.cycle.anomalies.length) categories.push('anomaly');
    if (snapshot.fallingBonuses.length) categories.push('bonus-falling');
    if (snapshot.presentation.transferBonus) categories.push('bonus-transfer');
    if (snapshot.bonus.slowRemainingMs > 0) categories.push('slow');
    if (snapshot.effects.hitStopRemainingMs > 0) categories.push('hit-stop');
  } else if (snapshot.mode === 'upgrade') categories.push('upgrade');
  for (const category of categories) {
    if (pausedCategories.has(category)) continue;
    if (category === 'upgrade') {
      const frozen = await advance(page, 5_000);
      assert(JSON.stringify(frozen) === JSON.stringify(snapshot), 'Upgrade state advanced while selected');
      await capture(page, 'paused-upgrade', frozen);
    } else {
      await page.keyboard.press('Escape');
      const paused = await advance(page, 1000 / 60);
      assert(paused.mode === 'paused', `Escape did not pause ${category}`);
      const frozen = await advance(page, 5_000);
      assert(JSON.stringify(frozen) === JSON.stringify(paused), `Paused ${category} state advanced`);
      await capture(page, `paused-${category}`, frozen);
      if (category === 'opening') await capture(page, '29-paused-transient', frozen);
      await page.keyboard.press('Escape');
      const resumed = await advance(page, 1000 / 60);
      assert(resumed.mode === 'playing', `${category} did not resume`);
    }
    pausedCategories.add(category);
    break; // Refresh the public snapshot before attempting a second category.
  }
}

async function publicBot(page, snapshot, tick, holdForReplacement = false) {
  if (snapshot.mode === 'upgrade') {
    const lastStand = snapshot.upgrades.choices.findIndex((choice) => choice.id === 'lastStand');
    if (lastStand > 0) await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Enter');
    return;
  }
  if (snapshot.mode !== 'playing') return;
  if (!holdForReplacement && snapshot.bonus.stored && captured.has('11-bonus-stored')
    && (snapshot.stacks.some((stack) => stack.blocks.length >= 3) || tick % 32 === 0))
    await page.keyboard.press('Space');
  const imminent = [...snapshot.falling].sort((a, b) => a.distance - b.distance)[0];
  if (!imminent) return;
  const stacks = Array.from({ length: 6 }, (_, side) =>
    [...(snapshot.stacks.find((stack) => stack.side === side)?.blocks ?? [])]);
  const color = imminent.shiftToColor ?? imminent.color;
  const score = (orientation) => {
    const target = ((imminent.driftToLane ?? imminent.lane) + orientation) % 6;
    const projected = stacks.map((stack) => [...stack]);
    projected[target].push({ color });
    let connected = 0;
    const seen = new Set();
    const queue = [[target, projected[target].length - 1]];
    while (queue.length) {
      const [side, index] = queue.shift();
      const key = `${side}:${index}`;
      if (seen.has(key) || projected[side]?.[index]?.color !== color) continue;
      seen.add(key);
      connected++;
      queue.push([side, index - 1], [side, index + 1], [(side + 5) % 6, index], [(side + 1) % 6, index]);
    }
    const maxDepth = Math.max(...projected.map((stack) => stack.length));
    const movement = Math.min((orientation - snapshot.orientation + 6) % 6,
      (snapshot.orientation - orientation + 6) % 6);
    return (connected >= 3 ? 200 : connected * 12) - maxDepth * 25
      - projected[target].length * 8 - movement * 2;
  };
  const candidates = Array.from({ length: 6 }, (_, orientation) => ({ orientation, value: score(orientation) }));
  candidates.sort((a, b) => b.value - a.value);
  const best = candidates[0].orientation;
  const right = (best - snapshot.orientation + 6) % 6;
  const left = (snapshot.orientation - best + 6) % 6;
  if (right === 0) return;
  await page.keyboard.press(right <= left ? 'ArrowLeft' : 'ArrowRight');
}

async function run() {
  await mkdir(output, { recursive: true });
  if (process.env.HEXTRIS_QA_RESUME === '1') {
    const prior = JSON.parse(await readFile(resolve(output, 'run-report.json'), 'utf8'));
    for (const [name, evidence] of Object.entries(prior.captured)) captured.set(name, evidence);
    runs.push(...(prior.runs ?? []));
    Object.assign(fairness, prior.fairness);
  }
  const browser = await chromium.launch({ channel: 'msedge', headless: true,
    args: ['--use-gl=angle', '--use-angle=swiftshader'] });
  try {
    const context = await browser.newContext({ viewport: sizes[0], reducedMotion: 'no-preference' });
    const page = await context.newPage();
    // Freeze browser RAF scheduling; the public fixed-step hook owns all QA time.
    await page.addInitScript(() => { window.requestAnimationFrame = () => 0; });
    page.on('console', (message) => {
      if (message.type() === 'error' || message.type() === 'warning')
        errors.push({ type: `console.${message.type()}`, text: message.text() });
    });
    page.on('pageerror', (error) => errors.push({ type: 'pageerror', text: String(error) }));
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.advanceTime === 'function');
    await capture(page, '01-menu');
    for (let runIndex = 0; runIndex < 8; runIndex++) {
      await page.locator('[data-action="play"]').click();
      let current = await state(page);
      await observe(page, current);
      await pauseTransient(page, current);
      for (const duration of [300, 450, 400, 100]) {
        current = await advance(page, duration);
        await observe(page, current);
        await pauseTransient(page, current);
      }
      for (let tick = 0; tick < 8_000; tick++) {
        const msToWarning = 42_000 - current.cycle.elapsedMs;
        const fineWarning = current.cycle.warning.length > 0
          || (current.cycle.number > 1 && msToWarning > -3_300 && msToWarning <= 500);
        const stepMs = current.cycle.totalActiveMs >= 420_000 || fineWarning ? 50 : 250;
        current = await advance(page, stepMs);
        await observe(page, current);
        await pauseTransient(page, current);
        current = await state(page);
        if (current.mode === 'gameOver') break;
        if (normalCoverageComplete()) break;
        await publicBot(page, current, tick + runIndex,
          runIndex === 0 && !captured.has('12-bonus-replaced'));
      }
      runs.push({ attempt: runIndex + 1, elapsedMs: current.elapsedMs,
        activeMs: current.cycle.totalActiveMs, mode: current.mode, score: current.score });
      if (current.mode === 'gameOver') {
        await page.locator('[data-action="retry"]').click();
        const reset = await state(page);
        assert(reset.mode === 'playing', 'Retry did not return to play');
        assertRunCleared(reset, 'Retry');
        await capture(page, '26-retry-reset', reset);
        await page.keyboard.press('Escape');
        await advance(page, 1000 / 60);
        await page.locator('[data-action="menu"]').click();
        const menu = await state(page);
        assert(menu.mode === 'menu', 'Menu control did not return to menu');
        assertRunCleared(menu, 'Menu');
      } else {
        break;
      }
      auditState.resetArrivalTracking();
      if (normalCoverageComplete()) break;
    }
    await context.close();

    const reduced = await browser.newContext({ viewport: sizes[0], reducedMotion: 'reduce' });
    const reducedPage = await reduced.newPage();
    await reducedPage.addInitScript(() => { window.requestAnimationFrame = () => 0; });
    reducedPage.on('console', (message) => {
      if (message.type() === 'error' || message.type() === 'warning')
        errors.push({ type: `console.${message.type()}`, text: message.text() });
    });
    reducedPage.on('pageerror', (error) => errors.push({ type: 'pageerror', text: String(error) }));
    await reducedPage.goto(url, { waitUntil: 'domcontentloaded' });
    await reducedPage.locator('[data-action="play"]').click();
    await advance(reducedPage, 140);
    await capture(reducedPage, '27-reduced-motion-opening');
    for (let tick = 0; tick < 1_000 && !captured.has('28-reduced-motion-bonus'); tick++) {
      const current = await advance(reducedPage, 250);
      if (current.presentation.transferBonus || current.bonus.stored)
        await capture(reducedPage, '28-reduced-motion-bonus', current);
      if (current.mode === 'gameOver') break;
      await publicBot(reducedPage, current, tick);
    }
    await reduced.close();
  } finally {
    await browser.close();
    await writeFile(resolve(output, 'console-errors.json'), `${JSON.stringify(errors, null, 2)}\n`);
    const missing = names.filter((name) => !captured.has(name));
    await writeFile(resolve(output, 'run-report.json'), `${JSON.stringify({
      url, requested: names.length, captured: Object.fromEntries(captured), missing, fairness, runs,
      missingAnomalies: anomalyTypes.filter((type) => !captured.has(`warning-${type}`) || !captured.has(`active-${type}`)),
      pausedCategories: [...pausedCategories],
      consoleEntries: errors.length,
    }, null, 2)}\n`);
    console.log(`${names.filter((name) => captured.has(name)).length}/${names.length} named scenarios captured; `
      + `${captured.size - names.length} supplemental captures; ${errors.length} console entries`);
    if (missing.length) console.log(`Unreached through public controls: ${missing.join(', ')}`);
  }
  assert(errors.length === 0, 'Browser console errors or warnings were captured');
  assert(names.every((name) => captured.has(name)), 'Some required QA states were not reached through public controls');
  assert(fairness.firstAnomalyAtMs >= 90_000, 'First anomaly breached the 90-second floor');
  assert(fairness.shortestWarningMs + 50 >= 2_500, 'Observed warning breached the 2500ms floor');
  assert(anomalyTypes.every((type) => fairness.warningEvidence[type] && fairness.activeEvidence[type]
    && captured.has(`warning-${type}`) && captured.has(`active-${type}`)),
  'Missing named public warning/active evidence for an anomaly type');
  assert(requiredPaused.every((category) => pausedCategories.has(category)),
  'Missing pause/freeze/resume evidence for a transient category');
  assert(fairness.firstDoubleAtMs >= 360_000, 'First double threat breached the six-minute floor');
  assert(fairness.fastestFalling <= 600, 'Observed falling speed breached the 600 cap');
  assert(fairness.lateArrivalSamples.length > 0
    && fairness.lateArrivalSamples.every((ms) => ms >= 500),
  'Observed late Settle arrivals breached the 500ms cadence floor');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  run().catch((error) => { console.error(error); process.exitCode = 1; });
