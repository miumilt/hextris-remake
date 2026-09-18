# HEXTRIS remake

A desktop browser arcade game built with TypeScript, Canvas 2D, and Vite. Rotate the hexagon to collect connected groups of three or more matching blocks. Clears collapse the stacks, quick successive clears build a combo, and overflowing the safe boundary ends the run.

An endless run is split into 55-second `FLOW`, `PRESSURE`, and `SURGE` cycles. Later cycles introduce announced anomalies, clears can award a replaceable one-slot bonus, and every completed cycle offers a choice between two run-only upgrades before play resumes.

## Controls

- `A` / `←`: rotate left by 60 degrees; move left between upgrade choices.
- `D` / `→`: rotate right by 60 degrees; move right between upgrade choices.
- `Escape` or the pause button: pause; `Escape` again or `RESUME`: continue.
- `Space`: activate the stored bonus; confirm the highlighted upgrade between cycles.
- `Enter` or an upgrade card: confirm an upgrade between cycles.
- `RESTART` / `RETRY`: begin a fresh run. `MENU`: return without reloading.
- `F`: technical fullscreen toggle for the browser test harness. In fullscreen, Escape belongs to the browser.

Hiding the tab pauses the game. The compact HUD shows score, combo, cycle phase, anomaly warnings, and the stored bonus without covering the playfield. Bonus tokens carry a distinct glyph in the field; collecting one raises an acquisition notice and sends that glyph toward the stable lower-right slot. The slot always names the stored bonus and shows `SPACE — ACTIVATE`. SLOW additionally displays its remaining six-second rule. With the system reduced-motion preference enabled, names, descriptions, glyphs, and controls remain readable while travel, assembly, fragments, shake, and long transitions are reduced to short fades.

## Development

Install dependencies:

```sh
npm install
```

Start the development server:

```sh
npm run dev
```

Run the test suite:

```sh
npm run test:run
```

Check TypeScript:

```sh
npm run typecheck
```

Create a production build:

```sh
npm run build
```

Serve the entire generated `dist/` directory with a static web server. The build includes `LICENSE`, `THIRD_PARTY_NOTICES.md`, `SOURCE.md`, and matching Corresponding Source in `source/`; keep these materials available alongside the game when hosting or redistributing it. Rebuild after modifying source so the application and its bundled source match. See [SOURCE.md](SOURCE.md) for rebuilding instructions. No application server, database, or external visual assets are required.

## Architecture

`GameEngine`, `HexGrid`, `MatchResolver`, and `WaveSpawner` implement deterministic rules without browser dependencies. `CycleDirector`, `BonusSystem`, and `UpgradeSystem` own endless-run pacing and progression. `InputController` queues keyboard commands. `GameRuntime` consumes them at a fixed 60 Hz, caps delayed real frames, pauses hidden tabs, and publishes immutable snapshots and events. `PresentationSystem` turns those events into bounded notices, slot attention, and bonus-transfer timing; `EffectsSystem` owns bounded world-space motion; `CanvasRenderer` draws both immutable snapshots. `ScreenController` owns the semantic HTML screens through one delegated event listener. `main.ts` composes the modules and resets session state, progression, presentation, effects, and timing together.

Browser QA uses `window.render_game_to_text()` for concise current state and `window.advanceTime(ms)` for deterministic stepping. Paused and upgrade-selection stepping leave player state unchanged. Restarting or returning to the menu clears every run-only bonus, upgrade, anomaly, and Last Stand charge; there is no stored score or account state.

## Attribution and license

Based in part on [the original Hextris](https://github.com/Hextris/hextris) by Logan Engstrom, Garrett Finucane, Noah Moroze, and Michael Yang. The remake adds a new TypeScript architecture and original graphite/matte visual treatment.

Distributed under **GPL-3.0-or-later**. See [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
