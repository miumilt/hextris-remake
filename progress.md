Original prompt: сделать веб-ремейк Hextris на основе оригинального кода, улучшить анимации и сделать красивое минимальное меню без шаблонного AI-интерфейса.

Design: docs/superpowers/specs/2026-09-04-hextris-remake-design.md
Plan: docs/superpowers/plans/2026-09-04-hextris-remake.md
Current status: project foundation created.
HexGrid implemented and verified.
Match resolution and chain collapse verified.
Seeded wave patterns and difficulty caps verified.
Core game loop, score, combo, pause, and game over verified.
Keyboard, lifecycle, fixed-step loop, and automation hooks verified.
Task 6: Runtime accepts render(alpha), onEvents(events), onStep(ms), and onResize(width, height, dpr) callbacks. Call resetTiming() with engine session resets. Main composes the menu-state engine/input/runtime and disposes listeners/RAF on Vite HMR.
Task 6 verification: 37 tests passed; typecheck and build passed. Supplied browser client ran with bundled Playwright and installed Edge; menu JSON, hooks, DPR canvas sizing, and blank pre-renderer shell verified. Existing /favicon.ico 404 remains for Task 9 index polish. Renderer/gameplay visual QA awaits Tasks 7–9.
Task 6 controller follow-up: F toggles fullscreen both ways; Escape remains browser-owned while fullscreen. Added exit/rejection regression test with observed red, then green.
Geometry and bounded visual effects model verified.
