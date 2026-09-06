# Corresponding Source

This HEXTRIS remake is distributed under GPL-3.0-or-later. The `source/`
directory beside this notice in the production distribution contains the
Corresponding Source matching this build, including application source,
dependency manifest and lockfile, tests, configuration, and build scripts.
The build copies these files directly from the same project used by Vite.

To rebuild, enter the bundled `source/` directory (or the project root when
reading this copy inside the source tree). With Node.js 22.12 or later and
npm available, run:

```sh
npm install
npm run build
```

The resulting `dist/` contains the game, license, notices, and another
matching source package. Dependency installation requires access to the npm
registry. Dependencies themselves are not bundled in `source/`.
Run `npm run test:run` to execute the included tests.

When redistributing or hosting the game, keep the entire generated `dist/`
directory together, including this notice, `LICENSE`,
`THIRD_PARTY_NOTICES.md`, and `source/`. Rebuild after changing source files
so the distributed application and source stay in sync.
