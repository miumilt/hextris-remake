# HEXTRIS remake

A desktop browser arcade game built with TypeScript, Canvas 2D, and Vite. Rotate the hexagon to collect connected groups of three or more matching blocks. Clears collapse the stacks, quick successive clears build a combo, and overflowing the safe boundary ends the run.

## Controls

- `A` / `←`: rotate left by 60 degrees.
- `D` / `→`: rotate right by 60 degrees.
- `Escape` or the pause button: pause; `Escape` again or `RESUME`: continue.
- `RESTART` / `RETRY`: begin a fresh run. `MENU`: return without reloading.
- `F`: technical fullscreen toggle for the browser test harness. In fullscreen, Escape belongs to the browser.

Hiding the tab pauses the game. Only the current score and pause control stay on screen during play. Screen transitions respect the system reduced-motion preference.

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

`GameEngine`, `HexGrid`, `MatchResolver`, and `WaveSpawner` implement deterministic rules without browser dependencies. `InputController` queues keyboard commands. `GameRuntime` consumes them at a fixed 60 Hz, caps delayed real frames, pauses hidden tabs, and publishes immutable snapshots and events. `CanvasRenderer` and `EffectsSystem` turn those into independent visual motion. `ScreenController` owns four semantic HTML screens through one delegated event listener. `main.ts` composes the modules and resets session state, effects, and timing together.

Browser QA uses `window.render_game_to_text()` for concise current state and `window.advanceTime(ms)` for deterministic stepping. Paused stepping leaves player state unchanged. The seeded generator makes a restarted run reproducible; there is no stored score or account state.

## Attribution and license

Based in part on [the original Hextris](https://github.com/Hextris/hextris) by Logan Engstrom, Garrett Finucane, Noah Moroze, and Michael Yang. The remake adds a new TypeScript architecture and original graphite/matte visual treatment.

Distributed under **GPL-3.0-or-later**. See [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
