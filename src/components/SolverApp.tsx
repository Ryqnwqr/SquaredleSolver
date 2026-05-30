"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CustomSelect } from "./CustomSelect";
import { FormatToast } from "./FormatToast";
import { LetterGrid } from "./LetterGrid";
import { WordResults } from "./WordResults";
import {
  clipboardHasTextOnly,
  dragEventHasImage,
  getClipboardImageFile,
  getDataTransferImageFile,
  isTextInputTarget,
} from "@/lib/clipboardPaste";
import {
  DICTIONARY_LABELS,
  loadDictionary,
  type DictionaryMode,
} from "@/lib/dictionary";
import { BLOCKED, NotAPuzzleError } from "@/lib/gridDetect";
import { normalizeOcrToLetter } from "@/lib/letterNormalize";
import { extractGridFromImage, type OcrProgress } from "@/lib/ocr";
import { type DictionarySource } from "@/lib/dictionaryLookup";
import {
  findAllWords,
  isPlayableCell,
  normalizeGrid,
  type FoundWord,
} from "@/lib/solver";
import type { Trie } from "@/lib/trie";

const AUTO_SIZE = 0;

function emptyGrid(rows: number, cols: number): string[][] {
  return Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => "?")
  );
}

export function SolverApp() {
  const [dictMode, setDictMode] = useState<DictionaryMode>("nwl2023");
  const [dictReady, setDictReady] = useState(false);
  const [dictLoading, setDictLoading] = useState(true);
  const [trie, setTrie] = useState<Trie | null>(null);
  const [sizeHint, setSizeHint] = useState(AUTO_SIZE);
  const [autoGridReady, setAutoGridReady] = useState(false);
  const [grid, setGrid] = useState<string[][]>([]);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [ocrProgress, setOcrProgress] = useState<OcrProgress | null>(null);
  const [detectionInfo, setDetectionInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [words, setWords] = useState<FoundWord[]>([]);
  const [selectedWord, setSelectedWord] = useState<FoundWord | null>(null);
  const [filter, setFilter] = useState("");
  const [definitionSource, setDefinitionSource] =
    useState<DictionarySource>("freeDictionary");
  const [error, setError] = useState<string | null>(null);
  const [formatToast, setFormatToast] = useState(false);
  const [uploadDragOver, setUploadDragOver] = useState(false);
  const uploadDragDepthRef = useRef(0);
  const handleImageUploadRef = useRef<(file: File) => void>(() => {});

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
      if (hint > 0) {
        setAutoGridReady(true);
        resizeGrid(hint, hint);
      } else {
        setAutoGridReady(false);
        setGrid([]);
        setWords([]);
        setSelectedWord(null);
        setDetectionInfo(null);
      }
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
        const {
          grid: extracted,
          detection,
          croppedPreview,
        } = await extractGridFromImage(src, hint, setOcrProgress);
        setImagePreview(croppedPreview);
        const normalized = normalizeGrid(extracted);
        setGrid(normalized);
        setAutoGridReady(true);
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
      } catch (err) {
        if (err instanceof NotAPuzzleError) {
          setError(
            "This doesn't look like a Squaredle puzzle. Upload or paste a screenshot of the puzzle grid."
          );
        } else {
          setError(
            "Could not read the image. Try another screenshot or edit the grid manually."
          );
        }
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

  handleImageUploadRef.current = (file: File) => {
    void handleImageUpload(file);
  };

  const dismissFormatToast = useCallback(() => setFormatToast(false), []);

  const onUploadDragEnter = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (busy || !dictReady) return;
      if (!dragEventHasImage(e.dataTransfer)) return;
      uploadDragDepthRef.current += 1;
      setUploadDragOver(true);
    },
    [busy, dictReady]
  );

  const onUploadDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    uploadDragDepthRef.current -= 1;
    if (uploadDragDepthRef.current <= 0) {
      uploadDragDepthRef.current = 0;
      setUploadDragOver(false);
    }
  }, []);

  const onUploadDragOver = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (busy || !dictReady) return;
      if (dragEventHasImage(e.dataTransfer)) {
        e.dataTransfer.dropEffect = "copy";
      } else {
        e.dataTransfer.dropEffect = "none";
      }
    },
    [busy, dictReady]
  );

  const onUploadDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      uploadDragDepthRef.current = 0;
      setUploadDragOver(false);
      if (busy || !dictReady) return;
      const file = getDataTransferImageFile(e.dataTransfer);
      if (file) {
        handleImageUploadRef.current(file);
      } else {
        setFormatToast(true);
      }
    },
    [busy, dictReady]
  );

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const data = e.clipboardData;
      const imageFile = getClipboardImageFile(data);

      if (imageFile) {
        e.preventDefault();
        if (!dictReady || busy) return;
        handleImageUploadRef.current(imageFile);
        return;
      }

      if (clipboardHasTextOnly(data) && !isTextInputTarget(e.target)) {
        e.preventDefault();
        setFormatToast(true);
      }
    };

    document.addEventListener("paste", onPaste, true);
    return () => document.removeEventListener("paste", onPaste, true);
  }, [dictReady, busy]);

  const rows = grid.length;
  const cols = grid[0]?.length ?? 0;
  const pendingAutoGrid = sizeHint === AUTO_SIZE && !autoGridReady;

  const progressLabel =
    busy && ocrProgress
      ? ocrProgress.stage === "analyzing"
        ? (ocrProgress.detail ?? "Analyzing grid…")
        : ocrProgress.stage === "loading"
          ? "Loading OCR…"
          : (ocrProgress.detail ??
            `Scanning ${ocrProgress.current} / ${ocrProgress.total}`)
      : "Upload puzzle screenshot";

  return (
    <div className="app">
      <FormatToast visible={formatToast} onDismiss={dismissFormatToast} />
      <header className="header">
        <div className="header-brand">
          <div className="header-copy">
            <p className="eyebrow">Word search assistant</p>
            <h1 className="header-title">Squaredle Solver</h1>
            <p className="subtitle">
              Upload a screenshot — the app detects grid shape automatically
              (4×4, 5×5, corner-cut layouts, and more). Fix any misread letters,
              then find all valid words.
            </p>
          </div>
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
            <CustomSelect
              value={dictMode}
              onChange={setDictMode}
              disabled={busy || dictLoading}
              options={(Object.keys(DICTIONARY_LABELS) as DictionaryMode[]).map(
                (mode) => ({ value: mode, label: DICTIONARY_LABELS[mode] })
              )}
            />
          </label>

          <label className="field">
            <span>Grid size hint</span>
            <CustomSelect
              value={String(sizeHint)}
              onChange={(v) => applySizeHint(Number(v))}
              disabled={busy}
              options={[
                { value: String(AUTO_SIZE), label: "Auto-detect from image" },
                ...[3, 4, 5, 6, 7].map((n) => ({
                  value: String(n),
                  label: `${n}×${n} (square)`,
                })),
              ]}
            />
          </label>

          <label
            className={`upload-zone${uploadDragOver ? " upload-zone--dragover" : ""}`}
            onDragEnter={onUploadDragEnter}
            onDragLeave={onUploadDragLeave}
            onDragOver={onUploadDragOver}
            onDrop={onUploadDrop}
          >
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
            <span className="upload-label">
              {uploadDragOver ? "Release to upload" : progressLabel}
            </span>
            <span className="upload-hint">
              {uploadDragOver
                ? "Drop your puzzle screenshot here"
                : "Drag and drop, click to browse, or paste with Ctrl+V / ⌘V · supports corner-cut and irregular grids"}
            </span>
          </label>

          {detectionInfo && (
            <p className="detection-info">{detectionInfo}</p>
          )}

          {error && <p className="error">{error}</p>}

          <div className="grid-block">
            <div className="grid-block-header">
              <h3>
                {pendingAutoGrid
                  ? "Letter grid"
                  : `Letter grid (${rows}×${cols})`}
              </h3>
              <button
                type="button"
                className="btn secondary"
                onClick={() => {
                  if (pendingAutoGrid) return;
                  if (sizeHint === AUTO_SIZE) {
                    setAutoGridReady(false);
                    setGrid([]);
                    setWords([]);
                    setSelectedWord(null);
                    setDetectionInfo(null);
                  } else {
                    setGrid(emptyGrid(rows, cols));
                    setWords([]);
                    setSelectedWord(null);
                  }
                }}
                disabled={busy || pendingAutoGrid}
              >
                Clear
              </button>
            </div>
            {imagePreview && !pendingAutoGrid && (
              <figure
                className="preview preview--reference"
                aria-label="Cropped source image — reference for the editable grid"
              >
                <figcaption>Source image (for reference)</figcaption>
                <img src={imagePreview} alt="Detected puzzle grid" />
              </figure>
            )}
            {pendingAutoGrid ? (
              <div className="grid-pending" aria-live="polite">
                <span className="grid-pending__icon" aria-hidden>
                  <svg
                    viewBox="0 0 32 32"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <rect
                      x="4"
                      y="4"
                      width="11"
                      height="11"
                      rx="2.5"
                      stroke="currentColor"
                      strokeWidth="1.5"
                    />
                    <rect
                      x="17"
                      y="4"
                      width="11"
                      height="11"
                      rx="2.5"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeDasharray="3 2"
                      opacity="0.5"
                    />
                    <rect
                      x="4"
                      y="17"
                      width="11"
                      height="11"
                      rx="2.5"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeDasharray="3 2"
                      opacity="0.5"
                    />
                    <rect
                      x="17"
                      y="17"
                      width="11"
                      height="11"
                      rx="2.5"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeDasharray="3 2"
                      opacity="0.5"
                    />
                  </svg>
                </span>
                <p className="grid-pending__title">
                  {busy ? "Detecting grid…" : "Pending detection"}
                </p>
                <p className="grid-pending__hint">
                  {busy
                    ? "Reading letters from your screenshot."
                    : "Upload or paste a puzzle image to detect size and letters automatically."}
                </p>
              </div>
            ) : (
              <LetterGrid
                grid={grid}
                highlightPath={selectedWord?.path}
                editable
                onCellChange={handleCellChange}
              />
            )}
          </div>

          <button
            type="button"
            className="btn primary"
            onClick={runSolver}
            disabled={!dictReady || busy || pendingAutoGrid}
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
            definitionSource={definitionSource}
            onDefinitionSourceChange={setDefinitionSource}
            loading={dictLoading || (busy && words.length === 0)}
          />
        </section>
      </main>
    </div>
  );
}
