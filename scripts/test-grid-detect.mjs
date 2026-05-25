/**
 * Grid detection only (no OCR). Matches app "Auto-detect" (no size hint).
 * Usage: TEST_FIXTURE=dark4x4 node scripts/test-grid-detect.mjs
 */
import { chromium } from "playwright";
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const FIXTURES = {
  dark4x4: { image: "puzzle-dark-4x4.png", rows: 4, cols: 4 },
  dark: { image: "puzzle-dark-5x5.png", rows: 5, cols: 5 },
  dark2: { image: "puzzle-dark2-5x5.png", rows: 5, cols: 5 },
  dark3: { image: "puzzle-dark3-5x5.png", rows: 5, cols: 5 },
  light: { image: "puzzle-5x5.png", rows: 5, cols: 5 },
};

const key = process.env.TEST_FIXTURE ?? "dark4x4";
const fixture = FIXTURES[key];
const IMAGE = join(__dirname, "..", "test-fixtures", fixture.image);

if (!existsSync(IMAGE)) {
  console.error("Missing:", IMAGE);
  process.exit(1);
}

const dataUrl = `data:image/png;base64,${readFileSync(IMAGE).toString("base64")}`;
const baseUrl = process.env.TEST_URL ?? "http://localhost:5173";

const browser = await chromium.launch();
const page = await browser.newPage();
try {
  await page.goto(baseUrl, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForFunction(
    () => document.querySelector(".badge.ready") !== null,
    { timeout: 120000 }
  );

  const result = await page.evaluate(async (src) => {
    const { detectGridLayout } = await import("/src/lib/gridDetect.ts");
    const d = await detectGridLayout(src); // no hint — like Auto in UI
    return {
      rows: d.rows,
      cols: d.cols,
      method: d.method,
      theme: d.theme,
      confidence: d.confidence,
      active: d.cells.flat().filter((c) => c.active).length,
    };
  }, dataUrl);

  console.log(`\nFixture: ${key}`);
  console.log(`  Detected: ${result.rows}×${result.cols}  method=${result.method}  theme=${result.theme}`);
  console.log(`  Expected: ${fixture.rows}×${fixture.cols}`);
  console.log(`  confidence=${result.confidence.toFixed(3)}  activeCells=${result.active}`);

  const ok = result.rows === fixture.rows && result.cols === fixture.cols;
  if (!ok) {
    console.log("\nFAIL: wrong grid dimensions");
    process.exit(1);
  }
  console.log("\nOK: dimensions match");
} finally {
  await browser.close();
}
