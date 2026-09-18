# HEXTRIS — Readable Bonus Feedback and Expressive Block Motion

## Context

The endless-run mechanics are implemented and deterministic, but their visual
communication is too quiet. A player can collect a bonus without understanding
what was collected, where it went, which key activates it, or what changed when
it was used. Regular blocks also enter and disappear with too little authored
motion, so new mechanics do not create the perceived variety and progression
that already exists in the rules.

This iteration makes the existing systems legible and satisfying. It does not
add more bonus types or change balance. It creates one presentation language for
special-object arrival, collection, storage, activation, block entry, matches,
chains, and bonus-driven removal.

## Goals

- Make the complete bonus lifecycle understandable without reading external
  instructions: special object, collection, inventory, activation key, effect,
  and consumption.
- Make ordinary block entry and destruction feel authored rather than abrupt.
- Give each existing bonus a recognizable identity and activation effect.
- Preserve the graphite, matte, restrained visual direction while allowing
  short, strong moments of emphasis.
- Keep gameplay state, scoring, targeting, and timing deterministic and
  independent from presentation.
- Keep feedback bounded so dense late-game play remains readable and fast.

## Non-goals

- No new bonuses, upgrades, anomalies, scoring rules, or difficulty changes.
- No permanent progression, currency, shop, unlocks, account, or saved profile.
- No audio, music, touch redesign, or additional game mode in this iteration.
- No permanent large dashboard, tutorial modal, or mobile-game-style reward
  screen.
- No neon glow, glass panels, excessive blur, or continuous camera shake.

## Visual Principles

Important information uses a short three-step hierarchy:

1. **Locate:** motion begins where the event happened.
2. **Explain:** a concise centered message names the event and its effect.
3. **Anchor:** the result moves to, or remains visible in, a stable HUD location.

Strong effects are brief. Labels use the existing condensed and mono typography,
matte color fields, clipped corners, thin rules, and the four gameplay colors.
The field must be readable again within one second of any ordinary event.

## Bonus Presentation Vocabulary

One exhaustive presentation map is the source of truth for bonus label,
description, glyph, tone, and activation copy. UI and canvas code consume this
map instead of maintaining separate label tables.

| Bonus | Collection description | Activation identity |
| --- | --- | --- |
| `SLOW` | Slows falling blocks for 6 seconds | Cool ivory/sky wave, stretched trails, visible remaining-time rule |
| `PULSE` | Knocks blocks from several outer sides | Expanding central hex pulse followed by sequential outward impacts |
| `CLEANSE` | Clears the tallest side | Tallest side is bracketed, sliced from outside inward, then fragmented |
| `COLOR BREAK` | Removes every block of one selected color | Matching plates flash together, their color is named, then they shatter across the field |

Glyphs must differ by silhouette, not color alone, so the bonuses remain
distinguishable with reduced color perception.

## Bonus Lifecycle

### 1. Scheduled and falling

A falling bonus is visibly different from a normal plate from its first frame.
It uses a compact faceted token, an inset glyph, a thin orbiting outline, and a
short directional trail. Its lane remains mechanically identical to the current
implementation. No explanatory text follows the moving token because that
would obscure the playfield.

### 2. Collected

Collection starts at the token's final world position:

- a 70 ms visual-only impact hold;
- one expanding outline ring;
- a centered notification for 900 ms;
- title `<BONUS> ACQUIRED` and one short description from the presentation map;
- a copy of the glyph travels on a curved path from the collection point to the
  stable bonus slot between 240 and 650 ms.

Simulation continues normally. The visual hold affects rendering only, matching
the existing hit-stop rule.

### 3. Stored

The occupied bonus slot remains visible during play and contains:

- glyph;
- full bonus name;
- `SPACE — ACTIVATE`;
- a clipped matte background and thin progress-like accent rule.

The slot pulses clearly for 2.5 seconds after collection, then settles into a
quiet but legible state. It must not use vertical text. Empty inventory removes
the slot completely so consumption is obvious.

### 4. Replaced

When a new bonus replaces an occupied slot, the old glyph is displaced outward
and fades while the new glyph enters. The centered message reads
`<NEW BONUS> REPLACED <OLD BONUS>` and uses the new bonus description. The
sequence lasts no longer than 950 ms and never asks for confirmation.

### 5. Activated

Activation immediately consumes the slot, shows `<BONUS> ACTIVATED` for
620 ms, and launches the bonus-specific canvas sequence. Removals remain driven
by the engine's existing `bonusRemoved` cells and blocks. If a removal bonus has
no valid cells, the activation message and slot consumption still occur, but
the renderer uses a restrained empty pulse rather than pretending blocks were
destroyed.

`SLOW` additionally exposes a compact six-second rule beside the former slot
position. The rule is derived from `slowRemainingMs`, disappears at zero, and
does not become a second inventory slot.

## Block Entry

Regular falling blocks no longer pop into existence. A new `blockSpawned` game
event describes the already-created block without changing its mechanics. The
presentation uses it for a 180 ms assembly:

- two or three matte facets converge into the final plate silhouette;
- opacity and scale move from 0.72 to 1;
- a thin line briefly connects the spawn edge to the block;
- a short color trail establishes its direction.

Multi-block wave patterns keep their authored mechanical delays. Their assembly
inherits those delays, making pairs, circles, half-circles, and spirals visibly
different without adding more rules. Bonus tokens use their separate token
assembly rather than the normal plate assembly.

## Match and Destruction Motion

### Ordinary clear

Cleared plates use a readable two-stage sequence:

1. 60–80 ms anticipation: the plate contracts, darkens at its seams, and shows
   one deterministic fracture line.
2. Release: 6–8 polygon fragments travel away from the clear origin, rotate,
   darken, and expire within 650–780 ms.

A local shockwave and restrained camera impulse connect the fragments to the
match. Neighboring stacks remain fully readable.

### Chain clear

Chains reuse the ordinary clear and add escalation rather than a different
style:

- a larger central outline ring;
- slightly larger fragments and impulse, capped at a safe maximum;
- `CHAIN ×N` near the score;
- an amber accent on the ring and typography.

Later chains never multiply particles without limit. Fragment count, labels,
shockwaves, and camera magnitude retain hard caps.

### Bonus removal

Bonus removal uses the same plate fragments so material remains consistent, but
the direction and timing come from the bonus identity:

- `PULSE` removes selected outer plates in a fast radial sequence;
- `CLEANSE` progresses along the tallest side from outside toward the hub;
- `COLOR BREAK` synchronizes the first flash across every matching plate, then
  releases fragments in small deterministic waves;
- `SLOW` changes motion and trails but removes no plates.

## Architecture

### `bonusPresentation`

A small immutable module provides exhaustive metadata for every `BonusType`:
label, description, glyph id, visual tone, and activation copy. TypeScript must
fail compilation when a new bonus type lacks presentation metadata.

### `PresentationSystem`

A new browser-independent system consumes immutable `GameEvent` batches and
advances on fixed presentation time. It owns only high-level communication:

- centered notification queue;
- bonus collection/replacement glyph transfer;
- slot-attention timing;
- activation announcement;
- priority and coalescing when events share one fixed step.

It exposes an immutable `PresentationSnapshot`. Critical events have priority
in this order: Last Stand/game over, bonus activation, bonus replacement or
collection, chain, ordinary informational messages. The queue is bounded to
three items; repeated lower-priority messages coalesce rather than burying a
bonus explanation.

### Presentation event metadata

The engine adds only descriptive, immutable event data:

- a new `blockSpawned` event carries the spawned block id, lane, color, and
  starting distance;
- `bonusCollected` additionally carries the collected token id, lane, and final
  distance so the glyph transfer starts at the real collection point.

These fields describe state the engine has already decided. They do not add a
command, delay simulation, select a target, or change scoring. The
`bonusReplaced`, `bonusActivated`, and `bonusRemoved` events keep their existing
rule meaning.

### `EffectsSystem`

`EffectsSystem` continues to own world-space visual physics: assembly facets,
trails, fracture fragments, flashes, shockwaves, screen flash, hit stop, and
camera impulse. It consumes the same engine events and presentation metadata.
It does not own explanatory copy or inventory state.

### `CanvasRenderer`

The renderer draws the new world-space effects from immutable effect snapshots.
It does not infer rewards, target cells, or bonus rules. Existing stable block
ids are used to preserve motion continuity through falling, landing, collapse,
and destruction.

### `ScreenController`

The screen controller receives the game snapshot plus the presentation
snapshot. It renders semantic live-region notifications, the stable bonus slot,
the activation key, replacement state, and the SLOW duration rule. It preserves
focus and avoids rebuilding unchanged DOM every animation frame.

### Data flow

```text
GameEngine update
  -> immutable GameEvent batch
      -> PresentationSystem (meaning, copy, timing, HUD cues)
      -> EffectsSystem      (world-space motion and impact)
  -> immutable GameSnapshot
      -> CanvasRenderer(GameSnapshot, EffectsSnapshot)
      -> ScreenController(GameSnapshot, PresentationSnapshot)
```

Neither presentation consumer can enqueue engine commands or mutate the game
snapshot. Restart, retry, menu, and hot reload reset both systems together.

## Timing, Pause, and Error Handling

- Invalid or negative presentation deltas are clamped to zero; individual
  visual updates retain the existing frame cap.
- Pause and upgrade selection freeze transient presentation exactly. Menu and
  new-run transitions clear it. Game over consumes its final event, renders the
  result transition once, then freezes; no cue advances behind an overlay.
- Returning to menu or starting a new run clears messages, transfers, assembly,
  fragments, slot attention, and SLOW timing presentation.
- Missing world coordinates fall back to the field center without dropping the
  explanatory notification.
- Empty bonus removals produce an activation pulse but zero fake fragments.
- All transient collections remain bounded under late-game event density.

## Reduced Motion and Accessibility

With `prefers-reduced-motion: reduce`:

- collection and activation names/descriptions remain visible;
- the occupied slot and `SPACE — ACTIVATE` remain unchanged;
- glyph travel becomes a short cross-fade;
- assembly becomes a fade without facet convergence;
- fragments are replaced by brief local fades;
- large shake, long hit stops, parallax, and sweeping motion are removed.

Notifications use a polite live region for collection/replacement and an
assertive announcement only for Last Stand or game over. Visual glyphs are
decorative beside complete readable text. Color is never the only identifier.

## Verification

### Unit tests

- exhaustive bonus presentation metadata;
- notification priority, coalescing, expiry, and queue cap;
- collection, replacement, activation, and reset timelines;
- deterministic assembly/fracture snapshots with seeded randomness;
- particle, trail, label, shockwave, and shake caps;
- empty removal and reduced-motion behavior.

### UI and renderer tests

- occupied slot contains the exact bonus name and `SPACE — ACTIVATE`;
- replacement and activation update without focus loss or continuous DOM
  rebuilding;
- SLOW rule reflects `slowRemainingMs` and disappears at zero;
- regular blocks, bonus tokens, ordinary clears, chains, and all four bonus
  activations issue the expected bounded draw operations;
- gameplay geometry remains unchanged by presentation snapshots.

### Browser QA

Run the production page at 1280×720 and 1920×1080. Inspect and capture:

1. normal block assembly and a multi-block pattern;
2. falling bonus token;
3. acquisition message and glyph transfer;
4. occupied slot and replacement;
5. all four activation identities, including empty removal;
6. ordinary clear and chain clear;
7. pause during a notification and reset through retry/menu;
8. reduced-motion equivalents;
9. dense late-cycle play with no clipped UI or unreadable field.

The final console warning/error list must be empty.

## Acceptance Criteria

- A first-time player can identify a falling bonus, name the collected bonus,
  find it in the HUD, discover the activation key, and understand the result of
  activation without external instructions.
- Each existing bonus is recognizable by glyph, copy, and activation motion.
- Normal entry, normal clear, chain clear, and bonus removal are visually
  distinct while sharing one material language.
- Gameplay rules and deterministic game snapshots are unchanged. Event output
  gains the descriptive `blockSpawned` event and collection-origin metadata.
- Presentation remains bounded, reset-safe, pause-safe, responsive, and usable
  with reduced motion.
