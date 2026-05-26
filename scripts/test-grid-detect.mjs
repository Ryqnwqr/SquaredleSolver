/**
 * Grid detection only (no OCR). Matches app "Auto-detect" (no size hint).
 * Usage:
 *   TEST_FIXTURE=dark4x4 node scripts/test-grid-detect.mjs
 *   node scripts/test-grid-detect.mjs all
 */
import { chromium } from "playwright";
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const FIXTURES = {
  dark4x4:        { image: "puzzle-dark-4x4.png",     rows: 4, cols: 4 },
  dark4x4v2:     { image: "puzzle-dark-4x4-v2.png",  rows: 4, cols: 4 },
  dark:          { image: "puzzle-dark-5x5.png",     rows: 5, cols: 5 },
  dark2:         { image: "puzzle-dark2-5x5.png",    rows: 5, cols: 5 },
  dark3:         { image: "puzzle-dark3-5x5.png",    rows: 5, cols: 5 },
  light:         { image: "puzzle-5x5.png",          rows: 5, cols: 5 },
  lightClean:    { image: "puzzle-5x5-clean.png",    rows: 5, cols: 5 },
  darkClean:     { image: "new-test.png",            rows: 5, cols: 5 },
  light4x4Min:   { image: "light-4x4-minimal.png",   rows: 4, cols: 4 },
  light4x4Sh:    { image: "light-4x4-shadow.png",    rows: 4, cols: 4 },
  dark5x5Teal:   { image: "dark-5x5-teal.png",       rows: 5, cols: 5 },
  light4x4Hints: { image: "light-4x4-hints.png",     rows: 4, cols: 4 },
  light5x5Cut:   { image: "light-5x5-cornercut.png", rows: 5, cols: 5 },
};

const argv = process.argv.slice(2);
const runAll = argv.includes("all");
const keys = runAll
  ? Object.keys(FIXTURES)
  : [process.env.TEST_FIXTURE ?? "dark4x4"];

const baseUrl = process.env.TEST_URL ?? "http://localhost:5173";
const browser = await chromium.launch();
const page = await browser.newPage();

let failures = 0;
try {
  await page.goto(baseUrl, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForFunction(
    () => document.querySelector(".badge.ready") !== null,
    { timeout: 120000 }
  );

  for (const key of keys) {
    const fixture = FIXTURES[key];
    if (!fixture) {
      console.error(`Unknown fixture: ${key}`);
      failures++;
      continue;
    }
    const IMAGE = join(__dirname, "..", "test-fixtures", fixture.image);
    if (!existsSync(IMAGE)) {
      console.error("Missing:", IMAGE);
      failures++;
      continue;
    }
    const dataUrl = `data:image/png;base64,${readFileSync(IMAGE).toString("base64")}`;

    if (process.env.GRID_DIAG) {
      page.on("console", (msg) => {
        const t = msg.text();
        if (t.startsWith("[gridDetect]")) console.log("  ", t);
      });
    }
    const result = await page.evaluate(async ({ src, diag }) => {
      if (diag) (globalThis).__GRID_DIAG__ = true;
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
    }, { src: dataUrl, diag: !!process.env.GRID_DIAG });

    const ok = result.rows === fixture.rows && result.cols === fixture.cols;
    const marker = ok ? "OK  " : "FAIL";
    console.log(
      `${marker} ${key.padEnd(13)} got ${result.rows}×${result.cols} want ${fixture.rows}×${fixture.cols}  method=${result.method.padEnd(28)} theme=${result.theme} conf=${result.confidence.toFixed(2)}`
    );
    if (!ok) failures++;
  }

  console.log("");
  if (failures === 0) {
    console.log(`All ${keys.length} fixture(s) detected correctly.`);
  } else {
    console.log(`${failures}/${keys.length} fixture(s) failed.`);
    process.exitCode = 1;
  }
} finally {
  await browser.close();
}
