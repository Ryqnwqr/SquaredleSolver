import {
  boxBlur,
  claheGrayscale,
  cluster1D,
  edgeProfile,
  estimateFrameTheme,
  findColoredTileBlobs,
  findDarkTileBlobs,
  findGrayTileBlobs,
  findLetterBlobs,
  findLetterBlobsRobust,
  findTilesByEdgeContours,
  findTilesBySaturation,
  gaussianAdaptiveThreshold,
  inferGridFromLetterBlobs,
  type FrameTheme,
  findPeaks,
  invertBinary,
  loadImageFrame,
  median,
  peaksToBands,
  sobelMagnitude,
  toGrayscale,
  varianceProfile,
  type Band,
  type Blob,
  type ImageFrame,
  type Peak,
} from "./imageProcessing";

export const BLOCKED = ".";

export interface CellRegion {
  x: number;
  y: number;
  w: number;
  h: number;
  active: boolean;
}

export interface GridDetection {
  rows: number;
  cols: number;
  cells: CellRegion[][];
  bounds: { x: number; y: number; w: number; h: number };
  confidence: number;
  method: string;
  theme: FrameTheme;
  frame: ImageFrame;
}

interface GridCandidate {
  rows: number;
  cols: number;
  cells: CellRegion[][];
  confidence: number;
  method: string;
}

function filterMainCluster(blobs: Blob[]): Blob[] {
  if (blobs.length < 10) return blobs;
  const cxMed = median(blobs.map((b) => b.cx));
  const cyMed = median(blobs.map((b) => b.cy));
  const dists = blobs.map((b) => Math.hypot(b.cx - cxMed, b.cy - cyMed));
  const distMed = median(dists);
  const limit = distMed * 2.1;
  const filtered = blobs.filter((_, i) => dists[i] <= limit);
  return filtered.length >= 9 ? filtered : blobs;
}

function filterTileLikeBlobs(blobs: Blob[]): Blob[] {
  if (blobs.length < 9) return blobs;
  const areas = blobs.map((b) => b.area);
  const medArea = median(areas);
  const sizes = blobs.map((b) => (b.w + b.h) / 2);
  const medSize = median(sizes);
  const filtered = blobs.filter((b) => {
    const areaRatio = b.area / medArea;
    const sizeRatio = ((b.w + b.h) / 2) / medSize;
    return areaRatio > 0.3 && areaRatio < 3 && sizeRatio > 0.45 && sizeRatio < 2;
  });
  return filtered.length >= 9 ? filtered : blobs;
}

function trimPeaksToCount(peaks: Peak[], count: number): Peak[] {
  if (peaks.length <= count) return peaks;
  const sorted = [...peaks].sort((a, b) => b.value - a.value);
  return sorted.slice(0, count).sort((a, b) => a.index - b.index);
}

function pruneSparseLines(cells: CellRegion[][]): CellRegion[][] {
  let grid = cells;
  if (!grid.length || !grid[0]?.length) return grid;

  const minRowActive = Math.max(2, Math.ceil(grid[0].length * 0.35));
  const rowHeights = grid.map((row) => row[0]?.h ?? 0).filter((h) => h > 0);
  const medRowH = median(rowHeights) || 1;

  grid = grid.filter((row) => {
    const active = row.filter((c) => c.active).length;
    const h = row[0]?.h ?? medRowH;
    if (active < minRowActive) return false;
    if (h < medRowH * 0.42) return false;
    return true;
  });

  if (!grid.length) return cells;

  const minColActive = Math.max(2, Math.ceil(grid.length * 0.35));
  const colWidths = grid[0].map((_, c) => grid[0][c]?.w ?? 0).filter((w) => w > 0);
  const medColW = median(colWidths) || 1;
  const keepCols: number[] = [];

  for (let c = 0; c < grid[0].length; c++) {
    const active = grid.filter((row) => row[c]?.active).length;
    const w = grid[0][c]?.w ?? medColW;
    if (active >= minColActive && w >= medColW * 0.42) keepCols.push(c);
  }

  if (keepCols.length < grid[0].length) {
    grid = grid.map((row) => keepCols.map((c) => row[c]));
  }

  return grid;
}

function finalizeCandidate(candidate: GridCandidate, tileCount: number): GridCandidate {
  const pruned = pruneSparseLines(candidate.cells);
  const rows = pruned.length;
  const cols = pruned[0]?.length ?? 0;
  const active = pruned.flat().filter((c) => c.active).length;
  const total = rows * cols;
  const fillRatio = total > 0 ? active / total : 0;
  const expected = Math.round(Math.sqrt(tileCount));
  const squareBonus =
    rows === cols &&
    tileCount >= 9 &&
    Math.abs(active - tileCount) <= 3 &&
    Math.abs(rows - expected) <= 1
      ? 0.15
      : 0;
  const sparsePenalty = fillRatio < 0.55 ? -0.2 : 0;
  const extraLinePenalty =
    (rows > expected + 1 || cols > expected + 1) && tileCount > 0 ? -0.18 : 0;

  return {
    ...candidate,
    rows,
    cols,
    cells: pruned,
    confidence: Math.max(
      0,
      Math.min(1, candidate.confidence + squareBonus + sparsePenalty + extraLinePenalty)
    ),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Grid dimension inference via spatial clustering
//
// Rather than inferring NxN from sqrt(blobCount) — which breaks when only
// some tiles are detected — we cluster blob centres independently in X and Y
// and count the resulting groups. Even a partial set (e.g. 12 of 16 tiles on
// a 4×4 board) will produce 4 X-clusters and 4 Y-clusters.
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Count row/column bands from CLAHE + edge projection profiles.
 * Works without tile blobs — essential for low-contrast boards where colour
 * segmentation finds nothing.
 */
function inferDimensionsFromProjection(
  gray: Float32Array,
  width: number,
  height: number
): { rows: number; cols: number; confidence: number } | null {
  const enhanced = claheGrayscale(gray, width, height);
  const edges = sobelMagnitude(enhanced, width, height);
  const rowVar = varianceProfile(enhanced, width, height, "row");
  const colVar = varianceProfile(enhanced, width, height, "col");
  const rowEdge = edgeProfile(edges, width, height, "row");
  const colEdge = edgeProfile(edges, width, height, "col");

  const rowCombined = new Float32Array(height);
  const colCombined = new Float32Array(width);
  for (let y = 0; y < height; y++) {
    rowCombined[y] = rowVar[y] * 0.65 + rowEdge[y] * 0.35;
  }
  for (let x = 0; x < width; x++) {
    colCombined[x] = colVar[x] * 0.65 + colEdge[x] * 0.35;
  }

  const peakSpacingScore = (peaks: Peak[]): number => {
    if (peaks.length < 2) return 0.5;
    const gaps: number[] = [];
    for (let i = 1; i < peaks.length; i++) {
      gaps.push(peaks[i].index - peaks[i - 1].index);
    }
    const med = median(gaps);
    if (med <= 0) return 0;
    const dev = median(gaps.map((g) => Math.abs(g - med))) / med;
    return Math.max(0, 1 - dev * 2);
  };

  let best: { rows: number; cols: number; confidence: number } | null = null;

  // Try common Squaredle sizes; prefer 4 before 5 when scores tie (avoids 5×5 default bias)
  for (const n of [4, 5, 6, 3, 7]) {
    const minRowDist = Math.max(6, Math.floor(height / (n + 0.55)));
    const minColDist = Math.max(6, Math.floor(width / (n + 0.55)));
    const rowPeaks = findPeaks(rowCombined, minRowDist, 0.15);
    const colPeaks = findPeaks(colCombined, minColDist, 0.15);

    if (rowPeaks.length !== n || colPeaks.length !== n) continue;

    const rowScore = peakSpacingScore(rowPeaks);
    const colScore = peakSpacingScore(colPeaks);
    const conf = 0.35 * rowScore + 0.35 * colScore + 0.3 * (rowPeaks.length === colPeaks.length ? 1 : 0);

    if (!best || conf > best.confidence + 0.02) {
      best = { rows: n, cols: n, confidence: conf };
    }
  }

  return best;
}

function inferGridDimensions(
  blobs: Blob[]
): { rows: number; cols: number } | null {
  // Work with tile-filtered blobs; fall through to all blobs if too few
  let tiles = filterTileLikeBlobs(filterMainCluster(blobs));
  if (tiles.length < 4) tiles = filterMainCluster(blobs).slice(0, 40);
  if (tiles.length < 4) return null;

  const cellH = median(tiles.map((t) => t.h)) || 1;
  const cellW = median(tiles.map((t) => t.w)) || 1;

  // Tolerance: 55% of median cell dimension absorbs inter-tile gaps and
  // slight size variance while still separating distinct rows/columns.
  const rowCenters = cluster1D(tiles.map((t) => t.cy), cellH * 0.55);
  const colCenters = cluster1D(tiles.map((t) => t.cx), cellW * 0.55);

  const r = rowCenters.length;
  const c = colCenters.length;
  if (r < 3 || r > 7 || c < 3 || c > 7) return null;
  return { rows: r, cols: c };
}

// ─────────────────────────────────────────────────────────────────────────────
// Grid validation: score how well a candidate's cell centres align with blobs
// Penalises hallucinated rows/columns (cells with no supporting blob nearby).
// ─────────────────────────────────────────────────────────────────────────────
function gridCoverage(candidate: GridCandidate, blobs: Blob[]): number {
  if (!blobs.length) return 0;
  const activeCells = candidate.cells.flat().filter((c) => c.active);
  if (!activeCells.length) return 0;
  const cellSizeApprox = median(activeCells.map((c) => (c.w + c.h) / 2)) || 1;
  const matchDist = cellSizeApprox * 0.45;
  let covered = 0;
  for (const cell of activeCells) {
    const cx = cell.x + cell.w / 2;
    const cy = cell.y + cell.h / 2;
    if (blobs.some((b) => Math.hypot(b.cx - cx, b.cy - cy) < matchDist)) covered++;
  }
  return covered / activeCells.length;
}

/** Evenly split the puzzle bounding box (dark / merged tile detection). */
function buildGridFromBlobBounds(
  blobs: Blob[],
  rows: number,
  cols: number
): GridCandidate | null {
  const tiles = filterTileLikeBlobs(filterMainCluster(blobs));
  if (tiles.length < 4) return null;

  const pad = 4;
  const minX = Math.max(0, Math.min(...tiles.map((t) => t.x)) - pad);
  const minY = Math.max(0, Math.min(...tiles.map((t) => t.y)) - pad);
  const maxX = Math.max(...tiles.map((t) => t.x + t.w)) + pad;
  const maxY = Math.max(...tiles.map((t) => t.y + t.h)) + pad;
  const totalW = maxX - minX;
  const totalH = maxY - minY;
  if (totalW < 40 || totalH < 40) return null;

  const cellW = totalW / cols;
  const cellH = totalH / rows;
  const cells: CellRegion[][] = [];

  for (let r = 0; r < rows; r++) {
    const row: CellRegion[] = [];
    for (let c = 0; c < cols; c++) {
      row.push({
        x: Math.round(minX + c * cellW),
        y: Math.round(minY + r * cellH),
        w: Math.round(cellW),
        h: Math.round(cellH),
        active: true,
      });
    }
    cells.push(row);
  }

  return finalizeCandidate(
    {
      rows,
      cols,
      cells,
      confidence: 0.72,
      method: "uniform-bounds",
    },
    tiles.length
  );
}

/** Even grid split over the full frame when blob detection found no tiles. */
function buildUniformGridFromFrame(
  frameW: number,
  frameH: number,
  rows: number,
  cols: number,
  method: string
): GridCandidate {
  const cellW = frameW / cols;
  const cellH = frameH / rows;
  const cells: CellRegion[][] = [];
  for (let r = 0; r < rows; r++) {
    const row: CellRegion[] = [];
    for (let c = 0; c < cols; c++) {
      row.push({
        x: Math.round(c * cellW),
        y: Math.round(r * cellH),
        w: Math.round(cellW),
        h: Math.round(cellH),
        active: true,
      });
    }
    cells.push(row);
  }
  return finalizeCandidate(
    { rows, cols, cells, confidence: 0.55, method },
    rows * cols
  );
}

function buildGridFromTileBlobs(blobs: Blob[]): GridCandidate | null {
  const tiles = filterTileLikeBlobs(filterMainCluster(blobs));
  // Allow as few as 6 blobs — enough for a partial 4×4 or 3×3 detection
  if (tiles.length < 6) return null;

  const cellH = median(tiles.map((t) => t.h));
  const cellW = median(tiles.map((t) => t.w));
  const rowTol = cellH * 0.42;
  const colTol = cellW * 0.42;

  const rowCenters = cluster1D(
    tiles.map((t) => t.cy),
    rowTol
  );
  const colCenters = cluster1D(
    tiles.map((t) => t.cx),
    colTol
  );

  const rows = rowCenters.length;
  const cols = colCenters.length;
  if (rows < 3 || cols < 3 || rows > 7 || cols > 7) return null;

  const cells: CellRegion[][] = [];
  let matched = 0;

  for (let r = 0; r < rows; r++) {
    const row: CellRegion[] = [];
    for (let c = 0; c < cols; c++) {
      const tile = tiles.find(
        (t) =>
          Math.abs(t.cy - rowCenters[r]) < rowTol &&
          Math.abs(t.cx - colCenters[c]) < colTol
      );
      if (tile) {
        matched++;
        row.push({
          x: tile.x,
          y: tile.y,
          w: tile.w,
          h: tile.h,
          active: true,
        });
      } else {
        row.push({
          x: Math.round(colCenters[c] - cellW / 2),
          y: Math.round(rowCenters[r] - cellH / 2),
          w: Math.round(cellW),
          h: Math.round(cellH),
          active: false,
        });
      }
    }
    cells.push(row);
  }

  const total = rows * cols;
  const matchRatio = matched / total;
  const countMatch = Math.abs(matched - tiles.length) <= 2 ? 1 : 0.7;

  return finalizeCandidate(
    {
      rows,
      cols,
      cells,
      confidence:
        0.45 * matchRatio +
        0.35 * countMatch +
        0.2 * (rows === cols ? 1 : 0.85),
      method: "tiles",
    },
    tiles.length
  );
}

function buildCellsFromBands(
  rowBands: Band[],
  colBands: Band[],
  blobs: Blob[]
): GridCandidate {
  const rows = rowBands.length;
  const cols = colBands.length;
  const cells: CellRegion[][] = [];

  const cellW = median(colBands.map((b) => b.end - b.start));
  const cellH = median(rowBands.map((b) => b.end - b.start));
  const matchDist = Math.min(cellW, cellH) * 0.45;

  let matched = 0;
  for (let r = 0; r < rows; r++) {
    const row: CellRegion[] = [];
    for (let c = 0; c < cols; c++) {
      const band = {
        x: colBands[c].start,
        y: rowBands[r].start,
        w: colBands[c].end - colBands[c].start,
        h: rowBands[r].end - rowBands[r].start,
      };
      const cx = band.x + band.w / 2;
      const cy = band.y + band.h / 2;

      let best: Blob | null = null;
      let bestDist = Infinity;
      for (const blob of blobs) {
        const dist = Math.hypot(blob.cx - cx, blob.cy - cy);
        if (dist < bestDist && dist < matchDist) {
          bestDist = dist;
          best = blob;
        }
      }

      if (best) {
        matched++;
        row.push({
          x: best.x,
          y: best.y,
          w: best.w,
          h: best.h,
          active: true,
        });
      } else {
        row.push({ ...band, active: false });
      }
    }
    cells.push(row);
  }

  const total = rows * cols;
  const active = cells.flat().filter((c) => c.active).length;
  const fillRatio = active / total;
  const matchRatio = matched / Math.max(active, 1);
  const confidence =
    0.35 * Math.min(1, active / Math.max(9, total * 0.5)) +
    0.35 * matchRatio +
    0.3 * (rows >= 3 && cols >= 3 && rows <= 7 && cols <= 7 ? 1 : 0.5);

  return finalizeCandidate(
    {
      rows,
      cols,
      cells,
      confidence: confidence * (fillRatio > 0.35 ? 1 : 0.6),
      method: "projection",
    },
    blobs.length
  );
}

function buildCellsFromBlobs(blobs: Blob[]): GridCandidate | null {
  if (blobs.length < 6) return null;

  const sorted = [...blobs].sort((a, b) => a.cy - b.cy || a.cx - b.cx);
  const heights = sorted.map((b) => b.h);
  const widths = sorted.map((b) => b.w);
  const cellH = median(heights);
  const cellW = median(widths);
  const rowTol = cellH * 0.55;
  const colTol = cellW * 0.55;

  const rowGroups: Blob[][] = [];
  for (const blob of sorted) {
    const group = rowGroups.find(
      (g) => Math.abs(g[0].cy - blob.cy) <= rowTol
    );
    if (group) group.push(blob);
    else rowGroups.push([blob]);
  }
  rowGroups.sort((a, b) => a[0].cy - b[0].cy);
  for (const g of rowGroups) g.sort((a, b) => a.cx - b.cx);

  const rows = rowGroups.length;
  const cols = Math.max(...rowGroups.map((g) => g.length));

  if (rows < 3 || cols < 3 || rows > 7 || cols > 7) return null;

  const minX = Math.min(...blobs.map((b) => b.x));
  const minY = Math.min(...blobs.map((b) => b.y));

  const cells: CellRegion[][] = [];
  let activeCount = 0;

  for (let r = 0; r < rows; r++) {
    const row: CellRegion[] = [];
    for (let c = 0; c < cols; c++) {
      const expectedCx = minX + (c + 0.5) * cellW;
      const expectedCy = minY + (r + 0.5) * cellH;
      const blob = rowGroups[r]?.find(
        (b) =>
          Math.abs(b.cx - expectedCx) < colTol &&
          Math.abs(b.cy - expectedCy) < rowTol
      ) ?? blobs.find(
        (b) =>
          Math.abs(b.cx - expectedCx) < colTol &&
          Math.abs(b.cy - expectedCy) < rowTol
      );

      if (blob) {
        activeCount++;
        row.push({
          x: blob.x,
          y: blob.y,
          w: blob.w,
          h: blob.h,
          active: true,
        });
      } else {
        row.push({
          x: Math.round(minX + c * cellW),
          y: Math.round(minY + r * cellH),
          w: Math.round(cellW),
          h: Math.round(cellH),
          active: false,
        });
      }
    }
    cells.push(row);
  }

  const sizeConsistency =
    1 -
    Math.min(
      1,
      median(
        blobs.map((b) => Math.abs(b.w - cellW) / cellW + Math.abs(b.h - cellH) / cellH)
      ) / 2
    );

  const confidence =
    0.4 * Math.min(1, activeCount / (rows * cols)) +
    0.35 * sizeConsistency +
    0.25 * Math.min(1, blobs.length / (rows * cols));

  return finalizeCandidate(
    { rows, cols, cells, confidence, method: "blobs" },
    blobs.length
  );
}

function detectByProjection(
  gray: Float32Array,
  width: number,
  height: number,
  blobs: Blob[]
): GridCandidate | null {
  const rowVar = varianceProfile(gray, width, height, "row");
  const colVar = varianceProfile(gray, width, height, "col");
  const edges = sobelMagnitude(gray, width, height);
  const rowEdge = edgeProfile(edges, width, height, "row");
  const colEdge = edgeProfile(edges, width, height, "col");

  const rowCombined = new Float32Array(height);
  const colCombined = new Float32Array(width);
  for (let y = 0; y < height; y++) {
    rowCombined[y] = rowVar[y] * 0.65 + rowEdge[y] * 0.35;
  }
  for (let x = 0; x < width; x++) {
    colCombined[x] = colVar[x] * 0.65 + colEdge[x] * 0.35;
  }

  const tiles = filterTileLikeBlobs(filterMainCluster(blobs));
  const projDims = inferDimensionsFromProjection(gray, width, height);
  const blobRows =
    tiles.length >= 6
      ? cluster1D(
          tiles.map((t) => t.cy),
          median(tiles.map((t) => t.h)) * 0.42
        ).length
      : null;
  const blobCols =
    tiles.length >= 6
      ? cluster1D(
          tiles.map((t) => t.cx),
          median(tiles.map((t) => t.w)) * 0.42
        ).length
      : null;
  const estRows = blobRows ?? projDims?.rows ?? 0;
  const estCols = blobCols ?? projDims?.cols ?? 0;
  if (estRows < 3 || estCols < 3) return null;

  const estCellH = height / Math.max(estRows, 3);
  const estCellW = width / Math.max(estCols, 3);
  let rowPeaks = findPeaks(rowCombined, Math.max(8, Math.floor(estCellH * 0.55)));
  let colPeaks = findPeaks(colCombined, Math.max(8, Math.floor(estCellW * 0.55)));

  if (estRows >= 3 && estRows <= 7 && rowPeaks.length > estRows) {
    rowPeaks = trimPeaksToCount(rowPeaks, estRows);
  }
  if (estCols >= 3 && estCols <= 7 && colPeaks.length > estCols) {
    colPeaks = trimPeaksToCount(colPeaks, estCols);
  }

  if (rowPeaks.length < 3 || colPeaks.length < 3) return null;

  const rowBands = peaksToBands(rowPeaks, height);
  const colBands = peaksToBands(colPeaks, width);
  if (rowBands.length < 3 || colBands.length < 3) return null;

  return buildCellsFromBands(rowBands, colBands, blobs);
}

function refineCellsWithBlobs(
  candidate: GridCandidate,
  blobs: Blob[]
): GridCandidate {
  const cellW = median(candidate.cells[0]?.map((c) => c.w) ?? [40]);
  const cellH = median(candidate.cells.map((r) => r[0]?.h ?? 40));
  const matchDist = Math.min(cellW, cellH) * 0.5;
  let improved = 0;

  const cells = candidate.cells.map((row) =>
    row.map((cell) => {
      const cx = cell.x + cell.w / 2;
      const cy = cell.y + cell.h / 2;
      let best: Blob | null = null;
      let bestDist = Infinity;
      for (const blob of blobs) {
        const dist = Math.hypot(blob.cx - cx, blob.cy - cy);
        if (dist < bestDist && dist < matchDist) {
          bestDist = dist;
          best = blob;
        }
      }
      if (best) {
        improved++;
        return {
          x: best.x,
          y: best.y,
          w: best.w,
          h: best.h,
          active: true,
        };
      }
      if (!cell.active) return cell;
      const hasBlob = blobs.some((b) => Math.hypot(b.cx - cx, b.cy - cy) < matchDist);
      return { ...cell, active: hasBlob };
    })
  );

  return finalizeCandidate(
    {
      ...candidate,
      cells,
      confidence: candidate.confidence + Math.min(0.15, improved * 0.01),
      method: candidate.method + "+refine",
    },
    blobs.length
  );
}

function cropToPuzzleRegion(frame: ImageFrame, blobs: Blob[]): ImageFrame {
  if (blobs.length < 4) return frame;

  const pad = 12;
  const minX = Math.max(0, Math.min(...blobs.map((b) => b.x)) - pad);
  const minY = Math.max(0, Math.min(...blobs.map((b) => b.y)) - pad);
  const maxX = Math.min(frame.width, Math.max(...blobs.map((b) => b.x + b.w)) + pad);
  const maxY = Math.min(frame.height, Math.max(...blobs.map((b) => b.y + b.h)) + pad);
  const w = maxX - minX;
  const h = maxY - minY;

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(frame.canvas, minX, minY, w, h, 0, 0, w, h);
  return {
    canvas,
    width: w,
    height: h,
    data: ctx.getImageData(0, 0, w, h),
  };
}

function tileBlobScore(blobs: Blob[]): number {
  const tiles = filterTileLikeBlobs(filterMainCluster(blobs));
  const n = tiles.length;
  if (n < 9 || n > 49) return -1;
  const squareBonus = n >= 16 && n <= 36 ? 8 : 0;
  const nearestN = Math.round(Math.sqrt(n));
  const squareFit =
    Math.abs(n - nearestN * nearestN) <= 2 ? 5 + (nearestN === 4 ? 2 : 0) : 0;
  return n + squareBonus + squareFit;
}

function collectBlobs(frame: ImageFrame, theme: FrameTheme): Blob[] {
  const gray = toGrayscale(frame.data);
  // CLAHE-enhanced grayscale for letter-blob detection (improves faint text)
  const enhanced = claheGrayscale(gray, frame.width, frame.height);
  const blurred = boxBlur(enhanced, frame.width, frame.height, 2);

  // Gaussian adaptive threshold (3-pass box-blur ≈ Gaussian weighting) replaces
  // the flat box-blur mean threshold for letter blob candidates.
  const attempts = [
    gaussianAdaptiveThreshold(blurred, frame.width, frame.height, 10, 6),
    invertBinary(gaussianAdaptiveThreshold(blurred, frame.width, frame.height, 10, 6)),
    gaussianAdaptiveThreshold(blurred, frame.width, frame.height, 16, 10),
    invertBinary(gaussianAdaptiveThreshold(blurred, frame.width, frame.height, 16, 10)),
  ];

  if (theme === "dark") {
    attempts.push(
      gaussianAdaptiveThreshold(blurred, frame.width, frame.height, 28, 2),
      invertBinary(gaussianAdaptiveThreshold(blurred, frame.width, frame.height, 28, 2)),
      gaussianAdaptiveThreshold(blurred, frame.width, frame.height, 36, 5)
    );
  }

  let bestLetter: Blob[] = [];
  for (const binary of attempts) {
    const blobs = findLetterBlobs(binary, frame.width, frame.height);
    if (blobs.length > bestLetter.length) bestLetter = blobs;
  }

  // Colour/luminance threshold tile finders (existing methods)
  const darkTiles = filterMainCluster(findDarkTileBlobs(frame.data));
  const grayTiles = filterMainCluster(findGrayTileBlobs(frame.data));
  const colorTiles = filterMainCluster(findColoredTileBlobs(frame.data));
  const letterTiles = filterMainCluster(bestLetter);

  // New: edge-contour tiles (CLAHE → Canny → dilate → invert)
  // Works regardless of tile colour or contrast.
  const edgeTiles = filterMainCluster(findTilesByEdgeContours(frame.data));

  // New: saturation-channel tiles (HSV S fallback for coloured tiles on dark bg)
  const satTiles = filterMainCluster(findTilesBySaturation(frame.data));

  // Edge contours often segment letters, not tiles — only use on dark when they
  // form a plausible square grid (see below). On light boards always prefer gray/color tiles.
  let edgeScore = theme === "light" ? -1 : tileBlobScore(edgeTiles) + 1;
  if (theme === "dark") {
    const edgeDims = inferGridDimensions(edgeTiles);
    const edgeN = filterTileLikeBlobs(filterMainCluster(edgeTiles)).length;
    if (
      edgeDims &&
      edgeDims.rows === edgeDims.cols &&
      edgeN >= 12 &&
      edgeN <= 25
    ) {
      edgeScore = tileBlobScore(edgeTiles) + 10;
    }
  }

  const ranked = [
    {
      blobs: edgeTiles,
      score: edgeScore,
    },
    { blobs: darkTiles, score: tileBlobScore(darkTiles) + (theme === "dark" ? 12 : 0) },
    { blobs: grayTiles, score: tileBlobScore(grayTiles) + (theme === "light" ? 4 : 0) },
    { blobs: colorTiles, score: tileBlobScore(colorTiles) + 2 },
    {
      blobs: satTiles,
      score: theme === "dark" ? -1 : tileBlobScore(satTiles) + 1,
    },
    {
      blobs: letterTiles,
      score: theme === "dark" ? -1 : tileBlobScore(letterTiles),
    },
  ].sort((a, b) => b.score - a.score);

  const winner = ranked[0];
  if (winner.score > 0) {
    if (theme === "light" && tileBlobScore(grayTiles) > 0) {
      return grayTiles;
    }
    return winner.blobs;
  }

  // All scored methods failed — try saturation then edge as last-resort fallbacks
  if (satTiles.length >= 6) return satTiles;
  if (edgeTiles.length >= 6) return edgeTiles;

  const fallback = [edgeTiles, darkTiles, grayTiles, colorTiles, satTiles, letterTiles].sort(
    (a, b) => b.length - a.length
  )[0];
  return fallback.length >= 6 ? fallback : [...fallback, ...grayTiles];
}

function computeBounds(cells: CellRegion[][]): GridDetection["bounds"] {
  const active = cells.flat().filter((c) => c.active);
  if (!active.length) {
    return { x: 0, y: 0, w: 0, h: 0 };
  }
  const x = Math.min(...active.map((c) => c.x));
  const y = Math.min(...active.map((c) => c.y));
  const x2 = Math.max(...active.map((c) => c.x + c.w));
  const y2 = Math.max(...active.map((c) => c.y + c.h));
  return { x, y, w: x2 - x, h: y2 - y };
}

function pickBest(candidates: GridCandidate[]): GridCandidate | null {
  const valid = candidates.filter((c) => c.confidence > 0.25);
  if (!valid.length) return null;
  return valid.sort((a, b) => b.confidence - a.confidence)[0];
}

export async function detectGridLayout(
  imageSrc: string,
  hintSize?: number
): Promise<GridDetection> {
  const fullFrame = await loadImageFrame(imageSrc);
  const theme = estimateFrameTheme(fullFrame.data);
  let blobs = collectBlobs(fullFrame, theme);
  let frame = cropToPuzzleRegion(fullFrame, blobs);

  blobs = collectBlobs(frame, theme);
  const gray = toGrayscale(frame.data);

  const candidates: GridCandidate[] = [];
  const tileCount = filterTileLikeBlobs(blobs).length;

  // ─── Letter-blob primary detector ───
  // Color-scheme-agnostic: works on any tile color/border style as long as
  // letters are readable. When the layout is grid-like, this is the most
  // reliable source of dimensions and cell positions.
  const robustLetters = findLetterBlobsRobust(frame.data);
  let lettersGrid: ReturnType<typeof inferGridFromLetterBlobs> | null = null;
  let lettersCandidate: GridCandidate | null = null;
  if (robustLetters.blobs.length >= 9) {
    lettersGrid = inferGridFromLetterBlobs(
      robustLetters.blobs,
      frame.width,
      frame.height
    );
    if (lettersGrid && lettersGrid.rows >= 3 && lettersGrid.cols >= 3) {
      const sizeOk =
        lettersGrid.rows === lettersGrid.cols &&
        lettersGrid.rows >= 3 &&
        lettersGrid.rows <= 7;
      const fillBonus = Math.min(0.15, lettersGrid.fillRatio * 0.18);
      lettersCandidate = finalizeCandidate(
        {
          rows: lettersGrid.rows,
          cols: lettersGrid.cols,
          cells: lettersGrid.cells,
          confidence: 0.78 + fillBonus + (sizeOk ? 0.05 : 0),
          method: "letters",
        },
        robustLetters.blobs.length
      );
      candidates.push(lettersCandidate);
    }
  }

  const tileGrid = buildGridFromTileBlobs(blobs);
  if (tileGrid) candidates.push(tileGrid);

  // The letters method is the most reliable dimension signal across color
  // schemes, but its cell bounds aren't always pixel-tight to the tile (they
  // come from cluster pitch, not tile blobs). So we only force letters to
  // win — over the cleaner per-tile bounds — when tile detection found
  // nothing useful for this image.
  if (lettersCandidate && lettersGrid) {
    const tileBlobCount = filterTileLikeBlobs(blobs).length;
    const sizeOk =
      lettersGrid.rows === lettersGrid.cols &&
      lettersGrid.rows >= 3 &&
      lettersGrid.rows <= 7;
    const authoritative =
      sizeOk &&
      lettersGrid.fillRatio >= 0.85 &&
      robustLetters.blobs.length >= lettersGrid.rows * lettersGrid.cols * 0.85 &&
      // Defer to tile-based detection when it produced a matching-size grid;
      // override only when tile detection failed to find consistent tiles.
      (!tileGrid ||
        tileBlobCount < lettersGrid.rows * lettersGrid.cols * 0.5 ||
        (tileGrid.rows !== lettersGrid.rows ||
          tileGrid.cols !== lettersGrid.cols));
    if (authoritative) {
      // Out-of-band score (>1.0) so post-hoc bonuses on other candidates
      // can't overtake the authoritative letter-cluster grid.
      lettersCandidate.confidence = 1.6;
    }
  }

  const clusteredDims = inferGridDimensions(blobs);
  const projDims = inferDimensionsFromProjection(
    gray,
    frame.width,
    frame.height
  );

  const sizesToTry = new Set<number>();
  if (hintSize && hintSize >= 3 && hintSize <= 7) sizesToTry.add(hintSize);
  if (projDims && projDims.confidence > 0.35) sizesToTry.add(projDims.rows);
  if (clusteredDims && clusteredDims.rows === clusteredDims.cols) {
    sizesToTry.add(clusteredDims.rows);
  }
  if (tileCount >= 9 && tileCount <= 49) {
    sizesToTry.add(Math.round(Math.sqrt(tileCount)));
  }
  for (const s of [4, 5, 6]) sizesToTry.add(s);
  if (hintSize && hintSize >= 3 && hintSize <= 7) sizesToTry.add(hintSize);

  for (const size of sizesToTry) {
    const uniformBounds = buildGridFromBlobBounds(blobs, size, size);
    const uniformFrame = buildUniformGridFromFrame(
      frame.width,
      frame.height,
      size,
      size,
      "uniform-frame"
    );
    const base = uniformBounds ?? uniformFrame;
    const coverage = gridCoverage(base, blobs);
    const sparsePenalty = coverage < 0.25 && blobs.length >= 6 ? -0.2 : 0;
    const projBonus =
      projDims &&
      projDims.rows === size &&
      projDims.cols === size &&
      projDims.confidence > 0.35
        ? projDims.confidence * 0.35
        : 0;
    const clusterBonus =
      clusteredDims &&
      clusteredDims.rows === size &&
      clusteredDims.cols === size
        ? 0.12
        : 0;
    const tileMatchBonus =
      size * size >= tileCount - 3 && size * size <= tileCount + 3
        ? 0.1
        : 0;
    const wrongSizePenalty =
      projDims &&
      projDims.confidence > 0.4 &&
      projDims.rows !== size
        ? -0.25
        : 0;

    candidates.push({
      ...base,
      confidence:
        base.confidence +
        coverage * 0.25 +
        projBonus +
        clusterBonus +
        tileMatchBonus +
        sparsePenalty +
        wrongSizePenalty +
        (theme === "dark" && uniformBounds ? 0.08 : 0),
      method: (uniformBounds ? base.method : "uniform-frame") +
        (theme === "dark" ? "+dark" : ""),
    });
  }

  const projection = detectByProjection(gray, frame.width, frame.height, blobs);
  if (projection) candidates.push(refineCellsWithBlobs(projection, blobs));

  const blobGrid = buildCellsFromBlobs(blobs);
  if (blobGrid) candidates.push(refineCellsWithBlobs(blobGrid, blobs));

  if (tileCount >= 9 && tileCount <= 49) {
    for (const c of candidates) {
      const active = c.cells.flat().filter((cell) => cell.active).length;
      if (c.rows === c.cols && Math.abs(active - tileCount) <= 3) {
        c.confidence += 0.12;
      }
      if (c.rows !== c.cols) {
        c.confidence -= 0.15;
      }
    }
  }

  if (hintSize && hintSize >= 3 && hintSize <= 7) {
    // The hint is an explicit user choice — treat it as authoritative.
    // Heavily boost matching candidates and penalize differing-size ones so a
    // weakly-detected hint-sized grid still wins over a confidently-detected
    // wrong-sized grid (e.g. 3×3 winning when user picked 5×5 on a small
    // dark-theme image where projection peaks are noisy).
    for (const c of candidates) {
      if (c.rows === hintSize && c.cols === hintSize) {
        c.confidence += 0.6;
      } else if (
        Math.abs(c.rows - hintSize) <= 1 &&
        Math.abs(c.cols - hintSize) <= 1
      ) {
        c.confidence -= 0.2;
      } else {
        c.confidence -= 0.5;
      }
    }
  }

  const tileCandidate = candidates.find((c) => c.method.startsWith("tiles"));
  if (tileCandidate && tileCandidate.rows === tileCandidate.cols) {
    const n = tileCandidate.rows;
    const filled =
      tileCandidate.cells.flat().filter((c) => c.active).length / (n * n);
    const cellW = median(
      tileCandidate.cells.flat().map((c) => c.w).filter((w) => w > 0)
    );
    const minTileW = frame.width / (n + 1.2);
    const cellsAreTileSized = cellW >= minTileW * 0.5;
    if (filled >= 0.72 && cellsAreTileSized) {
      tileCandidate.confidence += 0.45;
      for (const c of candidates) {
        if (c.method.startsWith("tiles")) continue;
        if (c.rows !== n || c.cols !== n) c.confidence -= 0.35;
      }
    }
  }

  let best = pickBest(candidates);

  if (!best) {
    const size =
      hintSize ??
      (projDims && projDims.confidence > 0.3 ? projDims.rows : null) ??
      (clusteredDims && clusteredDims.rows === clusteredDims.cols
        ? clusteredDims.rows
        : null) ??
      5;
    best = buildUniformGridFromFrame(
      frame.width,
      frame.height,
      size,
      size,
      "fallback-uniform"
    );
    best = { ...best, confidence: 0.2 };
  }

  const cells = ensurePlayableCells(best.cells, best.rows, best.cols);

  return {
    rows: best.rows,
    cols: best.cols,
    cells,
    bounds: computeBounds(cells),
    confidence: Math.min(1, best.confidence),
    method: best.method,
    theme,
    frame,
  };
}

/** Grey/faded Squaredle tiles are still letters — only corner-cut slots stay empty */
function ensurePlayableCells(
  cells: CellRegion[][],
  rows: number,
  cols: number
): CellRegion[][] {
  const total = rows * cols;
  const active = cells.flat().filter((c) => c.active).length;
  const missing = total - active;

  if (missing <= 0) return cells;

  const isCornerCut =
    rows === 5 &&
    cols === 5 &&
    missing >= 1 &&
    missing <= 4 &&
    !cells[0]?.[0]?.active &&
    !cells[0]?.[4]?.active;

  if (!isCornerCut && missing <= Math.max(4, Math.floor(total * 0.2))) {
    return cells.map((row) => row.map((cell) => ({ ...cell, active: true })));
  }
  return cells;
}
