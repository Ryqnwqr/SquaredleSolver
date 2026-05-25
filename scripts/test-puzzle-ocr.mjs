/**
 * OCR accuracy test against a known 5x5 puzzle image.
 * Usage: npm run dev (in another terminal), then: node scripts/test-puzzle-ocr.mjs
 */
import { chromium } from "playwright";
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const FIXTURES = {
  dark2: {
    image: "puzzle-dark2-5x5.png",
    expected: ["THANK", "YOUFO", "RALLT", "HESQU", "ARES_"],
    critical: [
      { r: 0, c: 0, letter: "T" },
      { r: 1, c: 1, letter: "O" },
      { r: 2, c: 0, letter: "R" },
      { r: 3, c: 1, letter: "E" },
      { r: 4, c: 0, letter: "A" },
    ],
  },
  light: {
    image: "puzzle-5x5.png",
    expected: ["MTDEK", "HOOJI", "OEYLN", "PHRDA", "ISBOR"],
    critical: [
      { r: 3, c: 0, letter: "P" },
      { r: 3, c: 2, letter: "R" },
      { r: 1, c: 3, letter: "J" },
      { r: 3, c: 1, letter: "H" },
      { r: 4, c: 0, letter: "I" },
    ],
  },
  dark: {
    image: "puzzle-dark-5x5.png",
    // Row 5 col 5 is "!" which is not a valid Squaredle letter; skip it with null
    expected: ["THANK", "YOUFO", "RALLT", "HESQU", "ARES_"],
    critical: [
      { r: 0, c: 0, letter: "T" },
      { r: 1, c: 1, letter: "O" },
      { r: 2, c: 0, letter: "R" },
      { r: 3, c: 1, letter: "E" },
      { r: 4, c: 0, letter: "A" },
      { r: 4, c: 2, letter: "E" },
    ],
  },
};

const fixtureKey = process.env.TEST_FIXTURE ?? "light";
const fixture = FIXTURES[fixtureKey] ?? FIXTURES.light;
const IMAGE = join(__dirname, "..", "test-fixtures", fixture.image);
const EXPECTED = fixture.expected;
const CRITICAL = fixture.critical;

function toDataUrl(path) {
  const buf = readFileSync(path);
  return `data:image/png;base64,${buf.toString("base64")}`;
}

if (!existsSync(IMAGE)) {
  console.error("Test image not found:", IMAGE);
  process.exit(1);
}

const baseUrl = process.env.TEST_URL ?? "http://localhost:5173";
const dataUrl = toDataUrl(IMAGE);

const browser = await chromium.launch();
const page = await browser.newPage();

try {
  await page.goto(baseUrl, { waitUntil: "networkidle", timeout: 60000 });

  await page.waitForFunction(
    () => document.querySelector(".badge.ready") !== null,
    { timeout: 120000 }
  );

  const result = await page.evaluate(async (src) => {
    const { extractGridFromImage } = await import("/src/lib/ocr.ts");
    const { normalizeGrid } = await import("/src/lib/solver.ts");
    const out = await extractGridFromImage(src, 5);
    return {
      grid: normalizeGrid(out.grid),
      method: out.detection.method,
      theme: out.detection.theme,
      rows: out.detection.rows,
      cols: out.detection.cols,
    };
  }, dataUrl);

  console.log(
    `\nDetection: ${result.theme} theme, ${result.rows}×${result.cols}, method=${result.method}`
  );
  const grid = result.grid;

  let errors = 0;
  const lines = grid.map((row) => row.join(""));

  console.log("\nDetected grid:");
  for (let r = 0; r < lines.length; r++) {
    console.log(`  ${r + 1}: ${lines[r]}`);
  }
  console.log("\nExpected grid:");
  for (let r = 0; r < EXPECTED.length; r++) {
    console.log(`  ${r + 1}: ${EXPECTED[r]}`);
  }

  for (let r = 0; r < EXPECTED.length; r++) {
    for (let c = 0; c < EXPECTED[r].length; c++) {
      const want = EXPECTED[r][c];
      if (want === "_") continue; // skip unrecognizable non-letter cells
      const got = grid[r]?.[c] ?? "?";
      if (got !== want) {
        console.log(`  MISMATCH row ${r + 1} col ${c + 1}: got "${got}", want "${want}"`);
        errors++;
      }
    }
  }

  console.log("\nCritical cells:");
  for (const { r, c, letter } of CRITICAL) {
    const got = grid[r]?.[c] ?? "?";
    const ok = got === letter;
    console.log(`  (${r + 1},${c + 1}) ${letter}: ${ok ? "OK" : `FAIL got ${got}`}`);
    if (!ok) errors++;
  }

  if (errors === 0) {
    console.log("\nAll cells match expected grid.");
    process.exit(0);
  } else {
    console.log(`\n${errors} error(s).`);
    process.exit(1);
  }
} catch (e) {
  console.error(e);
  process.exit(1);
} finally {
  await browser.close();
}
