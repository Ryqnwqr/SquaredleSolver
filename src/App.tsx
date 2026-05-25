import { useCallback, useEffect, useState } from "react";
import { LetterGrid } from "./components/LetterGrid";
import { WordResults } from "./components/WordResults";
import {
  DICTIONARY_LABELS,
  loadDictionary,
  type DictionaryMode,
} from "./lib/dictionary";
import { BLOCKED } from "./lib/gridDetect";
import { normalizeOcrToLetter } from "./lib/letterNormalize";
import { extractGridFromImage, type OcrProgress } from "./lib/ocr";
import {
  findAllWords,
  isPlayableCell,
  normalizeGrid,
  type FoundWord,
} from "./lib/solver";
import type { Trie } from "./lib/trie";
import "./App.css";

const AUTO_SIZE = 0;
const DEFAULT_SIZE = 4;

function emptyGrid(rows: number, cols: number): string[][] {
  return Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => "?")
  );
}

export default function App() {
  const [dictMode, setDictMode] = useState<DictionaryMode>("nwl2023");
  const [dictReady, setDictReady] = useState(false);
  const [dictLoading, setDictLoading] = useState(true);
  const [trie, setTrie] = useState<Trie | null>(null);
  const [sizeHint, setSizeHint] = useState(AUTO_SIZE);
  const [grid, setGrid] = useState<string[][]>(() =>
    emptyGrid(DEFAULT_SIZE, DEFAULT_SIZE)
  );
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [ocrProgress, setOcrProgress] = useState<OcrProgress | null>(null);
  const [detectionInfo, setDetectionInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [words, setWords] = useState<FoundWord[]>([]);
  const [selectedWord, setSelectedWord] = useState<FoundWord | null>(null);
  const [filter, setFilter] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDictLoading(true);
    setDictReady(false);
    loadDictionary(dictMode)
      .then((t) => {
        setTrie(t);
        setDictReady(true);
      })
      .catch(() => {
        setError("Failed to load word list. Refresh the page to try again.");
      })
      .finally(() => setDictLoading(false));
  }, [dictMode]);

  useEffect(() => {
    if (!trie || !dictReady) return;
    const normalized = normalizeGrid(grid);
    if (normalized.some((row) => row.some(isPlayableCell))) {
      setWords(findAllWords(normalized, trie.getRoot()));
      setSelectedWord(null);
    }
  }, [trie, dictReady, dictMode]);

  const resizeGrid = useCallback((rows: number, cols: number) => {
    setGrid((prev) => {
      const next = emptyGrid(rows, cols);
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (prev[r]?.[c]) next[r][c] = prev[r][c];
        }
      }
      return next;
    });
    setWords([]);
    setSelectedWord(null);
    setDetectionInfo(null);
  }, []);

  const applySizeHint = useCallback(
    (hint: number) => {
      setSizeHint(hint);
      if (hint > 0) resizeGrid(hint, hint);
    },
    [resizeGrid]
  );

  const handleCellChange = useCallback(
    (row: number, col: number, value: string) => {
      if (grid[row][col] === BLOCKED) return;
      const letter = normalizeOcrToLetter(value) || "?";
      setGrid((prev) => {
        const next = prev.map((r) => [...r]);
        next[row][col] = letter;
        return next;
      });
    },
    [grid]
  );

  const runSolver = useCallback(() => {
    if (!trie) return;
    const normalized = normalizeGrid(grid);
    const hasLetters = normalized.some((row) =>
      row.some((c) => isPlayableCell(c))
    );
    if (!hasLetters) {
      setError("Add letters to the grid before solving.");
      setWords([]);
      return;
    }
    setError(null);
    const found = findAllWords(normalized, trie.getRoot());
    setWords(found);
    setSelectedWord(null);
  }, [grid, trie]);

  const handleImageUpload = async (file: File) => {
    setError(null);
    setBusy(true);
    setDetectionInfo(null);
    setOcrProgress({ stage: "analyzing", current: 0, total: 1 });

    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const src = reader.result as string;
        setImagePreview(src);
        const hint = sizeHint > 0 ? sizeHint : undefined;
        const { grid: extracted, detection } = await extractGridFromImage(
          src,
          hint,
          setOcrProgress
        );
        const normalized = normalizeGrid(extracted);
        setGrid(normalized);
        setOcrProgress(null);

        const active = normalized.flat().filter(isPlayableCell).length;
        const blocked = normalized.flat().filter((c) => c === BLOCKED).length;
        setDetectionInfo(
          `Detected ${detection.rows}×${detection.cols} (${active} tiles${blocked ? `, ${blocked} empty` : ""}) · ${Math.round(detection.confidence * 100)}% confidence · ${detection.method}`
        );

        if (trie && normalized.some((row) => row.some(isPlayableCell))) {
          setWords(findAllWords(normalized, trie.getRoot()));
          setSelectedWord(null);
        }
      } catch {
        setError(
          "Could not read the image. Try another screenshot or edit the grid manually."
        );
        setOcrProgress(null);
      } finally {
        setBusy(false);
      }
    };
    reader.onerror = () => {
      setError("Failed to load the file.");
      setBusy(false);
      setOcrProgress(null);
    };
    reader.readAsDataURL(file);
  };

  const rows = grid.length;
  const cols = grid[0]?.length ?? 0;

  const progressLabel =
    busy && ocrProgress
      ? ocrProgress.stage === "analyzing"
        ? ocrProgress.detail ?? "Analyzing grid…"
        : ocrProgress.stage === "loading"
          ? "Loading OCR…"
          : ocrProgress.detail ??
            `Scanning ${ocrProgress.current} / ${ocrProgress.total}`
      : "Upload puzzle screenshot";

  return (
    <div className="app">
      <header className="header">
        <div>
          <p className="eyebrow">Word search assistant</p>
          <h1>Squaredle Solver</h1>
          <p className="subtitle">
            Upload a screenshot — the app detects grid shape automatically
            (4×4, 5×5, corner-cut layouts, and more). Fix any misread letters,
            then find all valid words.
          </p>
        </div>
        {dictLoading && (
          <span className="badge loading">Loading dictionary…</span>
        )}
        {dictReady && !busy && !dictLoading && (
          <span className="badge ready">{DICTIONARY_LABELS[dictMode]}</span>
        )}
      </header>

      <main className="layout">
        <section className="panel controls-panel">
          <h2>Grid setup</h2>

          <label className="field">
            <span>Word list</span>
            <select
              value={dictMode}
              onChange={(e) => setDictMode(e.target.value as DictionaryMode)}
              disabled={busy || dictLoading}
            >
              {(Object.keys(DICTIONARY_LABELS) as DictionaryMode[]).map(
                (mode) => (
                  <option key={mode} value={mode}>
                    {DICTIONARY_LABELS[mode]}
                  </option>
                )
              )}
            </select>
          </label>

          <label className="field">
            <span>Grid size hint</span>
            <select
              value={sizeHint}
              onChange={(e) => applySizeHint(Number(e.target.value))}
              disabled={busy}
            >
              <option value={AUTO_SIZE}>Auto-detect from image</option>
              {[3, 4, 5, 6, 7].map((n) => (
                <option key={n} value={n}>
                  {n}×{n} (square)
                </option>
              ))}
            </select>
          </label>

          <label className="upload-zone">
            <input
              type="file"
              accept="image/*"
              disabled={busy || !dictReady}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleImageUpload(file);
                e.target.value = "";
              }}
            />
            <span className="upload-label">{progressLabel}</span>
            <span className="upload-hint">
              Works with plain grids, 5×5 corner-cut, and irregular shapes
            </span>
          </label>

          {detectionInfo && (
            <p className="detection-info">{detectionInfo}</p>
          )}

          {imagePreview && (
            <figure className="preview">
              <img src={imagePreview} alt="Uploaded puzzle" />
            </figure>
          )}

          {error && <p className="error">{error}</p>}

          <div className="grid-block">
            <div className="grid-block-header">
              <h3>
                Letter grid {rows > 0 && cols > 0 ? `(${rows}×${cols})` : ""}
              </h3>
              <button
                type="button"
                className="btn secondary"
                onClick={() =>
                  setGrid(emptyGrid(rows || DEFAULT_SIZE, cols || DEFAULT_SIZE))
                }
                disabled={busy}
              >
                Clear
              </button>
            </div>
            <LetterGrid
              grid={grid}
              highlightPath={selectedWord?.path}
              editable
              onCellChange={handleCellChange}
            />
          </div>

          <button
            type="button"
            className="btn primary"
            onClick={runSolver}
            disabled={!dictReady || busy}
          >
            Find words
          </button>

          <p className="note">
            {dictMode === "nwl2023"
              ? "Uses the NWL2023 lexicon (same source as Squaredle). Obscure words like proper nouns are excluded. Some NWL words may still count only as bonus in-game."
              : "Shows every English word on the grid — includes many words Squaredle does not accept."}
          </p>
        </section>

        <section className="panel results-panel">
          <WordResults
            words={words}
            selectedWord={selectedWord}
            onSelect={setSelectedWord}
            filter={filter}
            onFilterChange={setFilter}
          />
        </section>
      </main>
    </div>
  );
}
