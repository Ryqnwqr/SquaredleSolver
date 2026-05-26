export interface ShapeMetrics {
  w: number;
  h: number;
  aspect: number;
  symmetry: number;
  leftHalfRatio: number;
  rightHalfRatio: number;
  midRowRightRatio: number;
  hasMiddleBar: boolean;
  isRound: boolean;
  /** Ink spanning middle row (E has wide middle bar) */
  midRowSpan: number;
  /** Ink in bottom-right quadrant (R leg) */
  bottomRightRatio: number;
  /** Ink in bottom-left quadrant (symmetric with bottomRight for O; low for R) */
  bottomLeftRatio: number;
  /** Ink in top-right quadrant (P/R bowl) */
  topRightRatio: number;
  topBand: number;
  midBand: number;
  botBand: number;
}

function isInkPixel(
  data: Uint8ClampedArray,
  width: number,
  x: number,
  y: number,
  threshold: number,
  darkBg: boolean
): boolean {
  const i = (y * width + x) * 4;
  const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  return darkBg ? gray > threshold : gray < threshold;
}

export function analyzeShape(canvas: HTMLCanvasElement): ShapeMetrics | null {
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const { width, height } = canvas;
  const { data } = ctx.getImageData(0, 0, width, height);

  // Determine background polarity by sampling the middle 50% of each border edge.
  // We skip corners because maskCornerHints() fills them with white even on
  // inverted (dark-background) variants, which would skew the average.
  const midLo = Math.floor(width * 0.25);
  const midHi = Math.floor(width * 0.75);
  const midLoY = Math.floor(height * 0.25);
  const midHiY = Math.floor(height * 0.75);
  let borderSum = 0;
  let borderCount = 0;
  for (let x = midLo; x <= midHi; x++) {
    for (const y of [0, height - 1]) {
      const i = (y * width + x) * 4;
      borderSum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      borderCount++;
    }
  }
  for (let y = midLoY; y <= midHiY; y++) {
    for (const x of [0, width - 1]) {
      const i = (y * width + x) * 4;
      borderSum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      borderCount++;
    }
  }
  const borderAvg = borderCount > 0 ? borderSum / borderCount : 128;
  const darkBg = borderAvg < 80;
  const inkThreshold = darkBg ? 128 : 165;

  const colCounts = new Array<number>(width).fill(0);
  const rowCounts = new Array<number>(height).fill(0);
  let minX = width;
  let maxX = 0;
  let minY = height;
  let maxY = 0;
  let ink = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (isInkPixel(data, width, x, y, inkThreshold, darkBg)) {
        ink++;
        colCounts[x]++;
        rowCounts[y]++;
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }
  }

  if (ink < 20 || maxX <= minX || maxY <= minY) return null;

  // ── Bbox refinement: trim noise pockets disconnected from the main letter
  // mass. Cells from uniform-bounds detection can include slivers of adjacent
  // tile borders or shadows that wildly extend the bbox (e.g. a thin "I"
  // ending up with aspect=0.9 because of right-side noise). We walk outward
  // from the densest column/row and stop when we hit a wide gap, treating
  // anything beyond as unrelated noise.
  {
    let densestCol = minX;
    let densestColCount = 0;
    for (let x = minX; x <= maxX; x++) {
      if (colCounts[x] > densestColCount) {
        densestColCount = colCounts[x];
        densestCol = x;
      }
    }
    let densestRow = minY;
    let densestRowCount = 0;
    for (let y = minY; y <= maxY; y++) {
      if (rowCounts[y] > densestRowCount) {
        densestRowCount = rowCounts[y];
        densestRow = y;
      }
    }
    const colThresh = Math.max(2, densestColCount * 0.05);
    const rowThresh = Math.max(2, densestRowCount * 0.05);
    const maxGap = Math.max(3, Math.floor((maxX - minX + 1) * 0.12));

    let nMaxX = densestCol;
    let gap = 0;
    for (let x = densestCol + 1; x <= maxX; x++) {
      if (colCounts[x] >= colThresh) {
        nMaxX = x;
        gap = 0;
      } else if (++gap > maxGap) break;
    }
    let nMinX = densestCol;
    gap = 0;
    for (let x = densestCol - 1; x >= minX; x--) {
      if (colCounts[x] >= colThresh) {
        nMinX = x;
        gap = 0;
      } else if (++gap > maxGap) break;
    }
    let nMaxY = densestRow;
    gap = 0;
    const maxRowGap = Math.max(3, Math.floor((maxY - minY + 1) * 0.12));
    for (let y = densestRow + 1; y <= maxY; y++) {
      if (rowCounts[y] >= rowThresh) {
        nMaxY = y;
        gap = 0;
      } else if (++gap > maxRowGap) break;
    }
    let nMinY = densestRow;
    gap = 0;
    for (let y = densestRow - 1; y >= minY; y--) {
      if (rowCounts[y] >= rowThresh) {
        nMinY = y;
        gap = 0;
      } else if (++gap > maxRowGap) break;
    }
    // Only apply refinement if it actually shrinks the bbox meaningfully and
    // still leaves a substantial letter; otherwise leave original bbox alone.
    if (
      nMaxX - nMinX + 1 >= 6 &&
      nMaxY - nMinY + 1 >= 6 &&
      (nMaxX - nMinX < (maxX - minX) * 0.9 ||
        nMaxY - nMinY < (maxY - minY) * 0.9)
    ) {
      minX = nMinX;
      maxX = nMaxX;
      minY = nMinY;
      maxY = nMaxY;
      // Recount ink inside the refined bbox so leftInk/rightInk/etc. below
      // reflect the trimmed region.
      ink = 0;
      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
          if (isInkPixel(data, width, x, y, inkThreshold, darkBg)) ink++;
        }
      }
      if (ink < 20) return null;
    }
  }

  const w = maxX - minX + 1;
  const h = maxY - minY + 1;
  const midX = (minX + maxX) / 2;
  const midY = Math.floor((minY + maxY) / 2);
  const topY = minY + Math.floor(h * 0.22);
  const botY = maxY - Math.floor(h * 0.22);

  let leftInk = 0;
  let rightInk = 0;
  let topRightInk = 0;
  let bottomRightInk = 0;
  let bottomLeftInk = 0;
  const brX0 = minX + Math.floor(w * 0.55);
  const brY0 = minY + Math.floor(h * 0.55);
  const trX0 = minX + Math.floor(w * 0.45);
  const trY1 = minY + Math.floor(h * 0.45);

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      if (!isInkPixel(data, width, x, y, inkThreshold, darkBg)) continue;
      if (x < midX) leftInk++;
      else rightInk++;
      if (x >= trX0 && y <= trY1) topRightInk++;
      if (x >= brX0 && y >= brY0) bottomRightInk++;
      if (x < brX0 && y >= brY0) bottomLeftInk++;
    }
  }

  const rowInkAt = (y: number) => {
    let left = 0;
    let right = 0;
    let span = 0;
    let firstX = -1;
    let lastX = -1;
    const split = minX + w * 0.55;
    const rightStart = maxX - w * 0.28;
    for (let x = minX; x <= maxX; x++) {
      if (!isInkPixel(data, width, x, y, inkThreshold, darkBg)) continue;
      span++;
      if (firstX < 0) firstX = x;
      lastX = x;
      if (x < split) left++;
      else if (x > rightStart) right++;
    }
    const total = left + right + 0.001;
    const rowSpan = span > 0 && firstX >= 0 ? (lastX - firstX + 1) / w : 0;
    return { left, right, rightRatio: right / total, rowSpan };
  };

  const midRow = rowInkAt(midY);
  const topRow = rowInkAt(topY);
  const botRow = rowInkAt(botY);

  const bandScore = (y: number) => {
    const r = rowInkAt(y);
    return r.left / (w * 0.55);
  };

  const topBand = bandScore(topY);
  const midBand = bandScore(midY);
  const botBand = bandScore(botY);

  const totalInk = leftInk + rightInk || 1;
  const symmetry = 1 - Math.abs(leftInk - rightInk) / totalInk;

  const hasMiddleBar =
    midRow.rowSpan > 0.42 &&
    midRow.left > 4 &&
    midRow.right < midRow.left * 0.5 &&
    topRow.left > 3 &&
    botRow.left > 3;

  const aspect = h / w;
  const blrRatio = bottomLeftInk / (bottomRightInk + 0.001);
  // O/squircle: symmetric bottom corners; R has a diagonal leg → asymmetric bottom
  const bottomSymmetric =
    bottomLeftInk / ink > 0.05 &&
    bottomRightInk / ink > 0.05 &&
    blrRatio > 0.52 &&
    blrRatio < 0.78;
  const isRound =
    aspect > 0.72 &&
    aspect < 1.45 &&
    symmetry > 0.68 &&
    !hasMiddleBar &&
    midRow.rowSpan < 0.38 &&
    bottomSymmetric;

  return {
    w,
    h,
    aspect,
    symmetry,
    leftHalfRatio: leftInk / totalInk,
    rightHalfRatio: rightInk / totalInk,
    midRowRightRatio: midRow.rightRatio,
    hasMiddleBar,
    isRound,
    midRowSpan: midRow.rowSpan,
    bottomRightRatio: bottomRightInk / ink,
    bottomLeftRatio: bottomLeftInk / ink,
    topRightRatio: topRightInk / ink,
    topBand,
    midBand,
    botBand,
  };
}

/** R has a leg or stem+bowl; squircle O does not. */
export function hasRLeg(m: ShapeMetrics): boolean {
  const blr = m.bottomLeftRatio;
  const brr = m.bottomRightRatio;
  // Highly symmetric letters with balanced bottom-corner ink are almost
  // always O/D, not R — even if mid-row appears column-heavy (which can
  // happen on a clipped O where the right loop is faded below threshold).
  if (
    m.symmetry > 0.93 &&
    blr > 0.18 &&
    brr > 0.18 &&
    Math.abs(brr - blr) < 0.08
  ) {
    return false;
  }
  if (brr > 0.095 && brr > blr * 1.22) return true;
  if (
    m.leftHalfRatio > 0.4 &&
    m.topRightRatio > 0.09 &&
    m.midRowRightRatio < 0.22 &&
    brr > 0.07
  ) {
    return true;
  }
  if (
    m.leftHalfRatio > 0.38 &&
    m.midRowSpan < 0.42 &&
    !m.hasMiddleBar &&
    brr > blr + 0.035 &&
    brr > 0.08
  ) {
    return true;
  }
  return false;
}

export function scoreO(m: ShapeMetrics): number {
  if (hasRLeg(m)) {
    let s = 0;
    if (m.symmetry > 0.88) s += 0.12;
    return Math.min(0.32, s);
  }
  let s = 0;
  if (m.isRound) s += 0.45;
  if (m.symmetry > 0.72) s += 0.25;
  if (!m.hasMiddleBar) s += 0.2;
  if (m.midRowRightRatio > 0.18) s += 0.15;
  if (m.midRowSpan < 0.35) s += 0.1;
  if (m.bottomRightRatio < 0.08 && m.symmetry > 0.58) s += 0.22;
  if (m.bottomRightRatio < 0.12 && !m.hasMiddleBar) s += 0.28;
  // O is closed/symmetric: bottom-left ≈ bottom-right; R has leg only on right
  const blr = m.bottomLeftRatio;
  const brr = m.bottomRightRatio;
  if (blr > 0.06 && brr > 0.06 && blr / (brr + 0.001) > 0.55) s += 0.35;
  return Math.min(1, s);
}

export function scoreE(m: ShapeMetrics): number {
  if (m.midRowSpan < 0.32) return 0;
  if (
    m.topRightRatio > 0.1 &&
    m.bottomRightRatio < 0.11 &&
    m.midRowSpan < 0.42 &&
    !m.hasMiddleBar
  ) {
    return 0;
  }
  let s = 0;
  if (m.hasMiddleBar) s += 0.4;
  if (m.midBand > 0.28 && m.topBand > 0.22 && m.botBand > 0.22) s += 0.3;
  if (m.midRowSpan > 0.4) s += 0.22;
  if (m.bottomRightRatio < 0.09 && m.midRowSpan > 0.38) s += 0.15;
  if (m.bottomRightRatio < 0.12 && m.midRowSpan > 0.36) s += 0.25;
  if (m.leftHalfRatio > 0.5) s += 0.1;
  if (m.bottomRightRatio < 0.12) s += 0.05;
  return Math.min(1, s);
}

export function scoreP(m: ShapeMetrics): number {
  let s = 0;
  if (m.leftHalfRatio > 0.35 && m.topRightRatio > 0.08) s += 0.4;
  if (m.bottomRightRatio < 0.12) s += 0.3;
  if (m.midRowSpan < 0.38 && m.midRowSpan > 0.12) s += 0.2;
  if (!m.hasMiddleBar) s += 0.15;
  if (m.topBand > 0.25 && m.midBand < 0.32) s += 0.1;
  return Math.min(1, s);
}

export function scoreR(m: ShapeMetrics): number {
  const blr = m.bottomLeftRatio;
  const brr = m.bottomRightRatio;
  const bottomSymmetric = blr > 0.06 && brr > 0.06 && blr / (brr + 0.001) > 0.55;
  if (bottomSymmetric && !m.hasMiddleBar && m.symmetry > 0.9 && !hasRLeg(m)) {
    return 0.15;
  }
  if (brr < 0.08 && !hasRLeg(m)) return 0.1;
  let s = 0;
  if (hasRLeg(m)) s += 0.35;
  if (m.leftHalfRatio > 0.32 && m.topRightRatio > 0.08) s += 0.25;
  if (brr > 0.08) s += 0.4;
  if (m.midRowRightRatio < 0.24 && m.leftHalfRatio > 0.36) s += 0.2;
  if (m.midRowSpan < 0.4) s += 0.15;
  if (!m.hasMiddleBar || m.midRowSpan < 0.35) s += 0.1;
  if (m.botBand > 0.15 && brr > 0.08) s += 0.15;
  return Math.min(1, s);
}

export function scoreI(m: ShapeMetrics): number {
  if (m.aspect > 1.85 && m.w < 55) return 0.85;
  if (m.aspect > 1.55 && m.midRowSpan < 0.2) return 0.65;
  if (m.hasMiddleBar) return 0;
  if (m.aspect > 1.2 && m.midRowSpan < 0.3) {
    let s = 0.48;
    if (m.midRowSpan < 0.22) s += 0.12;
    if (m.midBand < 0.38) s += 0.1;
    if (Math.abs(m.topBand - m.botBand) < 0.22) s += 0.12;
    if (m.leftHalfRatio > 0.4 && m.leftHalfRatio < 0.78) s += 0.08;
    return Math.min(0.82, s);
  }
  return 0;
}

export function scoreB(m: ShapeMetrics): number {
  if (m.hasMiddleBar && m.midRowSpan > 0.4) return 0.05;
  if (m.aspect > 1.45 && m.midRowSpan < 0.24) return 0.08;
  if (m.aspect >= 0.75 && m.aspect <= 2.1 && m.leftHalfRatio > 0.35) {
    return m.topRightRatio > 0.15 ? 0.6 : 0.35;
  }
  return 0;
}

const SHAPE_LETTERS = [
  "O",
  "E",
  "P",
  "R",
  "I",
  "B",
] as const;

export function shapePrior(letter: string, m: ShapeMetrics): number {
  switch (letter) {
    case "O":
      return scoreO(m);
    case "E":
      return scoreE(m);
    case "P":
      return scoreP(m);
    case "R":
      return scoreR(m);
    case "I":
      return scoreI(m);
    case "B":
      return scoreB(m);
    default:
      return 0.1;
  }
}

function pickBestShape(m: ShapeMetrics, candidates?: string[]): string {
  const pool = candidates ?? [...SHAPE_LETTERS];
  const ranked = pool
    .map((letter) => ({ letter, score: shapePrior(letter, m) }))
    .sort((a, b) => b.score - a.score);
  return ranked[0]?.letter ?? "";
}

/** On dark boards OCR often returns O for R (squircle font) — use leg/stem shape. */
export function resolveDarkAmbiguousO(
  ocrLetter: string,
  metrics: ShapeMetrics
): string {
  if (ocrLetter !== "O") return ocrLetter;
  if (!hasRLeg(metrics)) return "O";
  const r = scoreR(metrics);
  const o = scoreO(metrics);
  if (r >= o - 0.06 || r > 0.42) return "R";
  return "O";
}

/** Tesseract R votes above this are trusted; shape-only guesses are ~65. */
export const TESSERACT_CONFIDENT_VOTE = 150;

export function voteTotal(
  votes: Array<{ letter: string; weight: number }>,
  letter: string
): number {
  let sum = 0;
  for (const v of votes) {
    if (v.letter === letter) sum += v.weight;
  }
  return sum;
}

/** On dark boards OCR often returns R for O/E — pick by shape when ambiguous. */
export function resolveDarkAmbiguousR(
  ocrLetter: string,
  metrics: ShapeMetrics
): string {
  if (ocrLetter !== "R") return ocrLetter;
  const br = metrics.bottomRightRatio;
  const rShape = scoreR(metrics);

  if (br > 0.155 && rShape > 0.58) return "R";

  const ranked = (["O", "E", "R"] as const)
    .map((letter) => ({ letter, score: shapePrior(letter, metrics) }))
    .sort((a, b) => b.score - a.score);

  if (ranked[0].letter !== "R") {
    // Squircle R: weak leg, low mid-row right fill; true O is rounder (higher midRR).
    if (
      ranked[0].letter === "O" &&
      metrics.midRowRightRatio < 0.4 &&
      br > 0.17
    ) {
      return "R";
    }
    return ranked[0].letter;
  }
  if (metrics.isRound || br < 0.11) return "O";
  if (metrics.hasMiddleBar || metrics.midRowSpan > 0.4) return "E";
  return "R";
}

export function resolveLetter(
  votes: Array<{ letter: string; weight: number }>,
  metrics: ShapeMetrics | null,
  theme: "dark" | "light" = "light"
): string {
  // Extreme tall-narrow shape can only be I. Tesseract often scatters weak
  // votes (N, B, C, H, J) over the tiny rendering of a single vertical
  // stroke; no other letter has aspect > 2.0 with a clean isolated bbox, so
  // trust shape unconditionally here. This rescues cells like the corner
  // "I" on light-theme puzzles with hint-number contamination.
  if (metrics && scoreI(metrics) >= 0.8 && metrics.aspect > 2.0) {
    return "I";
  }

  const scores = new Map<string, number>();
  for (const { letter, weight } of votes) {
    scores.set(letter, (scores.get(letter) ?? 0) + weight);
  }

  if (metrics) {
    for (const letter of SHAPE_LETTERS) {
      const prior = shapePrior(letter, metrics);
      if (prior > 0.45) {
        scores.set(letter, (scores.get(letter) ?? 0) + prior * 45);
      }
    }

    const oShape = scoreO(metrics);
    const eShape = scoreE(metrics);
    const oVote = scores.get("O") ?? 0;
    const eVote = scores.get("E") ?? 0;

    if (oShape > 0.6 && eShape < 0.35 && eVote > oVote) {
      scores.set("O", eVote + oShape * 40);
      scores.set("E", eVote * 0.1);
    } else if (eShape > 0.6 && oShape < 0.35 && oVote > eVote) {
      scores.set("E", oVote + eShape * 40);
      scores.set("O", oVote * 0.1);
    }

    const eScore = scores.get("E") ?? 0;
    const bestNonE = Math.max(
      scores.get("P") ?? 0,
      scores.get("R") ?? 0,
      scores.get("O") ?? 0
    );

    if (eScore >= bestNonE && eScore > 0) {
      const shapeWinner = pickBestShape(metrics);
      const shapeWinScore = shapePrior(shapeWinner, metrics);
      // Don't suppress E in favor of P/R when Tesseract aggregated strong
      // E agreement — shape-prior margins of 0.12 are noisy compared to a
      // multi-variant OCR consensus.
      const strongOcrE = eVote > 600;
      if (
        !strongOcrE &&
        (shapeWinner === "P" || shapeWinner === "R") &&
        shapeWinScore > eShape + 0.12
      ) {
        scores.set("E", eScore * 0.08);
        scores.set(shapeWinner, eScore + shapeWinScore * 50);
      }
    } else if (
      (scores.get("P") ?? 0) > 0 ||
      (scores.get("R") ?? 0) > 0 ||
      eVote > 0
    ) {
      const shapeWinner = pickBestShape(metrics, ["E", "P", "R", "O"]);
      const sw = shapePrior(shapeWinner, metrics);
      if (shapeWinner !== "E" && sw > 0.5) {
        scores.set(shapeWinner, (scores.get(shapeWinner) ?? 0) + sw * 35);
        if (shapeWinner === "P" || shapeWinner === "R") {
          scores.set("E", (scores.get("E") ?? 0) * 0.12);
        }
      }
    }

    const iShape = scoreI(metrics);
    const bShape = scoreB(metrics);
    const bVote = scores.get("B") ?? 0;
    if (bVote > 0 && iShape > 0.45 && iShape > bShape + 0.12) {
      scores.set("I", Math.max(scores.get("I") ?? 0, bVote) + iShape * 55);
      scores.set("B", bVote * 0.08);
    }

    if (theme === "dark") {
      const rVote = scores.get("R") ?? 0;
      const rShape = scoreR(metrics);
      const oShape = scoreO(metrics);
      const eShape = scoreE(metrics);
      // Only suppress R when the vote is weak (shape-guess only, no real Tesseract confidence).
      // A genuine Tesseract R vote produces weights >> 65; shape-only is exactly 65.
      const tesseractConfidentR = rVote > 150;
      if (!tesseractConfidentR) {
        for (const letter of ["O", "E"] as const) {
          const prior = shapePrior(letter, metrics);
          if (prior > 0.35) {
            scores.set(letter, (scores.get(letter) ?? 0) + prior * 55);
          }
        }
        if (rVote > 0) {
          if (rShape < 0.42 || metrics.bottomRightRatio < 0.11) {
            scores.set("R", rVote * 0.02);
          } else if (oShape > rShape || eShape > rShape) {
            scores.set("R", rVote * 0.08);
          }
        }
      }
    }
  }

  let best = "";
  let bestScore = -1;
  for (const [letter, score] of scores) {
    if (score > bestScore) {
      bestScore = score;
      best = letter;
    }
  }

  if (metrics) {
    // Light theme: weak Tesseract R evidence (single low-conf vote) plus a
    // strongly O-like shape → letter is O whose right loop got clipped by an
    // off-by-a-few-pixels cell rectangle. Without this, otherwise-correct O's
    // get reported as R because shapePrior(R) reads the gap as a missing
    // mid-row stroke.
    if (theme === "light" && best === "R") {
      const rVote = scores.get("R") ?? 0;
      const oShape = scoreO(metrics);
      const eShape = scoreE(metrics);
      if (
        rVote < 130 &&
        oShape > 0.55 &&
        metrics.symmetry > 0.9 &&
        metrics.bottomLeftRatio > 0.18 &&
        metrics.bottomRightRatio > 0.18 &&
        oShape > eShape
      ) {
        return "O";
      }
    }
    if (theme === "dark" && best === "R") {
      // If Tesseract was confident about R, trust it
      const rRawScore = scores.get("R") ?? 0;
      const tesseractConfidentR = rRawScore > 150;
      if (tesseractConfidentR) return "R";
      if (metrics.bottomRightRatio > 0.19 && scoreR(metrics) > 0.58) {
        return "R";
      }
      return pickBestShape(metrics, ["O", "E"]);
    }
    if (theme === "dark" && best === "O") {
      if (hasRLeg(metrics) && scoreR(metrics) > scoreO(metrics) - 0.05) {
        return "R";
      }
    }

    const e = scoreE(metrics);
    const p = scoreP(metrics);
    const r = scoreR(metrics);
    if (best === "E") {
      // Don't flip a strongly Tesseract-voted E away. A single confident
      // OCR call typically weighs ~80–200; an aggregate above ~600 means
      // several variants agreed on E, which is much stronger evidence than
      // a shape-prior delta of ~0.3.
      const eVote = scores.get("E") ?? 0;
      const strongOcrE = eVote > 600;
      if (!strongOcrE && p > e + 0.08 && p >= r) return "P";
      if (!strongOcrE && r > e + 0.08 && r > p) return "R";
    }
    if (best === "E" || best === "P" || best === "R") {
      // Skip the shape override when Tesseract aggregated strong agreement
      // for the current best letter — multi-variant OCR consensus is much
      // more reliable than a 0.1-margin shape prior delta.
      const bestVote = scores.get(best) ?? 0;
      const strongOcrBest = bestVote > 600;
      const shapeBest = pickBestShape(metrics, ["E", "P", "R"]);
      const sw = shapePrior(shapeBest, metrics);
      if (
        !strongOcrBest &&
        (shapeBest === "P" || shapeBest === "R") &&
        sw > 0.55 &&
        sw > shapePrior(best, metrics) + 0.1
      ) {
        return shapeBest;
      }
    }
    // Strongly symmetric round shape with balanced bottom corners and no
    // middle bar is O — Tesseract on tiny low-res cells can drift to E when
    // strokes blur. Guarded by requiring corroborating *Tesseract* O
    // evidence (raw vote weight clearly above the shape baseline of 65),
    // not the inflated post-shape score. Without this guard, U/D/B with
    // O-like geometry would also flip.
    if (
      best !== "O" &&
      scoreO(metrics) > 0.9 &&
      !metrics.hasMiddleBar &&
      metrics.symmetry > 0.95 &&
      metrics.midRowSpan > 0.85 &&
      metrics.midRowRightRatio > 0.35 &&
      Math.abs(metrics.bottomLeftRatio - metrics.bottomRightRatio) < 0.06 &&
      metrics.bottomLeftRatio > 0.15 &&
      metrics.bottomRightRatio > 0.15
    ) {
      const bestVote = scores.get(best) ?? 0;
      const rawOVote = voteTotal(votes, "O");
      // > 80 means at least one Tesseract variant returned O beyond the
      // ~65-weight shape vote.
      if (bestVote < 600 && rawOVote > 80) return "O";
    }

    if (best === "B") {
      const i = scoreI(metrics);
      const b = scoreB(metrics);
      const p = scoreP(metrics);
      const r = scoreR(metrics);
      const o = scoreO(metrics);
      if (i > 0.45 && i > b + 0.12) return "I";
      // Strong P/R signal beats weak B (e.g. dark theme where P-bowl + low
      // bottom-right is read as B by Tesseract but shape is clearly P).
      if (p > 0.6 && p > b + 0.25) return "P";
      if (r > 0.6 && r > b + 0.25 && hasRLeg(metrics)) return "R";
      // Symmetric round shape with balanced bottoms is O, not B — Tesseract
      // sometimes reads dark squircle O's as B because the bowl-stem pattern
      // resembles B at low resolution. Require no detected middle bar (B has
      // one, O doesn't) to avoid the inverse mistake.
      if (
        o > 0.7 &&
        !metrics.hasMiddleBar &&
        metrics.midRowRightRatio > 0.35 &&
        metrics.symmetry > 0.95 &&
        metrics.bottomLeftRatio > 0.15 &&
        metrics.bottomRightRatio > 0.15 &&
        Math.abs(metrics.bottomLeftRatio - metrics.bottomRightRatio) < 0.08 &&
        metrics.midRowSpan > 0.85
      ) {
        return "O";
      }
    }
  }

  return best;
}

export function classifyLetterFromCanvas(
  canvas: HTMLCanvasElement
): string | null {
  const m = analyzeShape(canvas);
  if (!m) return null;

  const ranked = SHAPE_LETTERS.map((letter) => ({
    letter,
    score: shapePrior(letter, m),
  })).sort((a, b) => b.score - a.score);

  if (ranked[0].score < 0.5) return null;
  return ranked[0].letter;
}

export function canvasFromDataUrl(dataUrl: string): Promise<HTMLCanvasElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = img.width;
      c.height = img.height;
      c.getContext("2d")!.drawImage(img, 0, 0);
      resolve(c);
    };
    img.onerror = reject;
    img.src = dataUrl;
  });
}
