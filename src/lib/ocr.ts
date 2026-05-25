import { createWorker, PSM, type Worker } from "tesseract.js";
import { BLOCKED, detectGridLayout, type CellRegion, type GridDetection } from "./gridDetect";
import { normalizeOcrToLetter } from "./letterNormalize";
import {
  analyzeShape,
  canvasFromDataUrl,
  classifyLetterFromCanvas,
  resolveLetter,
  scoreB,
  scoreE,
  scoreI,
  scoreP,
  scoreR,
  type ShapeMetrics,
} from "./shapeClassify";

let workerPromise: Promise<Worker> | null = null;

async function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = (async () => {
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
function maskCornerHints(ctx: CanvasRenderingContext2D, size: number): void {
  const h = Math.floor(size * 0.24);
  const w = Math.floor(size * 0.22);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, size - h, w, h);
  ctx.fillRect(size - w, size - h, w, h);
  ctx.fillRect(0, 0, w, Math.floor(size * 0.12));
  ctx.fillRect(size - w, 0, w, Math.floor(size * 0.12));
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
  frameH: number
): string[] {
  // Exclude Squaredle corner hint numbers (red/grey counts in bottom corners)
  const padX = Math.floor(cell.w * 0.14);
  const padY = Math.floor(cell.h * 0.12);
  const padBottom = Math.floor(cell.h * 0.22);
  const sx = Math.max(0, cell.x + padX);
  const sy = Math.max(0, cell.y + padY);
  const sw = Math.max(1, Math.min(frameW - sx, cell.w - padX * 2));
  const sh = Math.max(1, Math.min(frameH - sy, cell.h - padY - padBottom));

  const variants: string[] = [];
  const sizes = [160, 128, 96];

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
  }

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
  variants: string[]
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

    if (!shapeMetrics) {
      try {
        const canvas = await canvasFromDataUrl(dataUrl);
        shapeMetrics = analyzeShape(canvas);
        shapeCanvas = canvas;
      } catch {
        /* skip */
      }
    }
  }

  if (shapeCanvas) {
    const shapeGuess = classifyLetterFromCanvas(shapeCanvas);
    if (shapeGuess) {
      votes.push({ letter: shapeGuess, weight: 65 });
    }
  }

  if (votes.length > 0) {
    let result = resolveLetter(votes, shapeMetrics);
    if (shapeMetrics) {
      const e = scoreE(shapeMetrics);
      const p = scoreP(shapeMetrics);
      const r = scoreR(shapeMetrics);
      const i = scoreI(shapeMetrics);
      const b = scoreB(shapeMetrics);
      if (result === "E" && p > 0.52 && p > e + 0.12) result = "P";
      if (result === "E" && r > 0.55 && e < 0.38 && r > p + 0.08) {
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
      frame.height
    );
    const letter = await recognizeLetter(worker, variants);
    grid[r][c] = letter || "?";
  }

  return { grid, detection };
}
