# SDD ledger — plan: docs/superpowers/plans/2026-09-21-hextris-premium-arcade-redesign.md

Baseline: e12a9f7 on branch codex/hextris-remake; 194/194 tests pass when Vitest runs outside the filesystem sandbox.

Preflight workspace ruling: continue in the existing non-main feature branch and user-visible project directory rather than creating a second linked worktree. This branch already contains the approved spec and plan, and the user expects edits in this folder. Cost if wrong: less checkout isolation from unrelated user edits, mitigated by a clean status check before each task and task-scoped commits.

## Preflight interface scan

| Tasks | Producer → consumer | Finding / ruling |
| --- | --- | --- |
| 1 → 2 | `ThreatDirector`, four phases, `CycleSnapshot.totalActiveMs` → threat budgets | Clean; Task 2 extends the director created by Task 1. |
| 1 → 3 | soft-capped `WaveProfile`, third-cycle boundary → spawn/bonus/upgrade integration | Clean; Task 3 applies final modifier clamps without changing Task 1 base curves. |
| 1 → 4 | phase events → presentation announcements | Clean; events carry `atActiveMs` after Task 2. |
| 2 → 3 | `ThreatPlan`, real lanes, one-shot authored wave metadata → `WaveSpawner` | Clean after plan self-review added `forcedAnchorLane`, `authoredWaveId`, and `entryDelayMs`. |
| 2 → 5 | warning/start events and lanes → anomaly effect cues | Clean; both event variants are immutable and lane-aware. |
| 2 → 7 | threat lanes → attached DOM warnings | Clean; `CycleSnapshot.threat.lanes` is the source of side placement. |
| 3 → 4 | opening preview lanes → `PresentationSystem.beginRun` | Clean; engine owns deterministic preview, presentation owns choreography age/stage. |
| 3 → 8 | `GameSnapshot.opening` and reset semantics → main/runtime wiring | Clean; Task 8 composes rather than redefining the engine clock. |
| 4 → 6 | opening/transfer snapshots → Canvas layers | Clean; renderer reads immutable state and never advances timers. |
| 4 → 7 | notices, slot attention, replacement glyph → semantic HUD | Clean; DOM and Canvas consume the same snapshot. |
| 5 → 6 | bounded world effects → explicit Canvas layers | Clean; layer order prevents effect occlusion. |
| 5 → 8 | mode-aware effect clocks/reset → runtime | Clean; Task 8 freezes non-playing modes and resets before flush. |
| 6 → 8 | unchanged four-input render API → main composition | Clean; optional observers are constructor-only test hooks. |
| 7 → 8 | stable HUD render contract → main composition | Clean; no new runtime ownership. |
| 8 → 9 | public QA JSON/time hooks → Playwright QA | Clean; Task 9 uses public controls only. |
| 1 | phase tests vs implementation formulas | Clean; values correspond to `150 + 450(1-e^-t/300)` and `500 + 2100e^-t/180`, with a hard 600/500 ceiling/floor. |
| 2 | fairness tests vs candidate selection | Clean; cycle 1 has no anomaly, first possible start is 119.5 s, satisfying the 90 s floor. |
| 3 | strict bonus window vs incompatible moments | Clean after plan self-review introduced absolute legal-slot search inside 35–50 s. |
| 4 | transfer delay plus flight lifetime | Ruling: transfer expires at `delayMs + lifetimeMs` (90 + 800 ms), while the 800 ms figure means visible travel duration. Cost if wrong: collection could feel 90 ms slower than intended; this matches the spec's staged hold-then-flight sequence. |
| 5 | hit-stop wording vs deterministic gameplay | Clean; hit-stop is visual only and never prevents engine time or changes results. |
| 6 | renderer observers vs production API | Ruling: optional no-op observers are allowed solely to pin layer/stage order without mocking private methods. Cost if wrong: two small test-oriented constructor fields remain in production type surface. |
| 7 | two-line Russian copy vs sparse HUD | Clean; slot is capped to 300 px and uses clipped matte geometry, not a card dashboard. |
| 8 | presentation freeze vs engine opening clock | Clean; both advance only on consumed `playing` fixed steps. |
| 9 | source distribution vs QA artifacts | Clean after self-review: source/spec/plan/tests ship; `test-artifacts` remains excluded. |

Task 1: pending
Task 2: pending
Task 3: complete
Task 4: complete
Task 5: pending
Task 6: pending
Task 7: pending
Task 8: pending
Task 9: pending

Task 1 ruling: the exponential formulas in the brief are exact and the tabulated values are rounded to one decimal; phase multipliers apply after the base curve and the 500 ms floor applies last. Cost if wrong: a profile assertion may move by a rounding digit, but the approved behavioral ranges and late ceilings remain exact.

Task 1 review: fixes required — Critical: equal seeded active time is chunk-dependent (score 27 for one 20 s update versus 18 for 200 × 100 ms); Important: applicable bonus/Last Stand/upgrade/pause/reset/immutability/chunking and seeded-run regression tests were deleted instead of migrated. Fix round 1/5 started from 90682a0.

Task 1: fix round 1/5 (2 addressed, 0 open — deterministic landing-boundary segmentation added; applicable regression coverage restored; commits 90682a0..b23d379).
Task 1: complete (commits e12a9f7..b23d379, review clean). Fresh controller verification: 24/24 files and 194/194 tests pass; TypeScript and `git diff --check` pass. User requested a pause after Task 1; Tasks 2–9 remain pending and must not be dispatched until the user resumes.
User resumed execution. Task 2 started from e5f705f.
Task 2 ruling: select plans internally at Settle start, but evaluate time gates at the emitted `situationPrepared` instant (cycle start + 20 s) and charge the plan against Pressure budget with `evidence.phase = 'pressure'`, because that is where the authored wave is spent. Also validate the 90 s gate again at actual anomaly start. Cost if wrong: cycle-number eligibility could shift one cycle; the chosen rule maps directly to active-time requirements (cycle 2 prepare 95 s/start 119.5 s, cycle 5 prepare 320 s no doubles, cycle 6 prepare 395 s doubles allowed).
Task 2 ruling: authorize a narrowly scoped `GameEngine` bonus-collection boundary fix after the new deterministic RNG sequence exposed event-order differences between 250 ms and 500 ms chunks. Require RED ordered-event-trace coverage and segment at the next token collection without changing schedule or targeting. Cost if wrong: Task 2 touches one additional engine file, but leaving it deferred would violate the binding deterministic-output requirement and make later presentation events chunk-dependent.
Task 2 ruling: resolve deferred bonuses exactly at the Settle boundary (`elapsedMs === 0`) and derive/canonicalize total active time from completed-cycle origin plus current elapsed time. Cost if wrong: a token may appear one caller tick earlier than the legacy implementation, but this is the earliest legal post-Release instant and removes chunk-dependent token speed/payload drift.
Task 2 review: Important finding — after confirming the third-cycle upgrade, a positive `update(500)` schedules the deferred bonus after moving 500 ms, while `update(250)` twice or `update(0)` then 500 ms yields different speed/distance. Fix round 1/5 starts at 9f9f672 with a RED positive-duration resume regression.
Task 2 minor (deferred): the director reset regression currently resets before warning or anomaly onset; a later test pass should advance into the warning/active state to preserve meaningful reset coverage.
Task 2: fix round 1/5 (1 addressed, 0 open — flush zero-time director effects before positive resume motion; commits 9f9f672..5079ecc).
Task 2: complete (commits e5f705f..5079ecc, review clean with one deferred minor). Fresh controller verification: 24/24 files and 221/221 tests pass; TypeScript passes. Task 3 is next. Preserve the warning/active reset-test minor for the final whole-branch review.

Task 2: complete. Deterministic threat plans now carry frozen budget, lane, anomaly, timing, and timestamp evidence. Forced and seeded plans obey time gates, compatibility, budget, cooldown, warning, and release rules. The narrow engine boundary fix preserves ordered event and token payloads across 250/500 ms updates and consumes a bonus due at zero time after the third-cycle upgrade. Focused verification: 118/118 tests in 8 files. Full verification: 220/220 tests in 24 files; `npm.cmd run typecheck` and `git diff --check` pass. The exploratory `ThreatProbe.test.ts` was removed after its seed was converted into a deterministic regression. Task 3 remains pending.

Task 3: complete (commit 457fe23..f5b0c3e, independent review approved with no Critical/Important findings). Opening preview and delayed first wave, one-shot authored threat waves, final profile clamps, and strict legal 35–50-second bonus spacing are integrated. Fresh controller verification: 231/231 tests across 24 files, TypeScript, and `git diff --check` pass. Browser smoke test captured the opening and first wave with real controls; no console errors were observed. Task 4 is next.
Task 3 minor (deferred): add a whole-engine integration test that reaches an authored Pressure wave with spawning enabled; current director and spawner tests cover the pieces independently. Audit the zero-time deferred bonus release path for final speed clamping in the Task 8 integration pass.

Task 4: complete (commits 6cdba71..66a5e3f, independent review/re-review approved with no Critical/Important findings). Opening stages, 90+800 ms collection transfer, 1.7 s acquisition/replacement copy, 1.8 s first-seen anomaly copy, 900 ms activation copy, mode-frozen visual clocks, and safe unknown-ID fallbacks are covered. Fresh controller verification: 249/249 tests across 24 files, TypeScript, and diff check pass. Task 5 is next.
Task 4 minor (deferred): a first-seen anomaly queued but later evicted before display is currently marked seen. Strict first-seen semantics would mark it only when the notice becomes visible; audit in Task 8/final review.
Task 4 handoffs: Task 6 must change Canvas transfer rendering from old 240/800 boundaries to 90/890, including `ivory` fallback palette. Task 7 can migrate old presentation snapshot literals and make `opening` required, and must style `ivory` fallback. Task 8 must call `beginRun` and pass live mode to `update`.
