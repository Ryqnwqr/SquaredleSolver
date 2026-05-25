/**
 * Builds public/nwl2023.json from the official NWL2023 lexicon (Squaredle's word source).
 * Run: node scripts/build-nwl-list.mjs
 */
import { mkdirSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const NWL_URL =
  "https://raw.githubusercontent.com/scrabblewords/scrabblewords/main/words/North-American/NWL2023.txt";
const MIN_LEN = 4;
const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = join(__dirname, "..", "public", "nwl2023.json");

const res = await fetch(NWL_URL);
if (!res.ok) throw new Error(`Failed to fetch NWL2023: ${res.status}`);
const text = await res.text();

const words = new Set();
for (const line of text.split(/\r?\n/)) {
  const m = line.match(/^([A-Z][A-Z']*)\b/);
  if (!m) continue;
  const word = m[1].toLowerCase().replace(/[^a-z]/g, "");
  if (word.length >= MIN_LEN) words.add(word);
}

const sorted = [...words].sort();
mkdirSync(join(__dirname, "..", "public"), { recursive: true });
writeFileSync(outPath, JSON.stringify(sorted));
console.log(`Wrote ${sorted.length} words (length >= ${MIN_LEN}) to ${outPath}`);
