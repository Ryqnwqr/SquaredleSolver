export interface ImageFrame {
  data: ImageData;
  width: number;
  height: number;
  canvas: HTMLCanvasElement;
}

const MAX_DIMENSION = 1200;

export async function loadImageFrame(src: string): Promise<ImageFrame> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = reject;
    el.src = src;
  });

  const scale = Math.min(1, MAX_DIMENSION / Math.max(img.width, img.height));
  const width = Math.round(img.width * scale);
  const height = Math.round(img.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, width, height);
  const data = ctx.getImageData(0, 0, width, height);
  return { data, width, height, canvas };
}

export function toGrayscale(image: ImageData): Float32Array {
  const { width, height, data } = image;
  const gray = new Float32Array(width * height);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    gray[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }
  return gray;
}

export function boxBlur(gray: Float32Array, width: number, height: number, radius: number): Float32Array {
  const out = new Float32Array(gray.length);
  const tmp = new Float32Array(gray.length);

  for (let y = 0; y < height; y++) {
    let sum = 0;
    for (let x = -radius; x <= radius; x++) {
      const cx = Math.min(width - 1, Math.max(0, x));
      sum += gray[y * width + cx];
    }
    for (let x = 0; x < width; x++) {
      const add = Math.min(width - 1, x + radius);
      const sub = Math.max(0, x - radius - 1);
      sum += gray[y * width + add] - gray[y * width + sub];
      const denom = Math.min(width, 2 * radius + 1);
      tmp[y * width + x] = sum / denom;
    }
  }

  for (let x = 0; x < width; x++) {
    let sum = 0;
    for (let y = -radius; y <= radius; y++) {
      const cy = Math.min(height - 1, Math.max(0, y));
      sum += tmp[cy * width + x];
    }
    for (let y = 0; y < height; y++) {
      const add = Math.min(height - 1, y + radius);
      const sub = Math.max(0, y - radius - 1);
      sum += tmp[add * width + x] - tmp[sub * width + x];
      const denom = Math.min(height, 2 * radius + 1);
      out[y * width + x] = sum / denom;
    }
  }

  return out;
}

export function sobelMagnitude(gray: Float32Array, width: number, height: number): Float32Array {
  const mag = new Float32Array(gray.length);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      const gx =
        -gray[idx - width - 1] +
        gray[idx - width + 1] +
        -2 * gray[idx - 1] +
        2 * gray[idx + 1] +
        -gray[idx + width - 1] +
        gray[idx + width + 1];
      const gy =
        -gray[idx - width - 1] -
        2 * gray[idx - width] -
        gray[idx - width + 1] +
        gray[idx + width - 1] +
        2 * gray[idx + width] +
        gray[idx + width + 1];
      mag[idx] = Math.hypot(gx, gy);
    }
  }
  return mag;
}

export function adaptiveThreshold(
  gray: Float32Array,
  width: number,
  height: number,
  blockRadius = 12,
  c = 8
): Uint8Array {
  const blurred = boxBlur(gray, width, height, blockRadius);
  const binary = new Uint8Array(gray.length);
  for (let i = 0; i < gray.length; i++) {
    binary[i] = gray[i] > blurred[i] - c ? 255 : 0;
  }
  return binary;
}

export function invertBinary(binary: Uint8Array): Uint8Array {
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary[i] === 0 ? 255 : 0;
  }
  return out;
}

export function smoothProfile(values: Float32Array, radius: number): Float32Array {
  const out = new Float32Array(values.length);
  for (let i = 0; i < values.length; i++) {
    let sum = 0;
    let count = 0;
    for (let d = -radius; d <= radius; d++) {
      const j = i + d;
      if (j >= 0 && j < values.length) {
        sum += values[j];
        count++;
      }
    }
    out[i] = sum / count;
  }
  return out;
}

export interface Peak {
  index: number;
  value: number;
}

export function findPeaks(
  profile: Float32Array,
  minDistance: number,
  minProminenceRatio = 0.25
): Peak[] {
  const max = Math.max(...profile, 1);
  const threshold = max * minProminenceRatio;
  const raw: Peak[] = [];

  for (let i = 1; i < profile.length - 1; i++) {
    if (
      profile[i] >= threshold &&
      profile[i] >= profile[i - 1] &&
      profile[i] >= profile[i + 1]
    ) {
      raw.push({ index: i, value: profile[i] });
    }
  }

  raw.sort((a, b) => b.value - a.value);
  const kept: Peak[] = [];
  for (const peak of raw) {
    if (kept.every((p) => Math.abs(p.index - peak.index) >= minDistance)) {
      kept.push(peak);
    }
  }
  return kept.sort((a, b) => a.index - b.index);
}

export function varianceProfile(
  gray: Float32Array,
  width: number,
  height: number,
  axis: "row" | "col",
  margin = 0.08
): Float32Array {
  const mx = Math.floor(width * margin);
  const my = Math.floor(height * margin);
  const x0 = mx;
  const x1 = width - mx;
  const y0 = my;
  const y1 = height - my;

  if (axis === "row") {
    const profile = new Float32Array(height);
    for (let y = 0; y < height; y++) {
      let sum = 0;
      let sumSq = 0;
      let n = 0;
      for (let x = x0; x < x1; x++) {
        const v = gray[y * width + x];
        sum += v;
        sumSq += v * v;
        n++;
      }
      const mean = sum / n;
      profile[y] = sumSq / n - mean * mean;
    }
    return smoothProfile(profile, Math.max(2, Math.floor(height * 0.01)));
  }

  const profile = new Float32Array(width);
  for (let x = 0; x < width; x++) {
    let sum = 0;
    let sumSq = 0;
    let n = 0;
    for (let y = y0; y < y1; y++) {
      const v = gray[y * width + x];
      sum += v;
      sumSq += v * v;
      n++;
    }
    const mean = sum / n;
    profile[x] = sumSq / n - mean * mean;
  }
  return smoothProfile(profile, Math.max(2, Math.floor(width * 0.01)));
}

export function edgeProfile(
  edges: Float32Array,
  width: number,
  height: number,
  axis: "row" | "col"
): Float32Array {
  if (axis === "row") {
    const profile = new Float32Array(height);
    for (let y = 0; y < height; y++) {
      let sum = 0;
      for (let x = 0; x < width; x++) sum += edges[y * width + x];
      profile[y] = sum;
    }
    return smoothProfile(profile, Math.max(2, Math.floor(height * 0.008)));
  }
  const profile = new Float32Array(width);
  for (let x = 0; x < width; x++) {
    let sum = 0;
    for (let y = 0; y < height; y++) sum += edges[y * width + x];
    profile[x] = sum;
  }
  return smoothProfile(profile, Math.max(2, Math.floor(width * 0.008)));
}

export interface Band {
  start: number;
  end: number;
}

export function peaksToBands(peaks: Peak[], length: number): Band[] {
  if (peaks.length === 0) return [];
  const bounds = [0, ...peaks.map((p, i) => {
    if (i === peaks.length - 1) return length;
    return Math.floor((p.index + peaks[i + 1].index) / 2);
  })];
  bounds[0] = Math.max(0, peaks[0].index - Math.floor((bounds[1] - peaks[0].index) / 2));

  const bands: Band[] = [];
  for (let i = 0; i < peaks.length; i++) {
    const start = i === 0 ? bounds[0] : bounds[i];
    const end = i === peaks.length - 1 ? length : bounds[i + 1];
    if (end - start > 4) bands.push({ start, end });
  }
  return bands;
}

export interface Blob {
  x: number;
  y: number;
  w: number;
  h: number;
  cx: number;
  cy: number;
  area: number;
}

/**
 * Color-scheme-agnostic letter detection.
 *
 * Letters are the one signal that must be high-contrast against tile
 * background — otherwise the puzzle is unreadable. By trying multiple
 * thresholding strategies and both polarities, we get a clean per-letter blob
 * set for any theme (light/dark/tinted, any tile color or border style).
 *
 * Returns the candidate set whose blobs are most consistent in size and most
 * grid-like in their X/Y centroid distribution — i.e., the variant most
 * likely to be "one blob per letter" rather than over-segmentation (letter
 * strokes split) or under-segmentation (multiple letters merged).
 */
export function findLetterBlobsRobust(
  image: ImageData
): { blobs: Blob[]; polarity: "dark-on-light" | "light-on-dark" } {
  const { width, height } = image;
  const gray = toGrayscale(image);
  // Light CLAHE to boost local contrast on flat-ish dark tiles.
  const enhanced = claheGrayscale(gray, width, height);
  const blurred = boxBlur(enhanced, width, height, 1);

  // Candidate binarizations. Multiple block radii cover both tightly-packed
  // small grids and large-spacing big grids. Both polarities cover dark text
  // on light tiles and light text on dark tiles.
  const variants: Array<{ bin: Uint8Array; polarity: "dark-on-light" | "light-on-dark" }> = [];
  for (const r of [6, 10, 14, 20]) {
    for (const c of [4, 8]) {
      const bin = gaussianAdaptiveThreshold(blurred, width, height, r, c);
      variants.push({ bin, polarity: "dark-on-light" });
      variants.push({ bin: invertBinary(bin), polarity: "light-on-dark" });
    }
  }

  const minDim = Math.min(width, height);
  const minLetterArea = Math.max(8, minDim * minDim * 0.0003);
  const maxLetterArea = minDim * minDim * 0.04;

  let best: { blobs: Blob[]; polarity: "dark-on-light" | "light-on-dark"; score: number } | null =
    null;

  for (const { bin, polarity } of variants) {
    const raw = findLetterBlobs(bin, width, height);
    // Filter to plausibly letter-sized
    const filtered = raw.filter(
      (b) =>
        b.area >= minLetterArea &&
        b.area <= maxLetterArea &&
        b.w >= 4 &&
        b.h >= 6
    );
    if (filtered.length < 9 || filtered.length > 60) continue;
    const score = scoreLetterGrid(filtered, width, height);
    if (!best || score > best.score) {
      best = { blobs: filtered, polarity, score };
    }
  }

  return best ? { blobs: best.blobs, polarity: best.polarity } : { blobs: [], polarity: "dark-on-light" };
}

/**
 * Score a candidate letter-blob set by how grid-like it looks. Higher is
 * better. We reward:
 *   - blob count near a perfect square (n×n cells)
 *   - tight size distribution (consistent letter heights)
 *   - X- and Y-cluster counts that match each other (square grid)
 *   - cluster counts in the realistic Squaredle range [3, 7]
 */
function scoreLetterGrid(blobs: Blob[], width: number, height: number): number {
  if (blobs.length < 9) return 0;
  const heights = blobs.map((b) => b.h).sort((a, b) => a - b);
  const medH = heights[heights.length >> 1];
  const widths = blobs.map((b) => b.w).sort((a, b) => a - b);
  const medW = widths[widths.length >> 1];
  if (!medH || !medW) return 0;
  // Mean absolute deviation of heights, normalized by median height.
  const hDev =
    heights.reduce((s, h) => s + Math.abs(h - medH), 0) /
    (heights.length * medH);
  // Use a generous cluster tolerance so anti-aliased letter centroids in the
  // same row/col don't fragment across clusters.
  const tol = Math.max(medH, medW) * 0.6;
  const cy = cluster1D(blobs.map((b) => b.cy), tol);
  const cx = cluster1D(blobs.map((b) => b.cx), tol);

  const rows = cy.length;
  const cols = cx.length;
  if (rows < 3 || cols < 3 || rows > 7 || cols > 7) return 0;

  const n = blobs.length;
  const expected = rows * cols;
  const countMatch = 1 - Math.min(1, Math.abs(n - expected) / Math.max(1, expected));
  const squareBonus = rows === cols ? 0.2 : 0;
  // Penalize if blobs occupy < ~50% of frame area span (they should span most
  // of it for a real grid)
  const xSpread = blobs.reduce((s, b) => Math.max(s, b.cx), 0) -
    blobs.reduce((s, b) => Math.min(s, b.cx), Infinity);
  const ySpread = blobs.reduce((s, b) => Math.max(s, b.cy), 0) -
    blobs.reduce((s, b) => Math.min(s, b.cy), Infinity);
  const spread = Math.min(1, (xSpread / width + ySpread / height) / 1.4);

  return countMatch * 0.45 + squareBonus + spread * 0.2 + (1 - Math.min(1, hDev * 2)) * 0.25;
}

/**
 * From a set of letter blobs, infer grid dimensions and synthesize cell
 * rectangles. Returns null when the blob layout isn't a clean grid.
 */
export function inferGridFromLetterBlobs(
  blobs: Blob[],
  frameWidth: number,
  frameHeight: number
): {
  rows: number;
  cols: number;
  cells: Array<Array<{ x: number; y: number; w: number; h: number; active: boolean }>>;
  fillRatio: number;
} | null {
  if (blobs.length < 9) return null;

  const heights = blobs.map((b) => b.h).sort((a, b) => a - b);
  const widths = blobs.map((b) => b.w).sort((a, b) => a - b);
  const medH = heights[heights.length >> 1];
  const medW = widths[widths.length >> 1];
  if (!medH || !medW) return null;

  const tol = Math.max(medH, medW) * 0.6;
  const cyCenters = cluster1D(blobs.map((b) => b.cy), tol);
  const cxCenters = cluster1D(blobs.map((b) => b.cx), tol);
  const rows = cyCenters.length;
  const cols = cxCenters.length;
  if (rows < 3 || cols < 3 || rows > 7 || cols > 7) return null;

  // Estimate cell pitch from cluster spacings — fall back to frame-divided
  // pitch if there's only one row/col cluster pair (shouldn't happen given
  // the >=3 guard above, but defensive).
  const sortedCx = [...cxCenters].sort((a, b) => a - b);
  const sortedCy = [...cyCenters].sort((a, b) => a - b);
  const colGaps: number[] = [];
  for (let i = 1; i < sortedCx.length; i++) colGaps.push(sortedCx[i] - sortedCx[i - 1]);
  const rowGaps: number[] = [];
  for (let i = 1; i < sortedCy.length; i++) rowGaps.push(sortedCy[i] - sortedCy[i - 1]);
  const cellW = median(colGaps) || frameWidth / cols;
  const cellH = median(rowGaps) || frameHeight / rows;

  // Snap each blob to nearest (row, col) cluster index.
  const indexAt = (val: number, centers: number[]): number => {
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < centers.length; i++) {
      const d = Math.abs(centers[i] - val);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    return bestIdx;
  };
  const occ: boolean[][] = Array.from({ length: rows }, () =>
    Array<boolean>(cols).fill(false)
  );
  for (const b of blobs) {
    const r = indexAt(b.cy, sortedCy);
    const c = indexAt(b.cx, sortedCx);
    occ[r][c] = true;
  }

  // Build cells. Cell rectangle is centered on the cluster center with
  // generous coverage (cellW × cellH expanded slightly so letter+tile fit).
  const cellPadW = cellW * 0.95;
  const cellPadH = cellH * 0.95;
  const cells = sortedCy.map((cy, r) =>
    sortedCx.map((cx, c) => ({
      x: Math.max(0, Math.round(cx - cellPadW / 2)),
      y: Math.max(0, Math.round(cy - cellPadH / 2)),
      w: Math.round(
        Math.min(frameWidth - Math.max(0, Math.round(cx - cellPadW / 2)), cellPadW)
      ),
      h: Math.round(
        Math.min(frameHeight - Math.max(0, Math.round(cy - cellPadH / 2)), cellPadH)
      ),
      active: occ[r][c],
    }))
  );

  const total = rows * cols;
  const active = occ.flat().filter(Boolean).length;
  return { rows, cols, cells, fillRatio: active / total };
}

export function findLetterBlobs(
  binary: Uint8Array,
  width: number,
  height: number
): Blob[] {
  const visited = new Uint8Array(binary.length);
  const blobs: Blob[] = [];
  const imgArea = width * height;
  const minArea = imgArea * 0.00015;
  const maxArea = imgArea * 0.12;

  const neighbors = [
    [-1, -1], [-1, 0], [-1, 1],
    [0, -1], [0, 1],
    [1, -1], [1, 0], [1, 1],
  ];

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const start = y * width + x;
      if (binary[start] === 0 || visited[start]) continue;

      const stack = [start];
      visited[start] = 1;
      let minX = x;
      let maxX = x;
      let minY = y;
      let maxY = y;
      let area = 0;

      while (stack.length) {
        const idx = stack.pop()!;
        const px = idx % width;
        const py = Math.floor(idx / width);
        area++;
        minX = Math.min(minX, px);
        maxX = Math.max(maxX, px);
        minY = Math.min(minY, py);
        maxY = Math.max(maxY, py);

        for (const [dx, dy] of neighbors) {
          const nx = px + dx;
          const ny = py + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const nidx = ny * width + nx;
          if (binary[nidx] === 0 || visited[nidx]) continue;
          visited[nidx] = 1;
          stack.push(nidx);
        }
      }

      const w = maxX - minX + 1;
      const h = maxY - minY + 1;
      const ratio = w / h;
      if (
        area < minArea ||
        area > maxArea ||
        ratio < 0.35 ||
        ratio > 2.8 ||
        w < 6 ||
        h < 6
      ) {
        continue;
      }

      blobs.push({
        x: minX,
        y: minY,
        w,
        h,
        cx: (minX + maxX) / 2,
        cy: (minY + maxY) / 2,
        area,
      });
    }
  }

  return blobs;
}

export function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Detect colored puzzle tiles (Squaredle UI) as cell-sized regions */
export function findColoredTileBlobs(image: ImageData): Blob[] {
  const { width, height, data } = image;
  const mask = new Uint8Array(width * height);
  const imgArea = width * height;
  const minArea = imgArea * 0.002;
  const maxArea = imgArea * 0.15;

  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const sat = max === 0 ? 0 : (max - min) / max;
    const lum = (r + g + b) / 3;
    if (sat > 0.08 && lum > 28 && lum < 245) mask[p] = 1;
  }

  return extractSquareBlobs(mask, width, height, minArea, maxArea, 12);
}

export type FrameTheme = "dark" | "light";

/** Classify screenshot as dark board (black bg, light text) vs light UI. */
export function estimateFrameTheme(image: ImageData): FrameTheme {
  const { data } = image;
  let dark = 0;
  let bright = 0;
  let mid = 0;
  let n = 0;
  const lumSamples: number[] = [];

  for (let i = 0; i < data.length; i += 4) {
    const lum = (data[i] + data[i + 1] + data[i + 2]) / 3;
    n++;
    if (lum < 60) dark++;
    if (lum > 175) bright++;
    if (lum >= 60 && lum <= 175) mid++;
    if ((i >> 2) % 9 === 0) lumSamples.push(lum);
  }
  if (n === 0) return "light";

  const darkRatio = dark / n;
  const brightRatio = bright / n;
  lumSamples.sort((a, b) => a - b);
  const medianLum = lumSamples[lumSamples.length >> 1] ?? 128;

  if (medianLum < 72) return "dark";
  if (darkRatio > 0.38 && brightRatio > 0.0015) return "dark";
  if (darkRatio > 0.55 && mid / n < 0.35) return "dark";
  return "light";
}

/** Dark Squaredle boards: charcoal tiles on black, white letters (exclude bright text). */
export function findDarkTileBlobs(image: ImageData): Blob[] {
  const { width, height, data } = image;
  const mask = new Uint8Array(width * height);
  const imgArea = width * height;
  const minArea = imgArea * 0.0012;
  const maxArea = imgArea * 0.14;

  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const sat = max === 0 ? 0 : (max - min) / max;
    const lum = (r + g + b) / 3;
    if (lum > 140) continue;
    if (lum < 10) continue;
    if (sat < 0.2 && lum >= 16 && lum <= 115) mask[p] = 1;
  }

  return extractSquareBlobs(mask, width, height, minArea, maxArea, 14);
}

function extractSquareBlobs(
  mask: Uint8Array,
  width: number,
  height: number,
  minArea: number,
  maxArea: number,
  minSide: number
): Blob[] {
  const visited = new Uint8Array(mask.length);
  const blobs: Blob[] = [];
  const neighbors = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ];

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const start = y * width + x;
      if (!mask[start] || visited[start]) continue;

      const stack = [start];
      visited[start] = 1;
      let minX = x;
      let maxX = x;
      let minY = y;
      let maxY = y;
      let area = 0;

      while (stack.length) {
        const idx = stack.pop()!;
        const px = idx % width;
        const py = (idx / width) | 0;
        area++;
        minX = Math.min(minX, px);
        maxX = Math.max(maxX, px);
        minY = Math.min(minY, py);
        maxY = Math.max(maxY, py);
        for (const [dx, dy] of neighbors) {
          const nx = px + dx;
          const ny = py + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const nidx = ny * width + nx;
          if (!mask[nidx] || visited[nidx]) continue;
          visited[nidx] = 1;
          stack.push(nidx);
        }
      }

      const w = maxX - minX + 1;
      const h = maxY - minY + 1;
      const ratio = w / h;
      if (
        area >= minArea &&
        area <= maxArea &&
        ratio > 0.55 &&
        ratio < 1.8 &&
        w >= minSide &&
        h >= minSide
      ) {
        blobs.push({
          x: minX,
          y: minY,
          w,
          h,
          cx: (minX + maxX) / 2,
          cy: (minY + maxY) / 2,
          area,
        });
      }
    }
  }
  return blobs;
}

/** Light gray Squaredle tiles (low saturation, mid luminance) */
export function findGrayTileBlobs(image: ImageData): Blob[] {
  const { width, height, data } = image;
  const mask = new Uint8Array(width * height);
  const imgArea = width * height;
  const minArea = imgArea * 0.0015;
  const maxArea = imgArea * 0.14;

  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const sat = max === 0 ? 0 : (max - min) / max;
    const lum = (r + g + b) / 3;
    if (sat < 0.14 && lum > 85 && lum < 235) mask[p] = 1;
  }

  return extractSquareBlobs(mask, width, height, minArea, maxArea, 14);
}

// ─────────────────────────────────────────────────────────────────────────────
// CLAHE – Contrast Limited Adaptive Histogram Equalization
// Boosts local contrast so low-contrast tiles become detectable regardless of
// their absolute luminance or colour.
// ─────────────────────────────────────────────────────────────────────────────
export function claheGrayscale(
  gray: Float32Array,
  width: number,
  height: number,
  tileSize = 64,
  clipLimit = 3.5
): Float32Array {
  const tilesX = Math.max(2, Math.ceil(width / tileSize));
  const tilesY = Math.max(2, Math.ceil(height / tileSize));
  const tw = Math.ceil(width / tilesX);
  const th = Math.ceil(height / tilesY);

  // Build a histogram-equalised LUT for every tile
  const luts: Uint8Array[] = [];
  for (let ty = 0; ty < tilesY; ty++) {
    for (let tx = 0; tx < tilesX; tx++) {
      const x0 = tx * tw;
      const y0 = ty * th;
      const x1 = Math.min(x0 + tw, width);
      const y1 = Math.min(y0 + th, height);
      const hist = new Int32Array(256);
      let count = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          hist[Math.min(255, Math.floor(gray[y * width + x]))]++;
          count++;
        }
      }
      // Clip and redistribute excess
      const clip = Math.max(1, Math.round((clipLimit * count) / 256));
      let excess = 0;
      for (let i = 0; i < 256; i++) {
        if (hist[i] > clip) {
          excess += hist[i] - clip;
          hist[i] = clip;
        }
      }
      const add = Math.floor(excess / 256);
      const rem = excess % 256;
      for (let i = 0; i < 256; i++) hist[i] += add + (i < rem ? 1 : 0);
      // Build CDF → output mapping
      const lut = new Uint8Array(256);
      let cdf = 0;
      let cdfMin = -1;
      for (let i = 0; i < 256; i++) {
        cdf += hist[i];
        if (cdfMin < 0 && hist[i] > 0) cdfMin = cdf;
        lut[i] =
          cdfMin >= 0 && count > cdfMin
            ? Math.round(((cdf - cdfMin) / (count - cdfMin)) * 255)
            : 0;
      }
      luts.push(lut);
    }
  }

  // Bilinear interpolation between the four surrounding tile LUTs
  const out = new Float32Array(gray.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = Math.min(255, Math.floor(gray[y * width + x]));
      const fx = (x + 0.5) / tw - 0.5;
      const fy = (y + 0.5) / th - 0.5;
      const tx0 = Math.max(0, Math.floor(fx));
      const tx1 = Math.min(tilesX - 1, tx0 + 1);
      const ty0 = Math.max(0, Math.floor(fy));
      const ty1 = Math.min(tilesY - 1, ty0 + 1);
      const wx = Math.max(0, Math.min(1, fx - tx0));
      const wy = Math.max(0, Math.min(1, fy - ty0));
      const l00 = luts[ty0 * tilesX + tx0][v];
      const l10 = luts[ty0 * tilesX + tx1][v];
      const l01 = luts[ty1 * tilesX + tx0][v];
      const l11 = luts[ty1 * tilesX + tx1][v];
      out[y * width + x] =
        l00 * (1 - wx) * (1 - wy) +
        l10 * wx * (1 - wy) +
        l01 * (1 - wx) * wy +
        l11 * wx * wy;
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Canny edge detection
// Finds tile boundaries by gradient alone – works for any colour/contrast.
// ─────────────────────────────────────────────────────────────────────────────
export function cannyEdges(
  gray: Float32Array,
  width: number,
  height: number
): Uint8Array {
  // Approximate Gaussian smoothing via 3 box-blur passes (≈ σ 1.7)
  let blurred = boxBlur(gray, width, height, 1);
  blurred = boxBlur(blurred, width, height, 1);
  blurred = boxBlur(blurred, width, height, 1);

  // Sobel gradient components
  const gx = new Float32Array(gray.length);
  const gy = new Float32Array(gray.length);
  const mag = new Float32Array(gray.length);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      gx[i] =
        -blurred[i - width - 1] +
        blurred[i - width + 1] +
        -2 * blurred[i - 1] +
        2 * blurred[i + 1] +
        -blurred[i + width - 1] +
        blurred[i + width + 1];
      gy[i] =
        -blurred[i - width - 1] -
        2 * blurred[i - width] -
        blurred[i - width + 1] +
        blurred[i + width - 1] +
        2 * blurred[i + width] +
        blurred[i + width + 1];
      mag[i] = Math.sqrt(gx[i] * gx[i] + gy[i] * gy[i]);
    }
  }

  // Auto-threshold: top 5% of gradient as high, ×0.4 as low
  const histMag = new Int32Array(1024);
  let magMax = 0;
  for (let i = 0; i < mag.length; i++) if (mag[i] > magMax) magMax = mag[i];
  const scale = magMax > 0 ? 1023 / magMax : 1;
  for (let i = 0; i < mag.length; i++)
    histMag[Math.min(1023, Math.floor(mag[i] * scale))]++;
  let cumHigh = 0;
  let high = Math.max(10, magMax * 0.08);
  for (let i = 1023; i >= 0; i--) {
    cumHigh += histMag[i];
    if (cumHigh >= mag.length * 0.05) {
      high = i / scale;
      break;
    }
  }
  const low = high * 0.4;

  // Non-maximum suppression along gradient direction
  const nms = new Float32Array(gray.length);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      if (!mag[i]) continue;
      const angle = ((Math.atan2(gy[i], gx[i]) * 180) / Math.PI + 180) % 180;
      let n1: number, n2: number;
      if (angle < 22.5 || angle >= 157.5) {
        n1 = mag[i - 1];
        n2 = mag[i + 1];
      } else if (angle < 67.5) {
        n1 = mag[i - width + 1];
        n2 = mag[i + width - 1];
      } else if (angle < 112.5) {
        n1 = mag[i - width];
        n2 = mag[i + width];
      } else {
        n1 = mag[i - width - 1];
        n2 = mag[i + width + 1];
      }
      if (mag[i] >= n1 && mag[i] >= n2) nms[i] = mag[i];
    }
  }

  // Double threshold + BFS hysteresis
  const STRONG = 2;
  const WEAK = 1;
  const edges = new Uint8Array(gray.length);
  const queue: number[] = [];
  for (let i = 0; i < nms.length; i++) {
    if (nms[i] >= high) {
      edges[i] = STRONG;
      queue.push(i);
    } else if (nms[i] >= low) {
      edges[i] = WEAK;
    }
  }
  while (queue.length) {
    const i = queue.pop()!;
    const y = (i / width) | 0;
    const x = i % width;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const ny = y + dy;
        const nx = x + dx;
        if (ny < 0 || ny >= height || nx < 0 || nx >= width) continue;
        const ni = ny * width + nx;
        if (edges[ni] === WEAK) {
          edges[ni] = STRONG;
          queue.push(ni);
        }
      }
    }
  }
  for (let i = 0; i < edges.length; i++) edges[i] = edges[i] === STRONG ? 255 : 0;
  return edges;
}

// ─────────────────────────────────────────────────────────────────────────────
// Gaussian adaptive threshold
// Uses 3-pass box-blur to approximate Gaussian weighting (better than the flat
// box-blur version for detecting uniform-coloured tile regions).
// ─────────────────────────────────────────────────────────────────────────────
export function gaussianAdaptiveThreshold(
  gray: Float32Array,
  width: number,
  height: number,
  blockRadius = 12,
  c = 8
): Uint8Array {
  const r = Math.max(1, Math.round(blockRadius / 3));
  let blurred = boxBlur(gray, width, height, r);
  blurred = boxBlur(blurred, width, height, r);
  blurred = boxBlur(blurred, width, height, r);
  const binary = new Uint8Array(gray.length);
  for (let i = 0; i < gray.length; i++) {
    binary[i] = gray[i] > blurred[i] - c ? 255 : 0;
  }
  return binary;
}

// ─────────────────────────────────────────────────────────────────────────────
// Morphological helpers (private)
// ─────────────────────────────────────────────────────────────────────────────

/** O(n) separable box dilation – horizontal then vertical pass. */
function dilateBinaryFast(
  binary: Uint8Array,
  width: number,
  height: number,
  radius: number
): Uint8Array {
  const tmp = new Uint8Array(binary.length);
  const out = new Uint8Array(binary.length);

  for (let y = 0; y < height; y++) {
    const row = y * width;
    let sum = 0;
    for (let x = 0; x < Math.min(radius, width); x++) sum += binary[row + x];
    for (let x = 0; x < width; x++) {
      const ax = x + radius;
      const sx = x - radius - 1;
      if (ax < width) sum += binary[row + ax];
      if (sx >= 0) sum -= binary[row + sx];
      if (sum > 0) tmp[row + x] = 1;
    }
  }
  for (let x = 0; x < width; x++) {
    let sum = 0;
    for (let y = 0; y < Math.min(radius, height); y++) sum += tmp[y * width + x];
    for (let y = 0; y < height; y++) {
      const ay = y + radius;
      const sy = y - radius - 1;
      if (ay < height) sum += tmp[ay * width + x];
      if (sy >= 0) sum -= tmp[sy * width + x];
      if (sum > 0) out[y * width + x] = 1;
    }
  }
  return out;
}

/** BFS flood-fill from the image border; zeroes all border-connected foreground. */
function removeBorderConnected(
  mask: Uint8Array,
  width: number,
  height: number
): Uint8Array {
  const out = new Uint8Array(mask);
  const visited = new Uint8Array(mask.length);
  const queue: number[] = [];

  const seed = (i: number) => {
    if (out[i] && !visited[i]) {
      visited[i] = 1;
      queue.push(i);
    }
  };
  for (let x = 0; x < width; x++) {
    seed(x);
    seed((height - 1) * width + x);
  }
  for (let y = 1; y < height - 1; y++) {
    seed(y * width);
    seed(y * width + width - 1);
  }

  const DX = [-1, 1, 0, 0];
  const DY = [0, 0, -1, 1];
  while (queue.length) {
    const i = queue.pop()!;
    out[i] = 0;
    const iy = (i / width) | 0;
    const ix = i % width;
    for (let d = 0; d < 4; d++) {
      const ny = iy + DY[d];
      const nx = ix + DX[d];
      if (ny < 0 || ny >= height || nx < 0 || nx >= width) continue;
      const ni = ny * width + nx;
      if (out[ni] && !visited[ni]) {
        visited[ni] = 1;
        queue.push(ni);
      }
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tile finder: CLAHE → Canny → dilate → invert → contour blobs
// Works on any colour/contrast because it detects tile *boundaries* only.
// ─────────────────────────────────────────────────────────────────────────────
export function findTilesByEdgeContours(image: ImageData): Blob[] {
  const { width, height } = image;
  const imgArea = width * height;
  const minArea = imgArea * 0.0008;
  const maxArea = imgArea * 0.13;

  const gray = toGrayscale(image);
  const tileSize = Math.max(16, Math.round(Math.min(width, height) / 7));
  const enhanced = claheGrayscale(gray, width, height, tileSize, 4.0);

  const rawEdges = cannyEdges(enhanced, width, height);

  // Dilate edges to close the inter-tile gaps
  const dilRadius = Math.max(3, Math.round(Math.min(width, height) / 65));
  const edgesMask = new Uint8Array(rawEdges.length);
  for (let i = 0; i < rawEdges.length; i++) edgesMask[i] = rawEdges[i] > 0 ? 1 : 0;
  const dilated = dilateBinaryFast(edgesMask, width, height, dilRadius);

  // Invert: regions enclosed by edges (= tile interiors) become foreground
  const interior = new Uint8Array(dilated.length);
  for (let i = 0; i < dilated.length; i++) interior[i] = dilated[i] ? 0 : 1;

  // Remove background (flood fill from image border) so only tile interiors remain
  const tileOnly = removeBorderConnected(interior, width, height);

  return extractSquareBlobs(tileOnly, width, height, minArea, maxArea, 10);
}

// ─────────────────────────────────────────────────────────────────────────────
// Tile finder: HSV saturation channel fallback
// Coloured tiles have higher S than a pure-black/white background even when
// luminance alone can't distinguish them.
// ─────────────────────────────────────────────────────────────────────────────
export function findTilesBySaturation(image: ImageData): Blob[] {
  const { width, height, data } = image;
  const imgArea = width * height;
  const minArea = imgArea * 0.001;
  const maxArea = imgArea * 0.15;

  // Compute adaptive saturation threshold from mid-luminance pixels
  const satSamples: number[] = [];
  for (let i = 0; i < data.length; i += 28) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const lum = (r + g + b) / 3;
    if (lum < 15 || lum > 240) continue;
    const mx = Math.max(r, g, b);
    const mn = Math.min(r, g, b);
    satSamples.push(mx === 0 ? 0 : (mx - mn) / mx);
  }
  satSamples.sort((a, b) => a - b);
  const medSat = satSamples[satSamples.length >> 1] ?? 0.1;
  const satThresh = Math.max(0.04, medSat * 0.5);

  const mask = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const lum = (r + g + b) / 3;
    if (lum < 15 || lum > 240) continue;
    const mx = Math.max(r, g, b);
    const mn = Math.min(r, g, b);
    const sat = mx === 0 ? 0 : (mx - mn) / mx;
    if (sat >= satThresh) mask[p] = 1;
  }

  return extractSquareBlobs(mask, width, height, minArea, maxArea, 12);
}

export function cluster1D(values: number[], tolerance: number): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  const groups: number[][] = [];
  for (const v of sorted) {
    let placed = false;
    for (const g of groups) {
      const center = median(g);
      if (Math.abs(center - v) <= tolerance) {
        g.push(v);
        placed = true;
        break;
      }
    }
    if (!placed) groups.push([v]);
  }
  return groups.map((g) => median(g)).sort((a, b) => a - b);
}
