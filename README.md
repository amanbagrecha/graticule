# Graticule

An instrument for seeing how the Earth becomes a map. Seven tracks, 58 short lessons. Each lesson has one idea, one picture and a few controls.

## Open it

Open the app folder in fused-render and select `index.html`. The page opens the first lesson. The URL holds the lesson id and every control that differs from its default, so you can bookmark and share any view.

Deep link: `?l=<lesson-id>&<control>=<value>`. Example: `?l=cone-unroll&lat0=30&m=1`.

## Folder layout

- `index.html` – the only page. It builds the import map from `modules.json` and starts the shell.
- `modules.json` – module list. Run `node dev/manifest.mjs` after you add a `.js` file.
- `styles/` – `tokens.css` (design tokens) and `shell.css` (layout and components).
- `assets/` – `icons.svg` sprite and `logo.svg` mark.
- `fonts/` – Inter Variable and JetBrains Mono, with their licence files.
- `core/` – shared modules. `shell.js` builds the UI. `stage.js` owns the canvases. `ui.js` builds controls. `registry.js` lists the lessons.
- `lessons/` – one file per lesson.
- `data/` – grids, coastlines and images. The page loads them through `core/env.js`.
- `vendor/` – three.js, d3, h3-js, proj4 and GeographicLib as ES modules.
- `dev/manifest.mjs` – rebuilds `modules.json`.

## Rules

- No build step and no runtime network.
- Imports use bare specifiers such as `@/core/globe.js`. Relative imports do not work.
- UI text is short and simple.
