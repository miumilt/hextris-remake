# HEXTRIS — Premium Minimal Arcade Redesign

## Context

The current remake is mechanically complete and visually coherent, but it still
feels like a careful prototype rather than a contemporary arcade game. The
opening is quiet, ordinary motion lacks weight, bonus acquisition is difficult
to follow, explanatory copy leaves too quickly, and late play mostly becomes
faster instead of changing rhythm. The redesign must preserve the existing
matte graphite identity while making the game feel richer, clearer, and more
deliberately paced.

This is a cohesive presentation and balance pass, not a new game mode. It keeps
the six-sided matching rules, deterministic engine, one-slot active bonuses,
run-only upgrades, and disruptive anomalies. It reorganizes those systems
around player skill, readable anticipation, and an endless Tetris-like pressure
curve.

## Product Intent

The result should feel like a premium minimalist arcade game:

- quiet visual surfaces with strong, brief moments of impact;
- movement that has anticipation, weight, release, and recovery;
- an endless run whose difficulty is governed by mastery rather than a timer
  that eventually guarantees death;
- special events that surprise the player without concealing the information
  needed to respond;
- a bonus lifecycle that is understandable without external instructions;
- no generic card dashboard, neon glow, glassmorphism, reward clutter, or
  mobile-game presentation language.

The first 30 seconds must already feel alive. By five minutes the run must have
changed character, not merely increased numerical speed.

## Core Run Rhythm

### Endless structure

The run has no designed completion time. New players may survive only a few
minutes, while skilled players can continue indefinitely. Difficulty grows
rapidly at first and then approaches practical speed ceilings. Past those
ceilings, additional pressure comes from composition, overlapping decisions,
and shorter recovery windows rather than unreadable velocity.

Each 75-second cycle has four authored phases:

| Phase | Duration | Purpose |
| --- | ---: | --- |
| Settle | 20 s | Establish readable singles, pairs, and lane intent. |
| Build | 35 s | Mix patterns and introduce one prepared complication. |
| Pressure | 15 s | Deliver the cycle's densest fair pattern or active anomaly. |
| Release | 5 s | Reduce arrivals and let the player reorganize the field. |

The release is real simulation time, not a menu. It never hides a delayed
hazard or starts an unannounced anomaly.

### Difficulty curve

The balance targets are behavioral, with exact formulas finalized in the
implementation plan and verified by deterministic profiles:

- opening: roughly 150 world units/second fall speed and a 2.4–2.7 second
  arrival interval;
- two minutes: about 250–300 units/second with a 1.3–1.6 second interval;
- five to seven minutes: about 420–500 units/second with a 0.7–0.9 second
  interval;
- late-run soft ceilings: no more than roughly 600 units/second and no less
  than roughly 0.5 seconds between authored arrivals.

The director must not keep multiplying both speed and cadence after the player
reaches the late-run band. Later cycles spend more of their threat budget on
pattern composition, anomaly timing, lane coverage, and reduced recovery.

Progress remains deterministic for a seed. It never secretly becomes easier
because the player is losing and never secretly becomes harder because the
player is performing well. Score rewards mastery rather than driving hidden
difficulty.

## Threat Director and Fairness

The existing cycle director evolves into a threat-budget director. Every
authored wave, anomaly, simultaneous lane demand, and recovery reduction has a
cost. Each phase receives a capped budget; spending more on one axis requires
spending less on the others.

Rules:

- no dangerous anomaly during the first 90 active seconds;
- every anomaly has at least 2.5 seconds of warning;
- no identical high-pressure combination in consecutive cycles;
- double anomalies begin only after six active minutes;
- double anomalies receive a longer warning and cannot be paired with the
  densest available wave;
- release phases cannot schedule hidden complications;
- the same lane cannot receive an unreadable burst beyond the authored wave
  caps;
- a complex wave paired with an anomaly must use a weaker anomaly tier or a
  longer entry delay;
- deterministic cooldowns prevent repeated punishment by the same mechanic.

The system must be able to explain every hard moment from its seed, cycle,
phase, budget, and selected events. Randomness selects among legal authored
situations; it does not decide whether a situation is fair.

## Situation Vocabulary

Existing anomalies remain, but their readable evidence becomes part of their
contract:

- **REVERSE:** a directional ring previews the control swap for 2.5 seconds.
- **MIRAGE:** decoys remain lighter and fragmented; the real route retains the
  densest trail.
- **DRIFT:** the destination lane is previewed with a faint landing contour.
- **COLOR SHIFT:** the future color appears as an inset facet before the swap.
- **INERTIA:** the hub shows direction and remaining rotational impulse.
- **Double threat:** two compatible cues are presented without either cue
  hiding the other, and the warning lasts longer than a single threat.

The first appearance of each anomaly includes its name and one concise
explanation for 1.8 seconds. Later appearances use only the compact warning and
visual cue.

## Opening Choreography

Pressing PLAY begins a 1.2-second in-engine transition rather than dropping
the player into an empty field:

1. the central hub assembles from six matte facets;
2. background guides converge toward the playable hex;
3. the first arrival lanes are previewed with thin directional lines;
4. `READY` appears briefly and clears before the first decision is required;
5. the first authored wave enters with full assembly motion.

This sequence contains no tutorial modal. The engine enters `playing`
immediately, the player may rotate or pause, and deterministic active time
continues normally. The first authored arrival is delayed so it cannot demand a
decision before the 1.2-second presentation completes. The same fixed-step
clock advances the opening and spawn delay, including through the public QA
time-step hook.

## Motion Language

Every important action follows the same readable grammar:

1. **Anticipation:** a short contraction, alignment, or directional cue.
2. **Impact:** one decisive change in shape, speed, or contrast.
3. **Recovery:** motion settles quickly and returns attention to the field.

### Ordinary blocks

- A block assembles from two matte facets rather than popping into existence.
- A short directional trail establishes its lane.
- Landing uses a restrained squash and a local response from adjacent hub
  geometry.
- A match contracts for 70–90 ms around one deterministic fracture seam before
  releasing larger polygon fragments.
- Chain clears reuse this language with a wider ring, heavier but capped
  impulse, and stronger score typography.

Ordinary events must restore a fully readable field within one second. Effects
may not accumulate without hard caps.

### Background and phase response

The graphite background remains quiet. Guide geometry changes density and
convergence by phase:

- Settle: slow, open motion;
- Build: slightly denser directional structure;
- Pressure: subtle convergence toward the hub;
- Release: guides relax outward.

The background does not become a full-screen color wash for routine events.
Strong color fields are brief activation accents only.

## Bonus Lifecycle

### Falling token

A bonus uses a distinct faceted silhouette, inset glyph, slow orbiting outline,
and longer trail. Its gameplay lane and collision rules remain unchanged.

### Collection

Collection is a staged event:

1. 80–100 ms visual-only impact hold;
2. one expanding ring from the real collection point;
3. a clearly visible 0.8-second curved glyph flight to the inventory slot;
4. centered name and explanation for 1.6–1.8 seconds;
5. a persistent inventory slot containing glyph, full name, `SPACE`, and a
   one-line description until the bonus is used or replaced.

The slot is part of the game's visual language, not a generic UI card. It uses
clipped matte geometry, a thin accent rule, and restrained scale response.

### Replacement

The old glyph is pushed outward, rotates slightly, and dissolves into a few
bounded fragments. The new glyph enters with a small overshoot and settles.
The notice names both bonuses. No confirmation interrupts play.

### Activation identities

- **SLOW:** a cool ivory/sky contour wave, brief directional stretching, longer
  block trails, and a visible six-second rule.
- **PULSE:** the hub compresses, then releases two or three concentric hex
  impulses with staggered outward block impacts.
- **CLEANSE:** the selected side is bracketed, then one narrow cut travels from
  outside toward the hub before fragmentation.
- **COLOR BREAK:** the chosen color locks in a short contrast beat, matching
  plates respond together, then fracture in deterministic waves.

Activation copy and canvas motion begin together. An empty removal still shows
a restrained identity pulse but never fabricates destroyed blocks.

### Balance role

Bonuses are an earned tactical escape, not the primary way to survive. They are
scheduled deterministically every 35–50 active seconds outside incompatible
pressure moments. Their targeting remains rule-driven and reproducible. A
strong player must be able to continue without receiving an ideal bonus.

## Run-Only Upgrades

Upgrade choice appears after every third completed cycle, during the natural
release boundary. The game pauses for selection and resumes into a readable
Settle phase.

Two choices are offered. Upgrades may improve control, scoring, or an existing
bonus, but no choice may be mandatory for survival and no combination may
remove the late-run challenge. Permanent progression, currencies, shops, and
unlock grinds remain out of scope.

## HUD and Copy

The HUD remains sparse:

- top center: score, multiplier, and a thin phase-progress rule;
- near the field: warnings attached to the side or direction they affect;
- lower right: persistent bonus glyph, name, description, and activation key;
- large centered text only for opening readiness, cycle pressure, bonus
  lifecycle events, major chains, and Last Stand;
- overflow danger appears on the threatened side rather than in a detached
  red panel.

Notifications must remain long enough to read without obscuring the field.
Acquisition copy lasts 1.6–1.8 seconds; first-time anomaly explanations last
1.8 seconds; activation copy lasts at least 0.9 seconds. Essential bonus meaning
remains in the slot after transient copy expires.

## Architecture

### `GameEngine`

Remains the deterministic authority for grid state, movement, matches, score,
bonus effects, and game over. Presentation never changes targeting or results.

### `ThreatDirector`

Owns 75-second phase structure, speed/cadence profiles, threat budgets,
cooldowns, compatibility rules, and deterministic authored selection. It emits
descriptive immutable events for the presentation layer.

### `PresentationSystem`

Owns opening choreography, notification lifetimes, bonus transfer/replacement,
first-seen explanation state for the current run, and phase announcements. It
advances only during appropriate game modes and resets completely on a new run.

### `EffectsSystem`

Owns bounded world-space motion: assembly facets, trails, anticipation seams,
fragments, waves, local shake, short visual holds, and phase response. It
exposes immutable snapshots and never mutates gameplay.

### `CanvasRenderer`

Uses an explicit layer order:

1. graphite background and grain;
2. phase-responsive guides;
3. hub and attached stacks;
4. falling blocks and tokens;
5. local world effects;
6. screen-space accents and typography alignment.

This layer contract prevents new effects from obscuring essential geometry.

### `ScreenController`

Owns semantic copy, controls, focus, and persistent HUD elements. It preserves
stable DOM nodes across animation frames and synchronizes notices with the same
presentation snapshot rendered by canvas.

## Performance, Accessibility, and Failure Behavior

- Canvas rendering remains dependency-free Canvas 2D plus CSS UI.
- Particle, fragment, shockwave, label, and trail channels retain explicit
  caps under dense late play.
- Invalid or missing presentation metadata falls back to a readable static cue
  without interrupting gameplay.
- A presentation reset, retry, menu return, HMR cycle, or elapsed-time rollback
  clears every transient channel.
- `prefers-reduced-motion` preserves all names, warnings, destinations, bonus
  meaning, and controls while replacing travel, stretching, strong shake, and
  long holds with short local fades.
- Color is never the only identifier; glyph silhouette, motion, copy, and
  location carry meaning.

## Verification

### Deterministic model tests

- exact 75-second phase boundaries and release behavior;
- early, mid, and late speed/cadence profiles including soft ceilings;
- threat-budget caps and compatibility rules;
- no dangerous anomaly before 90 seconds;
- no consecutive repetition of the same high-pressure combination;
- no double anomaly before six minutes;
- identical seed and command streams produce identical engine/director output;
- bonus schedule remains within 35–50 active seconds and outside illegal
  pressure windows;
- upgrades occur every third cycle and never leak across runs.

### Presentation and renderer tests

- opening stages and their exact handoff to active play;
- block anticipation, impact, and recovery timing;
- collection hold, ring, transfer, persistent description, and replacement;
- all four activation identities, including empty removals;
- anomaly warnings expose their required readable evidence;
- effect collections stay bounded and reset-safe;
- reduced motion removes disruptive travel without removing information.

### Browser QA

At 1280×720 and 1920×1080, exercise and inspect:

1. menu to 1.2-second opening to first wave;
2. the first 90 seconds with readable progression and no dangerous anomaly;
3. every anomaly warning and active state;
4. falling, collected, stored, replaced, and activated bonuses;
5. ordinary clear, chain clear, Last Stand, overflow, retry, and menu reset;
6. an upgrade after the third cycle;
7. a five-to-seven-minute pressure profile;
8. a late-run profile at the speed/cadence ceilings;
9. reduced-motion equivalents;
10. pause/resume during every transient category.

The final console warning/error list is empty. Screenshots and
`render_game_to_text` must agree on mode, phase, threat, anomalies, stored
bonus, and timers.

## Acceptance Criteria

- The first 30 seconds contain authored motion and meaningful decisions without
  an empty or confusing start.
- A first-time player can identify a bonus, follow it into the HUD, understand
  its effect, and activate it without external instructions.
- Every strong animation has readable anticipation and finishes without hiding
  the next decision.
- At five minutes, play feels qualitatively different from the opening.
- Late difficulty continues through situation complexity after speed reaches
  its soft ceiling.
- Hard moments are reproducible and satisfy the threat-budget fairness rules.
- Visual style remains matte, restrained, and recognizable as the existing
  remake while feeling more physical and contemporary.
- Gameplay snapshots remain deterministic and independent from presentation.

## Explicit Non-Goals

- no permanent progression, currency, shop, unlock track, account, analytics,
  alternate mode, or mobile-specific controls;
- no neon glow, glass panels, bloom-heavy rendering, continuous shake, or
  particle saturation;
- no audio or music in this pass;
- no dependency-heavy engine rewrite or WebGL migration;
- no change to the fundamental six-sided matching rule.
