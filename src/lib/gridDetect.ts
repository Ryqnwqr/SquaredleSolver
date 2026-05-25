import {
  adaptiveThreshold,
  boxBlur,
  cluster1D,
  edgeProfile,
  findColoredTileBlobs,
  findGrayTileBlobs,
  findLetterBlobs,
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

function buildGridFromTileBlobs(blobs: Blob[]): GridCandidate | null {
  const tiles = filterTileLikeBlobs(filterMainCluster(blobs));
  if (tiles.length < 9) return null;

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
  const estRows =
    tiles.length >= 9
      ? cluster1D(
          tiles.map((t) => t.cy),
          median(tiles.map((t) => t.h)) * 0.42
        ).length
      : Math.round(height / (height / 5));
  const estCols =
    tiles.length >= 9
      ? cluster1D(
          tiles.map((t) => t.cx),
          median(tiles.map((t) => t.w)) * 0.42
        ).length
      : Math.round(width / (width / 5));

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

function collectBlobs(frame: ImageFrame): Blob[] {
  const gray = toGrayscale(frame.data);
  const blurred = boxBlur(gray, frame.width, frame.height, 2);

  const attempts = [
    adaptiveThreshold(blurred, frame.width, frame.height, 10, 6),
    invertBinary(adaptiveThreshold(blurred, frame.width, frame.height, 10, 6)),
    adaptiveThreshold(blurred, frame.width, frame.height, 16, 10),
    invertBinary(adaptiveThreshold(blurred, frame.width, frame.height, 16, 10)),
  ];

  let best: Blob[] = [];
  for (const binary of attempts) {
    const blobs = findLetterBlobs(binary, frame.width, frame.height);
    if (blobs.length > best.length) best = blobs;
  }

  const grayTiles = findGrayTileBlobs(frame.data);
  const colorTiles = findColoredTileBlobs(frame.data);

  const tileCandidates = [grayTiles, colorTiles, best].sort(
    (a, b) => b.length - a.length
  );
  const top = filterMainCluster(tileCandidates[0]);
  if (top.length >= 16 && top.length <= 36) return top;
  if (grayTiles.length >= 9) return filterMainCluster(grayTiles);
  if (colorTiles.length >= 9) return filterMainCluster(colorTiles);
  return filterMainCluster(best.length >= 6 ? best : [...best, ...grayTiles]);
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
  let blobs = collectBlobs(fullFrame);
  let frame = cropToPuzzleRegion(fullFrame, blobs);

  blobs = collectBlobs(frame);
  const gray = toGrayscale(frame.data);

  const candidates: GridCandidate[] = [];
  const tileCount = filterTileLikeBlobs(blobs).length;

  const tileGrid = buildGridFromTileBlobs(blobs);
  if (tileGrid) candidates.push(tileGrid);

  const projection = detectByProjection(gray, frame.width, frame.height, blobs);
  if (projection) candidates.push(refineCellsWithBlobs(projection, blobs));

  const blobGrid = buildCellsFromBlobs(blobs);
  if (blobGrid) candidates.push(refineCellsWithBlobs(blobGrid, blobs));

  if (tileCount >= 16 && tileCount <= 36) {
    for (const c of candidates) {
      const active = c.cells.flat().filter((cell) => cell.active).length;
      if (c.rows === c.cols && Math.abs(active - tileCount) <= 3) {
        c.confidence += 0.12;
      }
      if (
        (c.rows === 6 && c.cols === 5) ||
        (c.rows === 5 && c.cols === 6) ||
        c.rows !== c.cols && tileCount === 25
      ) {
        c.confidence -= 0.2;
      }
    }
  }

  if (hintSize && hintSize >= 3 && hintSize <= 7) {
    for (const c of candidates) {
      if (
        c.rows === hintSize &&
        c.cols === hintSize
      ) {
        c.confidence += 0.1;
      } else if (Math.abs(c.rows - hintSize) <= 1 && Math.abs(c.cols - hintSize) <= 1) {
        c.confidence += 0.04;
      }
    }
  }

  for (const c of candidates) {
    if (c.rows === 5 && c.cols === 5) {
      const corners = [
        c.cells[0]?.[0],
        c.cells[0]?.[4],
        c.cells[4]?.[0],
        c.cells[4]?.[4],
      ];
      const missingCorners = corners.filter((cell) => cell && !cell.active).length;
      if (missingCorners >= 2 && missingCorners <= 4) {
        c.confidence += 0.06;
      }
    }
  }

  let best = pickBest(candidates);

  if (!best) {
    const size = hintSize ?? 4;
    const cell = Math.min(frame.width, frame.height) / size;
    const cells: CellRegion[][] = Array.from({ length: size }, (_, r) =>
      Array.from({ length: size }, (_, c) => ({
        x: Math.round(c * cell),
        y: Math.round(r * cell),
        w: Math.round(cell),
        h: Math.round(cell),
        active: true,
      }))
    );
    best = {
      rows: size,
      cols: size,
      cells,
      confidence: 0.2,
      method: "fallback-uniform",
    };
  }

  const cells = ensurePlayableCells(best.cells, best.rows, best.cols);

  return {
    rows: best.rows,
    cols: best.cols,
    cells,
    bounds: computeBounds(cells),
    confidence: Math.min(1, best.confidence),
    method: best.method,
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
