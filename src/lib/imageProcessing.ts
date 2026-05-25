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
    if (sat > 0.12 && lum > 40 && lum < 235) mask[p] = 1;
  }

  const visited = new Uint8Array(mask.length);
  const blobs: Blob[] = [];
  const neighbors = [
    [-1, 0], [1, 0], [0, -1], [0, 1],
  ];

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const start = y * width + x;
      if (!mask[start] || visited[start]) continue;

      const stack = [start];
      visited[start] = 1;
      let minX = x, maxX = x, minY = y, maxY = y, area = 0;

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
        w >= 12 &&
        h >= 12
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

  const visited = new Uint8Array(mask.length);
  const blobs: Blob[] = [];
  const neighbors = [[-1, 0], [1, 0], [0, -1], [0, 1]];

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const start = y * width + x;
      if (!mask[start] || visited[start]) continue;

      const stack = [start];
      visited[start] = 1;
      let minX = x, maxX = x, minY = y, maxY = y, area = 0;

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
        w >= 14 &&
        h >= 14
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
