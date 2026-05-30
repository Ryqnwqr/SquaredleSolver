# Vite → Next.js migration

## What moved

| Before (Vite) | After (Next.js) |
|---------------|-----------------|
| `index.html` + `src/main.tsx` | `app/layout.tsx` (HTML shell, fonts, favicon metadata) |
| `src/App.tsx` | `src/components/SolverApp.tsx` (`"use client"`) |
| `src/App.css` | Imported from `app/layout.tsx` (global styles) |
| `vite.config.ts` | `next.config.ts` |
| Dev server port `5173` | `3000` (default) |
| Playwright imports `/src/lib/*.ts` in-browser | `/test-harness` exposes `window.__SS_TEST__` |

Unchanged on purpose:

- `src/lib/*` — grid detection, OCR, solver, dictionary
- `src/components/*` — UI pieces (pulled in via `SolverApp`)
- `public/favicon.svg`, `public/nwl2023.json` (built by `build:nwl`)
- `scripts/build-nwl-list.mjs`, `test-fixtures/`

Removed after parity: `vite`, `@vitejs/plugin-react`, `index.html`, `src/main.tsx`, `vite.config.ts`, `tsconfig.node.json`.

## Environment variables

None required for local dev or production. The app is fully client-side for puzzle processing; dictionaries load from `/nwl2023.json` and the `an-array-of-english-words` package.

If you add auth or APIs later, use `.env.local` and document them in a new `.env.example`.

## Commands

```bash
npm install
npm run dev          # http://localhost:3000
npm run build        # builds NWL list, then `next build`
npm run start        # production server (after build)
npm run preview      # alias for `next start`
npm run build:nwl    # refresh public/nwl2023.json only
```

### Integration tests (need dev server)

In one terminal:

```bash
npm run dev
```

In another:

```bash
npm run test:grid              # default fixture dark4x4
node scripts/test-grid-detect.mjs all
npm run test:ocr               # default fixture light
TEST_FIXTURE=dark2 npm run test:ocr
```

Override URL if needed:

```bash
TEST_URL=http://127.0.0.1:3000/test-harness npm run test:grid
```

Tests load `/test-harness`, which registers `window.__SS_TEST__` with the same modules the app uses.

## Deploy (Vercel)

`vercel.json` only sets `buildCommand: npm run build`. Vercel detects Next.js automatically; SPA rewrites are no longer used.

## Path alias

`@/*` → `src/*` (see `tsconfig.json`).
