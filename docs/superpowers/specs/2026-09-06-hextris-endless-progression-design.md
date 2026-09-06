# HEXTRIS — Endless Progression, Anomalies, Bonuses, and Stronger Feedback

## Context

The current remake has a complete deterministic Hextris loop, four UI states,
seeded wave patterns, a continuous difficulty ramp, and restrained visual
effects. The next iteration must make long runs evolve qualitatively instead
of only repeating the same patterns at a capped speed.

This design adds an endless cycle structure, temporary gameplay anomalies,
collectible one-slot active bonuses, between-cycle upgrades that last for the
current run, and a stronger hierarchy of visual feedback. It preserves the
desktop-first static architecture and the handmade graphite/matte visual
language.

## Goals

- Make every minute of a long run feel meaningfully different.
- Keep increasing speed and spawn pressure over active play time, similar to
  an endless runner, until the run becomes nearly impossible.
- Introduce fair rule disruptions that demand adaptation rather than relying
  only on faster input.
- Give the player tactical recovery tools without removing the threat of
  eventual failure.
- Let each run develop a small passive build through permanent-for-the-run
  upgrades.
- Make landings, clears, chains, bonus use, anomalies, and surge completion
  more visceral with stronger shake, flashes, hit stops, and geometry.
- Keep the permanent in-game interface minimal and readable.

## Non-goals

- No permanent progression between runs, currency, shop, account, inventory,
  daily challenge, or saved unlocks.
- No separate campaign, level map, or narrative mode.
- No large skill tree or build-management screen.
- No touch-specific redesign, server component, analytics, or audio in this
  iteration.
- No deliberately invisible, unavoidable, or instantly lethal anomaly.

## Endless Run Structure

### Cycles

Active play is divided into 55-second cycles. Paused time, anomaly warnings,
and upgrade selection do not consume cycle time.

- `FLOW`, 30 seconds: normal weighted wave generation and continuous pressure.
- `PRESSURE`, 15 seconds: denser multi-lane patterns and a higher anomaly
  chance.
- `SURGE`, 10 seconds: a clearly announced compact sequence of difficult but
  valid waves.
- `UPGRADE`: simulation stops until the player chooses one of two upgrades.

The cycle indicator is a thin progress rule near the score. Phase names appear
only briefly, such as `CYCLE 04`, `PRESSURE`, and `SURGE`.

### Continuous Difficulty

Difficulty is based on active run time rather than frame rate or wall-clock
time. Falling speed grows continuously from 150 world units/second by roughly
1.5 units for every active second, capped at 780. The normal wave interval
follows a smooth exponential decline from 2700 ms toward a hard floor of
320 ms. `PRESSURE` multiplies the current interval by 0.78; `SURGE` multiplies
it by 0.52 and uses authored burst spacing.

The speed and interval limits protect readability and the fixed-step runtime.
After either limit is reached, difficulty keeps growing through pattern
weights, simultaneous lanes, shorter recovery gaps, and compatible double
anomalies. Random generation may create hard choices but must not schedule an
immediate same-lane collision pattern that is impossible to react to.

Pattern weights evolve by cycle:

- Cycles 1–2 favor singles and pairs.
- Cycles 3–5 introduce more opposite, half-circle, and spiral patterns.
- Cycle 6 onward favors compound sequences and may combine two compatible
  anomalies.
- Late cycles continue increasing the share and cadence of difficult patterns
  until survival is practically unlikely, without an artificial final level.

## Gameplay Anomalies

Anomalies last 8–12 active seconds and never count down during pause or upgrade
selection. Before activation, the game gives a 1000 ms warning with a phase
label, a geometric field cue, and a short visual impact. The warning itself
does not alter controls or block behavior.

Only one anomaly appears at a time before cycle 6. From cycle 6 onward, the
director may select two entries from a compatibility table. `REVERSE` and
`INERTIA` are not combined in the first version.

### `REVERSE`

For 9 seconds, left and right rotation commands are inverted inside the game
rules. `InputController` retains its normal semantic mapping so browser input,
documentation, and tests stay truthful. The HUD swaps its arrow symbols and
the guide rings reverse direction while the anomaly is active.

### `MIRAGE`

For 10 seconds, selected real falling blocks receive a translucent decoy on an
adjacent lane. Decoys have slightly broken edges and lower opacity, never
collide, never enter the logical grid, and dissolve before the real block
reaches the final safe reaction zone.

### `DRIFT`

For 12 seconds, selected blocks transition by one lane clockwise or
counterclockwise between the outer and middle portions of their flight. Their
curved trail reveals the destination in advance. The block's landing lane is
the announced destination; there is no last-frame lane switch.

### `COLOR SHIFT`

For 10 seconds, selected blocks change color once at a fixed mid-flight
distance. From spawn, the block carries a visible secondary-color facet and a
small vibration, so the change can be anticipated. The logical color changes
at the same deterministic boundary on every frame rate.

### `INERTIA`

For 8 seconds, accepted rotation commands execute after a 180 ms fixed-step
delay. The normal maximum of two queued rotations remains. The hub and guide
ring show the delayed direction immediately, so the input is heavy rather
than lost.

## Collectible Active Bonuses

### Collection and Slot Rules

A collectible bonus token is scheduled by the seeded game director every
28–42 active seconds outside `SURGE`. It approaches along a normal lane as an
ivory, matte geometric token with a distinct glyph. On reaching the hub it is
collected rather than attached to a stack.

The player has exactly one bonus slot. Collecting a new token replaces the
stored bonus immediately. The replacement is announced visually; there is no
confirmation dialog. Pressing `Space` activates the stored bonus during
normal play. `Space` does nothing if the slot is empty. Bonus effects and
stack changes are deterministic and occur on a fixed simulation step.

Bonus-created removals award 3 points per removed block but never extend or
increase the match combo.

### Bonus Types

- `SLOW`: multiplies falling motion and wave-delay countdown by 0.55 for six
  active seconds. Difficulty time continues, so the run resumes at its proper
  pressure afterward.
- `PULSE`: removes the outermost block from each of the three tallest nonempty
  sides. Ties use clockwise side order from the current top.
- `CLEANSE`: removes every attached block from the single tallest side. Ties
  use the same deterministic ordering.
- `COLOR BREAK`: finds the outermost block on the tallest side and removes all
  attached blocks of that color. It is the rarest bonus.

Bonus removals emit their own events and fragments but do not masquerade as
normal matches. If a bonus prevents an overflow on the same fixed step, the
resulting grid is evaluated before game over.

## Permanent-for-the-run Upgrades

After every completed `SURGE`, the mode becomes `upgrade`. The field remains
visible and frozen beneath two angular choices. Left/right or `A`/`D` changes
selection; `Space` or `Enter` confirms. Mouse clicks remain supported. No
cycle, anomaly, bonus, or difficulty timer advances while choosing.

An upgrade persists until game over, restart, or return to menu. It never
persists in browser storage.

The initial pool is:

- `STABILIZER`, maximum 3: reduces falling speed by 4% per level, applied
  after the global difficulty calculation.
- `COMBO RELAY`, maximum 3: adds 300 ms to the combo window per level.
- `SALVAGE`, maximum 3: shortens the next bonus-token interval by 15% per
  level, subject to a 16-second floor.
- `DEEP PULSE`, maximum 2: `PULSE` affects one additional side per level.
- `ANOMALY SHIELD`, maximum 3: shortens anomaly active duration by 15% per
  level, subject to a 4-second floor.
- `LAST STAND`, maximum 1: the first overflow that would end the run instead
  consumes this upgrade, clears the tallest side, and produces a major rescue
  effect.

The two choices are distinct, seeded, and exclude maxed upgrades. When every
upgrade is maxed, later surges skip the choice and award an escalating cycle
score bonus; endless play never stalls on an empty selection screen.

## Visual Feedback and UI

The visual style remains graphite, ivory, coral, amber, teal, and sky blue.
Stronger feedback may use pronounced shake, flashes, and short visual hit
stops, but no neon glow, purple gradient, glass card, or pill controls.

### Feedback hierarchy

- Landing: 70–90 ms plate compression, brighter edge strike, a few fragments,
  and a 2–3 world-unit camera kick.
- Normal clear: contraction, about 60 ms visual hit stop, directional particle
  burst, a stronger 4–6 unit shake, and animated score addition.
- Chain clear: expanding central ring, larger fragments, increasing shake,
  and a brief `CHAIN ×N` typographic strike.
- Bonus use: 70–100 ms visual freeze followed by a full-field geometric wave;
  affected plates fragment in the bonus's direction.
- Anomaly start: one strong frame accent, temporary guide transformation, and
  the anomaly name. The effect must clearly end when the rule ends.
- Surge completion and `LAST STAND`: strongest legal feedback, with a deep
  camera hit, full-field flash, layered fragments, and a short recovery ease.

Simulation remains fixed-step and never pauses for a renderer hit stop. Visual
time may briefly hold or ease while logical time continues deterministically.
`prefers-reduced-motion` removes hit stops, large shake, and parallax while
retaining readable labels and rule cues.

### Persistent HUD

During play the HUD contains only:

- current score;
- a thin cycle-progress rule and compact cycle number;
- one active-bonus slot with glyph and `SPACE` hint when occupied;
- small glyphs for acquired upgrade levels;
- the existing compact pause control.

Anomaly and phase names are transient. The upgrade screen uses two large
clipped geometric regions rather than card components or a permanent menu.

## Architecture and Data Flow

### `CycleDirector`

Owns active cycle time, phases, difficulty output, anomaly scheduling,
compatibility, surge scripts, and bonus-token schedule. It receives a seeded
random source and returns immutable directives; it does not mutate the grid or
DOM.

### `BonusSystem`

Owns the one-slot inventory, active timed bonus state, replacement rules, and
deterministic targeting for removal bonuses. It produces grid operations and
events through an explicit engine-facing interface.

### `UpgradeSystem`

Owns upgrade levels, seeded distinct choices, caps, and derived modifiers. It
does not know about Canvas or input keys.

### `GameEngine`

Remains the sole owner of authoritative match state. It coordinates the three
systems, applies semantic commands, and expands `GameSnapshot` with cycle,
phase, warning/anomaly state, bonus token/slot, upgrade choices and levels,
and any deterministic per-block anomaly metadata.

New commands include `activateBonus`, `selectUpgrade(-1|1)`, and
`confirmUpgrade`. Existing rotate commands remain semantically left/right at
the input boundary; `REVERSE` changes their application in `GameEngine`.

New events include phase/cycle changes, anomaly warning/start/end,
bonus-spawned/collected/replaced/activated, bonus removals, upgrade offered and
selected, and last-stand rescue. `EffectsSystem`, `CanvasRenderer`, and
`ScreenController` consume these immutable states and events without changing
simulation results.

## Reliability and Fairness

- All new timing uses fixed active simulation time.
- Pause, hidden-tab pause, menu, game over, and upgrade selection freeze every
  cycle/anomaly/bonus timer.
- Restart and menu reset director, inventory, active bonuses, upgrade levels,
  anomaly metadata, queued delayed rotations, and visual effects.
- Large real-frame jumps retain the existing runtime cap.
- Anomaly warnings always complete before rule changes begin.
- Mirage entities cannot affect collision, score, matching, or overflow.
- Drift destinations and color-shift outcomes are selected at spawn and shown
  immediately in the snapshot.
- Removal bonuses operate through validated grid methods and never create
  sparse stacks.
- `LAST STAND` is consumed before the final overflow decision and cannot fire
  twice.
- Upgrade choices cannot contain duplicates or maxed entries.
- Late-cycle scheduling preserves a minimum reaction budget even while making
  sustained survival increasingly unlikely.

## Testing and Browser QA

Automated tests cover:

- phase boundaries and frozen non-playing timers;
- continuous speed/interval growth and technical floors/caps;
- evolving pattern weights and authored surge scheduling;
- anomaly warning, activation, compatibility, expiry, and deterministic block
  metadata;
- reversed semantic rotation, inertia delay, drift destination, mirage
  non-collision, and color-shift boundary;
- bonus spawn, replacement, activation, deterministic targeting, scoring, and
  combo isolation;
- upgrade choices, caps, derived modifiers, full-pool fallback, and total run
  reset;
- last-stand ordering before game over;
- immutable snapshots/events and frame-sequence determinism;
- bounded effect state and reduced-motion behavior.

Browser QA uses the existing `render_game_to_text` and `advanceTime` hooks and
the installed web-game Playwright client. It exercises at least three complete
cycles, every anomaly in a deterministic seeded scenario, bonus collection and
replacement, every active bonus, upgrade selection by keyboard and mouse,
pause during warning/anomaly/bonus/upgrade, restart reset, late-run pressure,
and game over. Screenshots are inspected for landing, normal clear, chain,
bonus activation, anomaly warning/active state, surge, upgrade selection, last
stand, and settled gameplay at both supported desktop sizes. Console and page
errors must remain empty.

## Acceptance Criteria

- A long run has visible cycles, increasing pressure, special situations, and
  no static late-game plateau.
- Every anomaly is disruptive but telegraphed and mechanically reproducible.
- A bonus token can be collected, replace the slot, and activate with `Space`.
- Two upgrades are offered after each surge and persist only for that run.
- Speed and spawn cadence continue to intensify until late play is nearly
  impossible.
- Stronger shake, flashes, hit stops, fragments, and typography make important
  events substantially more expressive without obscuring the grid.
- The permanent HUD remains compact and the upgrade choice does not resemble a
  generic card interface.
- Restart/menu/game over leave no progression state behind.
- Unit, integration, build, and full browser QA pass with no console errors.
