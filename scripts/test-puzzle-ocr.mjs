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
  dark3: {
    image: "puzzle-dark3-5x5.png",
    // Expected determined from image inspection — verify after first run
    expected: ["TOEEK", "OEEEO", "EEEEE", "OOEEO", "AIEEE"],
    critical: [
      { r: 0, c: 0, letter: "T" },
      { r: 0, c: 4, letter: "K" },
      { r: 4, c: 0, letter: "A" },
      { r: 4, c: 1, letter: "I" },
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
  lightClean: {
    image: "puzzle-5x5-clean.png",
    expected: ["MTDEK", "HOOJI", "OEYLN", "PHRDA", "ISBOR"],
    critical: [
      { r: 2, c: 1, letter: "E" },
      { r: 4, c: 0, letter: "I" },
      { r: 3, c: 0, letter: "P" },
      { r: 3, c: 2, letter: "R" },
    ],
  },
  darkClean: {
    image: "new-test.png",
    expected: ["MTDEK", "HOOJI", "OPYLN", "PHRDA", "PSBRR"],
    critical: [
      { r: 0, c: 0, letter: "M" },
      { r: 2, c: 1, letter: "P" },
      { r: 4, c: 4, letter: "R" },
    ],
  },
  light4x4Min: {
    image: "light-4x4-minimal.png",
    hint: 4,
    expected: ["ETAN", "RLIS", "UOCY", "KDPG"],
    critical: [
      { r: 0, c: 0, letter: "E" },
      { r: 3, c: 3, letter: "G" },
    ],
  },
  light4x4Sh: {
    image: "light-4x4-shadow.png",
    hint: 4,
    expected: ["NCMN", "KAIE", "ECUS", "HERT"],
    critical: [
      { r: 0, c: 0, letter: "N" },
      { r: 3, c: 3, letter: "T" },
    ],
  },
  dark5x5Teal: {
    image: "dark-5x5-teal.png",
    expected: ["SUNLE", "ITBON", "TMOOD", "EPWGF", "DEBOL"],
    critical: [
      { r: 0, c: 0, letter: "S" },
      { r: 4, c: 4, letter: "L" },
    ],
  },
  dark4x4: {
    image: "puzzle-dark-4x4.png",
    hint: 4,
    expected: ["THIK", "RJOO", "HRRI", "ARIB"],
    critical: [{ r: 0, c: 0, letter: "T" }],
  },
  dark4x4v2: {
    image: "puzzle-dark-4x4-v2.png",
    hint: 4,
    expected: ["SANI", "RYRA", "IBAN", "LOOK"],
    critical: [
      { r: 1, c: 0, letter: "R" },
      { r: 1, c: 2, letter: "R" },
      { r: 3, c: 1, letter: "O" },
      { r: 3, c: 2, letter: "O" },
      { r: 3, c: 3, letter: "K" },
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
if (process.env.OCR_DIAG) {
  page.on("console", (msg) => {
    if (msg.text().startsWith("{")) console.log("DIAG", msg.text());
  });
}

try {
  await page.goto(baseUrl, { waitUntil: "networkidle", timeout: 60000 });

  await page.waitForFunction(
    () => document.querySelector(".badge.ready") !== null,
    { timeout: 120000 }
  );

  const gridHint =
    process.env.GRID_HINT !== undefined
      ? parseInt(process.env.GRID_HINT, 10) || undefined
      : fixture.hint ?? 5;

  const result = await page.evaluate(
    async ({ src, hint, diag }) => {
      if (diag) (globalThis).__OCR_DIAG__ = true;
      const { extractGridFromImage } = await import("/src/lib/ocr.ts");
      const { normalizeGrid } = await import("/src/lib/solver.ts");
      const out = await extractGridFromImage(src, hint);
      return {
        grid: normalizeGrid(out.grid),
        method: out.detection.method,
        theme: out.detection.theme,
        rows: out.detection.rows,
        cols: out.detection.cols,
      };
    },
    { src: dataUrl, hint: gridHint, diag: !!process.env.OCR_DIAG }
  );

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
