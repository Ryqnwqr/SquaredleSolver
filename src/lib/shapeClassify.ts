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
  y: number
): boolean {
  const i = (y * width + x) * 4;
  const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  // 165 catches faded Squaredle tiles; 140 keeps crisp letters tight
  return gray < 165;
}

export function analyzeShape(canvas: HTMLCanvasElement): ShapeMetrics | null {
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const { width, height } = canvas;
  const { data } = ctx.getImageData(0, 0, width, height);

  const colCounts = new Array<number>(width).fill(0);
  const rowCounts = new Array<number>(height).fill(0);
  let minX = width;
  let maxX = 0;
  let minY = height;
  let maxY = 0;
  let ink = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (isInkPixel(data, width, x, y)) {
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
  const brX0 = minX + Math.floor(w * 0.55);
  const brY0 = minY + Math.floor(h * 0.55);
  const trX0 = minX + Math.floor(w * 0.45);
  const trY1 = minY + Math.floor(h * 0.45);

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      if (!isInkPixel(data, width, x, y)) continue;
      if (x < midX) leftInk++;
      else rightInk++;
      if (x >= trX0 && y <= trY1) topRightInk++;
      if (x >= brX0 && y >= brY0) bottomRightInk++;
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
      if (!isInkPixel(data, width, x, y)) continue;
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
  const isRound =
    aspect > 0.72 &&
    aspect < 1.45 &&
    symmetry > 0.68 &&
    !hasMiddleBar &&
    midRow.rowSpan < 0.38;

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
    topRightRatio: topRightInk / ink,
    topBand,
    midBand,
    botBand,
  };
}

export function scoreO(m: ShapeMetrics): number {
  let s = 0;
  if (m.isRound) s += 0.45;
  if (m.symmetry > 0.72) s += 0.25;
  if (!m.hasMiddleBar) s += 0.2;
  if (m.midRowRightRatio > 0.18) s += 0.15;
  if (m.midRowSpan < 0.35) s += 0.1;
  return Math.min(1, s);
}

export function scoreE(m: ShapeMetrics): number {
  if (m.midRowSpan < 0.38) return 0;
  if (
    m.topRightRatio > 0.1 &&
    m.bottomRightRatio < 0.11 &&
    m.midRowSpan < 0.42
  ) {
    return 0;
  }
  let s = 0;
  if (m.hasMiddleBar) s += 0.4;
  if (m.midBand > 0.35 && m.topBand > 0.3 && m.botBand > 0.3) s += 0.3;
  if (m.midRowSpan > 0.45) s += 0.2;
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
  let s = 0;
  if (m.leftHalfRatio > 0.32 && m.topRightRatio > 0.08) s += 0.25;
  if (m.bottomRightRatio > 0.08) s += 0.4;
  if (m.midRowSpan < 0.4) s += 0.15;
  if (!m.hasMiddleBar || m.midRowSpan < 0.35) s += 0.1;
  if (m.botBand > 0.15 && m.bottomRightRatio > 0.08) s += 0.15;
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

export function resolveLetter(
  votes: Array<{ letter: string; weight: number }>,
  metrics: ShapeMetrics | null
): string {
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
      if (
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
    const e = scoreE(metrics);
    const p = scoreP(metrics);
    const r = scoreR(metrics);
    if (best === "E") {
      if (p > e + 0.08 && p >= r) return "P";
      if (r > e + 0.08 && r > p) return "R";
    }
    if (best === "E" || best === "P" || best === "R") {
      const shapeBest = pickBestShape(metrics, ["E", "P", "R"]);
      const sw = shapePrior(shapeBest, metrics);
      if (
        (shapeBest === "P" || shapeBest === "R") &&
        sw > 0.55 &&
        sw > shapePrior(best, metrics) + 0.1
      ) {
        return shapeBest;
      }
    }
    if (best === "B") {
      const i = scoreI(metrics);
      const b = scoreB(metrics);
      if (i > 0.45 && i > b + 0.12) return "I";
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
