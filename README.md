# HEXTRIS remake

A desktop browser arcade game built with TypeScript, Canvas 2D, and Vite. Rotate the hexagon to collect connected groups of three or more matching blocks. Clears collapse the stacks, quick successive clears build a combo, and overflowing the safe boundary ends the run.

**Play online:** <https://miumilt.github.io/hextris-remake/> — the build is published by the GitHub Actions workflow in `.github/workflows/deploy.yml`; every push to `main` rebuilds `dist/` and redeploys it to GitHub Pages.

An endless run follows 75-second cycles: 20 seconds of `SETTLE`, 35 of `BUILD`, 15 of `PRESSURE`, and 5 of `RELEASE`. The opening 1.2 seconds assembles the field and previews the first arrival. Later cycles spend a bounded threat budget on authored patterns and announced anomalies; speed and arrival cadence approach soft ceilings while situations grow more complex. Every third completed cycle offers a choice between two run-only upgrades.

## Controls

- `A` / `←`: rotate left by 60 degrees; move left between upgrade choices.
- `D` / `→`: rotate right by 60 degrees; move right between upgrade choices.
- `Escape` or the pause button: pause; `Escape` again or `RESUME`: continue.
- `Space`: activate the stored bonus; confirm the highlighted upgrade between cycles.
- `Enter` or an upgrade card: confirm an upgrade between cycles.
- `RESTART` / `RETRY`: begin a fresh run. `MENU`: return without reloading.
- `F`: technical fullscreen toggle for the browser test harness. In fullscreen, Escape belongs to the browser.

Hiding the tab pauses the game. The compact HUD shows score, combo, cycle phase, anomaly warnings, and the stored bonus without covering the playfield. Anomalies give at least 2.5 seconds of warning at the hub; once an affected block appears, cues follow its actual route. Bonus tokens carry a distinct glyph in the field; collecting one raises an acquisition notice and sends that glyph toward the stable lower-right slot. A new bonus replaces the stored one automatically. The slot retains its full name, effect description, and `SPACE — ACTIVATE` hint until use or replacement. SLOW additionally displays its remaining six-second rule. With the system reduced-motion preference enabled, names, descriptions, glyphs, and controls remain readable while travel, assembly, fragments, shake, and long transitions are reduced to short fades.

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

`GameEngine`, `HexGrid`, `MatchResolver`, and `WaveSpawner` implement deterministic rules without browser dependencies. `ThreatDirector`, `BonusSystem`, and `UpgradeSystem` own endless-run pacing and progression. `InputController` queues keyboard commands. `GameRuntime` consumes them at a fixed 60 Hz, caps delayed real frames, pauses hidden tabs, and publishes immutable snapshots and events. `PresentationSystem` turns those events into bounded notices, slot attention, and bonus-transfer timing; `EffectsSystem` owns bounded world-space motion; `CanvasRenderer` draws both immutable snapshots. `ScreenController` owns the semantic HTML screens through one delegated event listener. `main.ts` composes the modules and resets session state, progression, presentation, effects, and timing together.

Browser QA uses `window.render_game_to_text()` for concise current state and `window.advanceTime(ms)` for deterministic stepping. With the dev server running at `http://127.0.0.1:5173/`, run `node test-artifacts/run-premium-arcade-qa.mjs` using an installed Microsoft Edge browser. It writes named screenshots, matching JSON, console entries, and a coverage report under `test-artifacts/premium-arcade-qa/`. The runner uses only public controls and records unreached states honestly. Paused and upgrade-selection stepping leave player state unchanged. Restarting or returning to the menu clears every run-only bonus, upgrade, anomaly, and Last Stand charge; there is no stored score, account state, or other permanent progression.

## Attribution and license

Based in part on [the original Hextris](https://github.com/Hextris/hextris) by Logan Engstrom, Garrett Finucane, Noah Moroze, and Michael Yang. The remake adds a new TypeScript architecture and original graphite/matte visual treatment.

Distributed under **GPL-3.0-or-later**. See [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
