import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset paths keep the build working both at a domain root and
  // under a GitHub Pages project subpath (https://<user>.github.io/<repo>/).
  base: './',
});
