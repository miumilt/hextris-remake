# Task 7 — Stronger bounded progression effects

## Implemented

- Replaced the positional `EffectsSystem` random constructor with immutable `EffectsOptions` (`random`, `reducedMotion`) and migrated every production/test call site.
- Added immutable snapshot channels: `shockwaves`, `labels`, `screenFlash`, and `hitStopRemainingMs`; snapshots defensively freeze their arrays, elements, and flash copy.
- Added bounded progression mappings: normal clears, chains, bonus removals, anomaly starts, cycle completion, and last stand. `impact()` only increases active shake/hold values, so a landing cannot weaken a chain impact.
- Preserved visual-only timing: `main.ts` progresses effects only in `playing`; pause and upgrade freeze them, reset clears all channels, and hit stop does not affect the engine/runtime clock.
- Added reduced-motion suppression for particle, landing-flash, shockwave, shake, hit-stop, screen-flash, and combo movement while retaining readable progression labels.

## Files

- `src/render/EffectsSystem.ts`
- `src/main.ts`
- `tests/ProgressionEffects.test.ts` (new)
- `tests/EffectsSystem.test.ts`
- `tests/CanvasRenderer.test.ts` (necessary constructor-call migration)
- `progress.md`

## RED → GREEN evidence

Focused command used throughout:

```powershell
npm run test:run -- tests/ProgressionEffects.test.ts tests/EffectsSystem.test.ts
```

The first sandboxed invocation could not load Vite/esbuild because its parent-directory read was denied; the required elevated re-run reached the tests. RED failures observed before each minimal mapping included:

- `TypeError: this.random is not a function` for the new explicit options contract, followed by the normal-clear snapshot expectation.
- Chain expected 12 fragments but received 6.
- Bonus expected shake/hit-stop/wave/label/flash but received zero/null/empty channels.
- Anomaly start expected transient label/flash but received empty/null.
- Cycle completion expected maximum shake/flash but received zero/null.
- Mutation check: temporary `MAX_SHOCKWAVES = 13` failed `expected ... length of 12 but got 13`; restored cap 12.
- Reduced motion first retained 12 particles; after that was fixed, its combo impulse still had multiplier 4/360 ms.

Each failure was followed by the smallest production change and a GREEN focused run. Final focused result: **2 files, 16 tests passed**.

## Caps, expiry, and reduced-motion review

- Particle cap remains **180**. Shockwaves retain the newest **12**; labels retain the newest **6**.
- Particle/landing flash, shockwave, label, shake, hit-stop, screen flash, and combo all advance by the existing maximum 50 ms visual tick and expire. `reset()` empties every visual channel.
- Normal clear is shake 4 / 60 ms hit stop; chains increase to the capped shake 8 and increase fragments; bonus hit stop is 80 ms (within 70–100 ms). Cycle completion and last stand use capped shake 8 plus intensity-1 flash.
- Reduced motion produces no large movement or holds (particles, landing flashes, shockwaves, shake, hit stop, screen flash, combo), but keeps labels for CHAIN, bonus, anomaly, cycle, and last-stand announcements.
- No renderer layers were added: Task 8 can consume the snapshot channels later. `hitStopRemainingMs` is intentionally not fed into game simulation time.

## Final verification

```powershell
npm run test:run
# 19 test files passed, 154 tests passed
npm run typecheck
# exit 0
npm run build
# exit 0; 19 Vite modules; corresponding source packaged
git diff --check
# exit 0 (only established CRLF conversion warnings)
```

## Concerns

No blocking concerns. The existing sandbox requires elevated execution for Vitest/Vite because esbuild reads an ancestor directory; this is environmental and the elevated runs passed. Screen flash/shockwave/label rendering remains deliberately deferred to Task 8 per scope.
