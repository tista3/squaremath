# SquareMath

SquareMath is a colour-by-math web app for children. Draw a pixel picture on a grid of squares, and
SquareMath turns it into a puzzle sheet: every square gets a sum (+ − × ÷), and a legend says which
colour each answer stands for. Print the sheet, solve the sums, colour the squares, and the picture
appears.

It is a static React app with no server and no accounts. Designs stay in your browser, and you share
one by sending a link.

## Features

- **Gallery.** Your own designs plus built-in templates. Create, duplicate, rename and delete
  designs (delete can be undone). A template can be solved straight away without adding a copy;
  "Use" opens your unchanged copy if you already have one.
- **Editor.** Pencil, eraser, fill and colour picker, with undo/redo, zoom and grid sizes from 4×4
  to 40×40. Works with mouse, pen and touch.
- **Named colours.** Printed sheets are black and white, so every palette colour has an English
  name. It is suggested from the colour and you can edit it ("Red", "Sky blue", "Grandma's sofa").
- **Puzzles.** Choose addition, subtraction, multiplication, division or any mix. Set the number
  limits and choose between a legend of ranges ("Red 1–10") and a legend of exact values
  ("Red 3, 7, 12"). Press the dice for a new set of sums. The generator spreads the operations over
  all colours and avoids repeating sums; for extreme settings (tiny limits, many colours) the Puzzle
  page explains what makes the sheet dull or easy to guess and offers a one-tap fix.
- **Print, PDF and PNG.** A puzzle sheet without colours, plus the legend (in number order, with
  colours that share a name numbered "Blue (1)", "Blue (2)") and an optional solution page, on A4 or
  Letter. Big grids are split over up to 3×3 pages, with row and column numbers, so every square stays
  at least 7 mm wide. The PDF is vector (sharp text at any zoom); the sheet PNG is one image with all
  pages stacked. There is also a PNG of the coloured picture.
- **Solve on screen.** Tap a colour, then tap squares to fill them, or use the keyboard (arrows,
  Space, 1–9). Progress is saved, and finishing the picture brings a celebration with print and share.
- **Share by link.** The whole design is compressed into the URL (`#/s/<payload>`). Anyone who opens
  the link can preview, solve or print it, or save it to their own designs.
- **Backup.** Export the whole library, or a single design, to a JSON file and import it again.
  Importing adds new designs, updates designs that have a newer version in the file and skips the
  rest. Designs are saved in a compact format and stay in sync across open tabs.
- **Language-agnostic UI.** Mostly icons and maths symbols. All text goes through a small i18n
  layer. Colour names are data, so they are never translated.

## Local development

You need Node.js 22 or newer.

```bash
npm install
npm run dev        # dev server at http://localhost:5173
npm test           # Vitest (jsdom)
npm run typecheck  # tsc -b
npm run build      # typecheck + production build into dist/
npm run preview    # serve dist/ at http://localhost:4173
```

## Testing

- `npm test` runs the unit and integration tests (Vitest with jsdom).
- `e2e/smoke.mjs` is a real-browser smoke test of the whole child journey on a desktop and a phone
  viewport: gallery → template → draw → puzzle settings (× ÷) → PDF download → solve to the end →
  celebration → share link in a fresh browser → save a copy, plus library export → wipe → import. It
  uses [playwright-core](https://www.npmjs.com/package/playwright-core) (not a project dependency)
  with an installed Chrome or Edge, and fails on any console error.

  ```bash
  npm run build
  npx vite preview --port 4320 --strictPort      # in another terminal
  npx -y -p playwright-core node e2e/smoke.mjs   # or: npm i --no-save playwright-core && node e2e/smoke.mjs
  ```

  Options (environment variables): `CHROME_PATH` (browser executable; by default the usual Chrome
  install path for Windows, macOS or Linux), `BASE_URL` (default `http://localhost:4320/`) and
  `OUT_DIR` (screenshots and downloads, default `e2e/out/`).

## Deploying to GitHub Pages

The repository includes `.github/workflows/deploy.yml`. On every push to `main`, and on a manual
run, it installs dependencies, runs the tests, builds and publishes `dist/` to GitHub Pages.

1. Push the project to a GitHub repository with `main` as the default branch.
2. In the repository, open **Settings → Pages → Build and deployment** and set **Source** to
   **GitHub Actions**.
3. Push to `main`, or run the workflow from the **Actions** tab. The site is published at
   `https://<user>.github.io/<repo>/`.

The app uses a hash router and relative asset paths (`base: './'` in `vite.config.ts`), so it works
under any repository name and does not need a 404 fallback page.

## Project structure

```
src/
  core/            Pure logic with no React
    types.ts         Data model, limits and defaults (the shared contract)
    design.ts        Create, normalise, resize and copy designs
    grid.ts          Line rasteriser, grid size presets and clamping
    colors.ts        Colour naming (CIEDE2000 nearest crayon), hex helpers
    puzzle.ts        Puzzle generator: expressions, legend and quality warnings
    rng.ts           Seeded random numbers
    codec.ts         Share-link encoding (lz-string)
    lz.ts            Bounded share-link decompressor (rejects decompression bombs)
    fileio.ts        Library export/import (JSON) and compact storage format
    samples.ts       Built-in templates
  state/
    store.tsx        Design library as a React hook (useSyncExternalStore over LibrarySync)
    library.ts       Pure library operations: merge, import, tombstones
    librarySync.ts   localStorage sync: compact v2 format under 'squaremath.designs.v2' (migrated
                     from v1), cross-tab merge with tombstones, backups of unreadable data
    progress.ts      On-screen solving progress (localStorage)
  render/
    sheet.ts         Printable SVG sheets (puzzle pages, split when big, and solution) and the picture SVG
    legendOrder.ts   Key order (by number) and numbering of duplicate colour names
    textMetrics.ts   Helvetica/Arial glyph widths for laying out text without a DOM
  export/
    index.ts         Print, PDF (jsPDF, loaded on demand) and PNG downloads
    pdf.ts           SVG-to-jsPDF vector renderer for the sheet (raster fallback per page)
  components/      Icon set and shared UI (buttons, dialogs, toasts, share dialog)
  pages/           Gallery, Editor, Puzzle, Solve and Shared pages, plus their helpers
  i18n/            t()/useT() and the English dictionaries (src/i18n/en/<namespace>.ts)
  styles/global.css  Design tokens and global classes
  routes.ts        Route map
  App.tsx          Router, providers and route wrappers
```

Routes (hash based):

| Route                | Page                                            |
| -------------------- | ----------------------------------------------- |
| `#/`                 | Gallery                                         |
| `#/d/<id>/edit`      | Editor                                          |
| `#/d/<id>/puzzle`    | Puzzle settings, preview, print/PDF/PNG         |
| `#/d/<id>/solve`     | Solve on screen                                 |
| `#/s/<payload>`      | Shared design landing page                      |
| `#/s/<payload>/puzzle` and `/solve` | Read-only puzzle and solve for a shared design (also used for "Solve" on a template) |

## Adding a UI language

UI text lives in one dictionary per namespace in `src/i18n/en/` (`common`, `gallery`, `editor`,
`puzzle`, `solve`, `shared`). Keys are used as `t('<namespace>.<key>')`, and placeholders look like
`{name}`. For counts, pass `{ count }` and add plural variants named after the
`Intl.PluralRules` categories, for example `boxes_one: '{count} box'` and
`boxes_other: '{count} boxes'`; `t('editor.boxes', { count })` picks the right one and falls back to
`_other`, then to the plain key.

1. Copy `src/i18n/en/` to `src/i18n/<lang>/`, for example `src/i18n/de/`, and translate the values.
   Keep the keys unchanged. Any key you leave out falls back to English.
2. In `src/i18n/index.ts`, import the new dictionaries and add an entry to `LANGS`:

   ```ts
   import deCommon from './de/common';
   // ...
   const LANGS = {
     en: flatten({ common, gallery, editor, puzzle, solve, shared }),
     de: flatten({ common: deCommon, gallery: deGallery, /* ... */ }),
   };
   ```

3. That's it. At startup, `applyBrowserLanguage()` in `src/main.tsx` picks the first browser
   language that has a dictionary, and falls back to English.

Colour names are part of each design, not of the UI. They default to English and users can rename
them, so they are not translated.
