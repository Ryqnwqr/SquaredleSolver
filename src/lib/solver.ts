import { BLOCKED } from "./gridDetect";
import { normalizeOcrToLetter } from "./letterNormalize";
import type { TrieNode } from "./trie";
import { MIN_LENGTH } from "./dictionary";

export function isPlayableCell(cell: string): boolean {
  return cell !== "?" && cell !== BLOCKED && cell.length > 0;
}

const DIRECTIONS = [
  [-1, -1],
  [-1, 0],
  [-1, 1],
  [0, -1],
  [0, 1],
  [1, -1],
  [1, 0],
  [1, 1],
] as const;

export interface FoundWord {
  word: string;
  path: { row: number; col: number }[];
}

export function normalizeGrid(input: string[][]): string[][] {
  return input.map((row) =>
    row.map((cell) => {
      if (cell === BLOCKED) return BLOCKED;
      const letter = normalizeOcrToLetter(cell);
      return letter || "?";
    })
  );
}

export function findAllWords(
  grid: string[][],
  root: TrieNode
): FoundWord[] {
  const rows = grid.length;
  const cols = grid[0]?.length ?? 0;
  if (rows === 0 || cols === 0) return [];

  const found = new Map<string, FoundWord>();
  const visited = Array.from({ length: rows }, () =>
    Array<boolean>(cols).fill(false)
  );

  function dfs(
    row: number,
    col: number,
    node: TrieNode,
    path: string,
    coords: { row: number; col: number }[]
  ): void {
    if (row < 0 || col < 0 || row >= rows || col >= cols || visited[row][col]) {
      return;
    }

    const letter = grid[row][col];
    if (!isPlayableCell(letter)) return;

    const next = node.children.get(letter.toLowerCase());
    if (!next) return;

    const nextPath = path + letter.toLowerCase();
    const nextCoords = [...coords, { row, col }];

    if (next.isWord && nextPath.length >= MIN_LENGTH) {
      const existing = found.get(nextPath);
      if (!existing || nextCoords.length < existing.path.length) {
        found.set(nextPath, { word: nextPath, path: nextCoords });
      }
    }

    visited[row][col] = true;

    for (const [dr, dc] of DIRECTIONS) {
      dfs(row + dr, col + dc, next, nextPath, nextCoords);
    }

    visited[row][col] = false;
  }

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (isPlayableCell(grid[r][c])) {
        dfs(r, c, root, "", []);
      }
    }
  }

  return [...found.values()].sort((a, b) =>
    a.word === b.word ? 0 : a.word.localeCompare(b.word)
  );
}
