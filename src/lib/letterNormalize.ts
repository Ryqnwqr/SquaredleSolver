/** Squaredle grids use letters only — map common OCR misreads. */
const TO_LETTER: Record<string, string> = {
  "0": "O",
  "1": "I",
  "8": "B",
  "|": "I",
  "!": "I",
  l: "I",
};

export function normalizeOcrToLetter(raw: string): string {
  const s = raw.trim();
  if (!s) return "";

  const upper = s.toUpperCase();
  const letters = upper.replace(/[^A-Z]/g, "");
  if (letters.length >= 1) return letters.charAt(0);

  for (const ch of upper) {
    if (TO_LETTER[ch]) return TO_LETTER[ch];
  }
  return "";
}
