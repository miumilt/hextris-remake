# Task 1 — 75-second ThreatDirector report

## Implementation

- Renamed `CycleDirector` to `ThreatDirector` and replaced the 55-second flow/pressure/surge clock with the fixed 75-second Settle/Build/Pressure/Release timeline (20/35/15/5 seconds).
- `update` automatically begins cycles one and two while consuming the same delta. It stops at the completed third cycle, sets `upgradeDue`, and reports only consumed active time. `beginNextCycle` resumes cycle four exactly once.
- Added `totalActiveMs` and provisional `threat: null` to immutable cycle snapshots, exact timing/balance constants, the specified exponential speed and cadence functions, phase cadence multipliers, and 600/500 soft floors/caps.
- Renamed engine ownership/options to `ThreatDirector`/`director`; retained `cycle` as the documented deprecated compatibility alias for this migration task.
- Updated phase consumers and deterministic fixtures to use the four new vocabulary values and snapshot fields.

## Files changed

- `src/game/ThreatDirector.ts` (renamed from `CycleDirector.ts`)
- `src/game/constants.ts`
- `src/game/progressionTypes.ts`
- `src/game/GameEngine.ts`
- `src/render/CanvasRenderer.ts`
- `src/ui/ScreenController.ts`
- `tests/ThreatDirector.test.ts` (renamed from `CycleDirector.test.ts`)
- `tests/GameProgression.test.ts`
- `tests/EndlessRun.test.ts`
- `tests/Anomalies.test.ts`
- `tests/GameEngine.test.ts`
- `tests/ProgressionInput.test.ts`
- `tests/ProgressionRenderer.test.ts`
- `tests/ScreenController.test.ts`
- `progress.md`

## TDD evidence

### RED

Command:

```powershell
npm.cmd run test:run -- tests/ThreatDirector.test.ts tests/GameProgression.test.ts
```

The sandboxed command could not load Vitest configuration because esbuild was denied parent-directory access. Re-running the identical command with the required elevated test permission produced the expected behavioral RED:

```text
FAIL tests/ThreatDirector.test.ts
Error: Failed to resolve import "../src/game/ThreatDirector"
Test Files 1 failed | 1 passed (2)
Tests 20 passed (20)
```

This was the expected old-vocabulary failure: the new director module did not exist before implementation.

### GREEN

Command:

```powershell
npm.cmd run test:run -- tests/ThreatDirector.test.ts tests/GameProgression.test.ts tests/EndlessRun.test.ts
```

Output:

```text
Test Files 3 passed (3)
Tests 12 passed (12)
```

The focused suite initially exposed a real boundary bug: `bonusDue ||= processBoundaries(...)` short-circuited later phase processing after a bonus. Replacing it with an unconditional call plus an accumulated flag restored correct phase/cycle advancement; that correction was re-run green above.

## Verification

```powershell
npm.cmd run typecheck
```

```text
tsc --noEmit
exit 0
```

```powershell
npm.cmd run test:run
```

```text
Test Files 24 passed (24)
Tests 165 passed (165)
```

`git diff --check` also exited 0; Git reported only established LF-to-CRLF normalization warnings.

## Self-review

- Checked all required phase boundaries against direct event tests.
- Checked a 999-second delta consumes only 225,000 ms through the cycle-three stop.
- Checked non-upgrade automatic continuation and cycle-four resume through `GameEngine` integration tests.
- Checked the compatibility alias drives the same director options.
- Checked snapshots/profiles are immutable and include active-time accounting.
- Checked TypeScript phase consumers were updated so the exact `GamePhase` union remains exhaustive.

## Concerns

- The brief's interval checkpoint literals at 120,000 and 300,000 ms are rounded differently from the specified exact formula: it yields 1578.176 and 896.639 ms, respectively, rather than 1578.5 and 896.5. Per the parent ruling, production retains the exact formula and the two control assertions use a whole-millisecond `toBeCloseTo` tolerance. This is documented in `progress.md`.
- Threat planning is deliberately represented as `null` in this task. Costed plans, fairness/cooldowns, event evidence, and anomaly timing are Task 2 responsibilities.
