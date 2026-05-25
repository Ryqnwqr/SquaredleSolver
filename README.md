# Squaredle Solver

Interactive web app that finds all valid words on a Squaredle-style letter grid.

## Features

- Upload a puzzle screenshot — intelligent grid detection then per-cell OCR
- **Squaredle (NWL2023)** word list — same official lexicon as the game (filters out obscure words like random proper nouns)
- Optional **All English words** mode for exploration
- Auto-detects grid size and shape: 4×4, 5×5, corner-cut layouts
- Finds words of 4+ letters using 8-direction adjacency without reusing cells
- Click a word to highlight its path on the grid

## Run locally

```bash
npm install
npm run dev
```

Open the URL shown in the terminal (usually http://localhost:5173).

## Build

```bash
npm run build
npm run preview
```

The build downloads and compiles the NWL2023 word list into `public/nwl2023.json`. To refresh it alone:

```bash
npm run build:nwl
```

## Notes

- **Squaredle (NWL2023)** uses the NASPA tournament list (195k+ words, 4+ letters). Words like *dolina* that appear in generic dictionaries are not included.
- Each daily puzzle also marks some NWL words as “bonus” only; this app cannot know that per-puzzle split without game data.
- Switch to **All English words** if you want every possible path on the grid.
