import type { Worker } from "tesseract.js";
import { BLOCKED, detectGridLayout, type CellRegion, type GridDetection } from "./gridDetect";
import type { FrameTheme } from "./imageProcessing";
import { normalizeOcrToLetter } from "./letterNormalize";
import {
  analyzeShape,
  canvasFromDataUrl,
  classifyLetterFromCanvas,
  resolveLetter,
  scoreB,
  scoreE,
  scoreI,
  resolveDarkAmbiguousO,
  resolveDarkAmbiguousR,
  scoreP,
  scoreR,
  TESSERACT_CONFIDENT_VOTE,
  voteTotal,
  type ShapeMetrics,
} from "./shapeClassify";

let workerPromise: Promise<Worker> | null = null;

async function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker, PSM } = await import("tesseract.js");
      const worker = await createWorker("eng");
      await worker.setParameters({
        tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
        tessedit_pageseg_mode: PSM.SINGLE_CHAR,
        load_system_dawg: "0",
        load_freq_dawg: "0",
        load_unambig_dawg: "0",
        load_punc_dawg: "0",
        load_number_dawg: "0",
        load_bigram_dawg: "0",
        tessedit_enable_dict_correction: "0",
        tessedit_enable_bigram_correction: "0",
      });
      return worker;
    })();
  }
  return workerPromise;
}

/** Mask Squaredle hint counts in tile corners */
function maskCornerHints(
  ctx: CanvasRenderingContext2D,
  size: number,
  color = "#ffffff"
): void {
  const h = Math.floor(size * 0.24);
  const w = Math.floor(size * 0.22);
  ctx.fillStyle = color;
  ctx.fillRect(0, size - h, w, h);
  ctx.fillRect(size - w, size - h, w, h);
  ctx.fillRect(0, 0, w, Math.floor(size * 0.12));
  ctx.fillRect(size - w, 0, w, Math.floor(size * 0.12));
}

/**
 * Whiten a thin frame inside the drawn cell region so the tile's own rounded
 * outline doesn't become "ink" after thresholding. Without this the bbox in
 * analyzeShape spans the tile border rectangle, which severely distorts the
 * left/right ink ratios for centered round letters (notably O on light
 * theme).
 *
 * `m` and `d` mirror the drawImage call: `m` is the inset of the drawn region
 * from each canvas edge, `d` is the drawn region's size.
 */
function maskInnerBorder(
  ctx: CanvasRenderingContext2D,
  m: number,
  d: number,
  color = "#ffffff"
): void {
  const band = Math.max(2, Math.floor(d * 0.05));
  ctx.fillStyle = color;
  ctx.fillRect(m, m, d, band);
  ctx.fillRect(m, m + d - band, d, band);
  ctx.fillRect(m, m, band, d);
  ctx.fillRect(m + d - band, m, band, d);
}

function otsuThreshold(gray: Uint8ClampedArray): number {
  const hist = new Array<number>(256).fill(0);
  for (let i = 0; i < gray.length; i++) hist[gray[i]]++;

  const total = gray.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];

  let sumB = 0;
  let wB = 0;
  let maxVar = 0;
  let threshold = 128;

  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > maxVar) {
      maxVar = between;
      threshold = t;
    }
  }
  return threshold;
}

function preprocessCellFromFrame(
  frameCanvas: HTMLCanvasElement,
  cell: CellRegion,
  frameW: number,
  frameH: number,
  theme: FrameTheme = "light"
): string[] {
  // Two source crops: a tight one (avoids Squaredle hint numbers in the
  // bottom corners) and a loose one (recovers when uniform-bounds detection
  // misaligned the cell — e.g. clean images without hint counts where the
  // tile is shifted relative to the cell rectangle).
  const buildCrop = (
    insetX: number,
    insetTop: number,
    insetBottom: number,
    overscan = 0
  ) => {
    const padX = Math.floor(cell.w * insetX);
    const padY = Math.floor(cell.h * insetTop);
    const padBottom = Math.floor(cell.h * insetBottom);
    const overX = Math.floor(cell.w * overscan);
    const overY = Math.floor(cell.h * overscan);
    const sx = Math.max(0, cell.x + padX - overX);
    const sy = Math.max(0, cell.y + padY - overY);
    const sw = Math.max(
      1,
      Math.min(frameW - sx, cell.w - padX * 2 + overX * 2)
    );
    const sh = Math.max(
      1,
      Math.min(
        frameH - sy,
        cell.h - padY - padBottom + overY * 2
      )
    );
    return { sx, sy, sw, sh };
  };

  const tight =
    theme === "dark"
      ? buildCrop(0.2, 0.16, 0.18)
      : buildCrop(0.14, 0.12, 0.22);
  // Loose crop: minimal padding and a small overscan beyond the cell box, to
  // recover when the detected cell rectangle is slightly shifted relative to
  // the actual tile (uniform-bounds detection on clean light images).
  const loose =
    theme === "dark"
      ? buildCrop(0.1, 0.08, 0.08, 0.04)
      : buildCrop(0.05, 0.05, 0.06, 0.05);

  const variants: string[] = [];
  const sizes = [160, 128, 96];

  // Helper closure invoked twice with different source rectangles.
  const buildVariants = ({
    sx,
    sy,
    sw,
    sh,
  }: {
    sx: number;
    sy: number;
    sw: number;
    sh: number;
  }) => {
  for (const size of sizes) {
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    const pads = [
      { inset: 0.14, scale: 0.72 },
      { inset: 0.1, scale: 0.78 },
    ];
    for (const { inset, scale } of pads) {
      const m = size * inset;
      const d = size * scale;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, size, size);
      ctx.drawImage(frameCanvas, sx, sy, sw, sh, m, m, d, d);
      maskCornerHints(ctx, size);
      if (theme === "light") maskInnerBorder(ctx, m, d);
      variants.push(canvas.toDataURL("image/png"));
    }

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, size, size);
    ctx.drawImage(
      frameCanvas,
      sx,
      sy,
      sw,
      sh,
      size * 0.1,
      size * 0.08,
      size * 0.8,
      size * 0.72
    );
    maskCornerHints(ctx, size);
    if (theme === "light") {
      // Match the drawImage rect above (size*0.1, size*0.08, size*0.8, size*0.72).
      const innerBand = Math.max(2, Math.floor(size * 0.72 * 0.05));
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(size * 0.1, size * 0.08, size * 0.8, innerBand);
      ctx.fillRect(
        size * 0.1,
        size * 0.08 + size * 0.72 - innerBand,
        size * 0.8,
        innerBand
      );
      ctx.fillRect(size * 0.1, size * 0.08, innerBand, size * 0.72);
      ctx.fillRect(
        size * 0.1 + size * 0.8 - innerBand,
        size * 0.08,
        innerBand,
        size * 0.72
      );
    }

    const imageData = ctx.getImageData(0, 0, size, size);
    const gray = new Uint8ClampedArray(size * size);
    for (let i = 0, p = 0; i < imageData.data.length; i += 4, p++) {
      gray[p] = Math.round(
        0.299 * imageData.data[i] +
          0.587 * imageData.data[i + 1] +
          0.114 * imageData.data[i + 2]
      );
    }
    const thresh = otsuThreshold(gray);
    const d = imageData.data;
    for (let i = 0, p = 0; i < d.length; i += 4, p++) {
      const v = gray[p] > thresh ? 255 : 0;
      d[i] = d[i + 1] = d[i + 2] = v;
      d[i + 3] = 255;
    }
    ctx.putImageData(imageData, 0, 0);
    maskCornerHints(ctx, size);
    variants.push(canvas.toDataURL("image/png"));

    for (let i = 0; i < d.length; i += 4) {
      d[i] = 255 - d[i];
      d[i + 1] = 255 - d[i + 1];
      d[i + 2] = 255 - d[i + 2];
    }
    ctx.putImageData(imageData, 0, 0);
    maskCornerHints(ctx, size);
    variants.push(canvas.toDataURL("image/png"));

    if (theme === "dark") {
      ctx.fillStyle = "#000000";
      ctx.fillRect(0, 0, size, size);
      ctx.drawImage(
        frameCanvas,
        sx,
        sy,
        sw,
        sh,
        size * 0.12,
        size * 0.1,
        size * 0.76,
        size * 0.76
      );
      // Dark background: mask corners black
      maskCornerHints(ctx, size, "#000000");
      variants.push(canvas.toDataURL("image/png"));

      const darkData = ctx.getImageData(0, 0, size, size);
      const dpx = darkData.data;
      for (let i = 0; i < dpx.length; i += 4) {
        const g = Math.round(
          0.299 * dpx[i] + 0.587 * dpx[i + 1] + 0.114 * dpx[i + 2]
        );
        const v = g > 72 ? 0 : 255;
        dpx[i] = dpx[i + 1] = dpx[i + 2] = v;
        dpx[i + 3] = 255;
      }
      ctx.putImageData(darkData, 0, 0);
      maskCornerHints(ctx, size);
      variants.push(canvas.toDataURL("image/png"));

      for (let i = 0; i < dpx.length; i += 4) {
        dpx[i] = 255 - dpx[i];
        dpx[i + 1] = 255 - dpx[i + 1];
        dpx[i + 2] = 255 - dpx[i + 2];
      }
      ctx.putImageData(darkData, 0, 0);
      // Dark background: mask corners black so they don't contaminate shape analysis
      maskCornerHints(ctx, size, "#000000");
      variants.push(canvas.toDataURL("image/png"));
    }
  }
  };

  buildVariants(tight);
  // Loose crop helps recover cells where uniform-bounds detection shifted the
  // rectangle off the actual tile, clipping letter strokes. Light theme only —
  // on dark theme, enlarging the crop tends to grab the squircle tile outline
  // and confuses both Tesseract and shape analysis.
  if (theme === "light") buildVariants(loose);

  return variants;
}

function collectCandidates(data: {
  text: string;
  blocks?: unknown;
}): Array<{ letter: string; conf: number }> {
  const out: Array<{ letter: string; conf: number }> = [];
  const fromText = normalizeOcrToLetter(data.text);
  if (fromText) out.push({ letter: fromText, conf: 50 });

  const blocks = data.blocks as Array<{
    lines?: Array<{ words?: Array<{ symbols?: Array<{ text: string; confidence?: number }> }> }>;
  }> | null | undefined;

  for (const block of blocks ?? []) {
    for (const line of block.lines ?? []) {
      for (const word of line.words ?? []) {
        for (const sym of word.symbols ?? []) {
          const letter = normalizeOcrToLetter(sym.text);
          if (letter) {
            out.push({ letter, conf: sym.confidence ?? 40 });
          }
        }
      }
    }
  }
  return out;
}

async function recognizeLetter(
  worker: Worker,
  variants: string[],
  theme: FrameTheme = "light"
): Promise<string> {
  const votes: Array<{ letter: string; weight: number }> = [];
  let shapeMetrics: ShapeMetrics | null = null;
  let shapeCanvas: HTMLCanvasElement | null = null;

  for (const dataUrl of variants) {
    const { data } = await worker.recognize(dataUrl);
    const baseConf = Math.max(data.confidence ?? 0, 1);

    for (const { letter, conf } of collectCandidates(data)) {
      votes.push({ letter, weight: baseConf + conf });
    }

    try {
      const canvas = await canvasFromDataUrl(dataUrl);
      const metrics = analyzeShape(canvas);
      if (metrics) {
        if (theme === "dark") {
          shapeMetrics = metrics;
          shapeCanvas = canvas;
        } else if (!shapeMetrics) {
          shapeMetrics = metrics;
          shapeCanvas = canvas;
        }
      }
    } catch {
      /* skip */
    }
  }

  if (shapeCanvas) {
    const shapeGuess = classifyLetterFromCanvas(shapeCanvas);
    if (shapeGuess) {
      votes.push({ letter: shapeGuess, weight: 65 });
    }
  }

  if (votes.length > 0) {
    let result = resolveLetter(votes, shapeMetrics, theme);
    if (shapeMetrics) {
      const e = scoreE(shapeMetrics);
      const p = scoreP(shapeMetrics);
      const r = scoreR(shapeMetrics);
      const i = scoreI(shapeMetrics);
      const b = scoreB(shapeMetrics);
      // Gate E→P/R shape overrides on Tesseract vote strength. Several
      // variants agreeing on E (aggregate > ~600) is strong evidence that
      // shouldn't be overruled by a 0.12 shape-prior delta.
      const eVoteTotal = voteTotal(votes, "E");
      const strongOcrE = eVoteTotal > 600;
      if (!strongOcrE && result === "E" && p > 0.52 && p > e + 0.12) result = "P";
      if (
        !strongOcrE &&
        result === "E" &&
        r > 0.55 &&
        e < 0.38 &&
        r > p + 0.08
      ) {
        result = "R";
      }
      if (
        (result === "B" || result === "R") &&
        i > 0.45 &&
        i > b + 0.1 &&
        shapeMetrics.aspect > 1.2 &&
        shapeMetrics.midRowSpan < 0.3 &&
        !shapeMetrics.hasMiddleBar
      ) {
        result = "I";
      }
      if (theme === "dark" && result === "O") {
        result = resolveDarkAmbiguousO(result, shapeMetrics);
      } else if (
        theme === "dark" &&
        result === "R" &&
        voteTotal(votes, "R") <= TESSERACT_CONFIDENT_VOTE
      ) {
        result = resolveDarkAmbiguousR(result, shapeMetrics);
      }
    }
    return result;
  }

  for (const dataUrl of variants) {
    try {
      const canvas = await canvasFromDataUrl(dataUrl);
      const shape = classifyLetterFromCanvas(canvas);
      if (shape) return shape;
    } catch {
      /* skip */
    }
  }

  return "";
}

export interface OcrProgress {
  stage: "analyzing" | "loading" | "scanning";
  current: number;
  total: number;
  detail?: string;
}

export interface ExtractResult {
  grid: string[][];
  detection: GridDetection;
  /**
   * A PNG data URL containing just the puzzle grid region of the source
   * image — the bounding rectangle around all active cells with a small
   * margin so tile borders aren't clipped. Useful as a reference image
   * placed next to the editable grid for letter verification.
   */
  croppedPreview: string;
}

/**
 * Build a data URL containing only the grid region of the detected frame,
 * with a small padding margin so tile borders aren't clipped. Width is
 * capped at 480px to keep the preview sensible on small panels; aspect
 * ratio of the source is always preserved.
 */
function makeGridPreview(detection: GridDetection): string {
  const { frame, bounds } = detection;
  const padX = Math.max(6, Math.round(bounds.w * 0.04));
  const padY = Math.max(6, Math.round(bounds.h * 0.04));
  const sx = Math.max(0, bounds.x - padX);
  const sy = Math.max(0, bounds.y - padY);
  const sw = Math.min(frame.width - sx, bounds.w + padX * 2);
  const sh = Math.min(frame.height - sy, bounds.h + padY * 2);

  if (sw <= 0 || sh <= 0) {
    return frame.canvas.toDataURL("image/png");
  }

  const MAX_OUT = 480;
  const scale = Math.min(1, MAX_OUT / Math.max(sw, sh));
  const outW = Math.max(1, Math.round(sw * scale));
  const outH = Math.max(1, Math.round(sh * scale));

  const out = document.createElement("canvas");
  out.width = outW;
  out.height = outH;
  const ctx = out.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(frame.canvas, sx, sy, sw, sh, 0, 0, outW, outH);
  return out.toDataURL("image/png");
}

export async function extractGridFromImage(
  imageSrc: string,
  hintSize?: number,
  onProgress?: (p: OcrProgress) => void
): Promise<ExtractResult> {
  onProgress?.({
    stage: "analyzing",
    current: 0,
    total: 1,
    detail: "Detecting grid layout…",
  });

  const detection = await detectGridLayout(imageSrc, hintSize);
  const { frame } = detection;

  const worker = await getWorker();
  const allCells = detection.cells.flatMap((row, r) =>
    row.map((cell, c) => ({ cell, r, c }))
  );
  const total = allCells.length;

  onProgress?.({ stage: "loading", current: 0, total });

  const grid: string[][] = detection.cells.map((row) =>
    row.map((cell) => (cell.active ? "?" : BLOCKED))
  );

  let idx = 0;
  for (const { cell, r, c } of allCells) {
    if (!cell.active) continue;
    idx++;
    onProgress?.({
      stage: "scanning",
      current: idx,
      total,
      detail: `Reading row ${r + 1}, col ${c + 1}`,
    });
    const variants = preprocessCellFromFrame(
      frame.canvas,
      cell,
      frame.width,
      frame.height,
      detection.theme
    );
    const letter = await recognizeLetter(
      worker,
      variants,
      detection.theme
    );
    grid[r][c] = letter || "?";
  }

  const croppedPreview = makeGridPreview(detection);
  return { grid, detection, croppedPreview };
}
