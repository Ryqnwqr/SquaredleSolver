import { BLOCKED } from "../lib/gridDetect";

interface LetterGridProps {
  grid: string[][];
  highlightPath?: { row: number; col: number }[];
  editable?: boolean;
  onCellChange?: (row: number, col: number, value: string) => void;
}

export function LetterGrid({
  grid,
  highlightPath = [],
  editable = false,
  onCellChange,
}: LetterGridProps) {
  const highlightSet = new Set(
    highlightPath.map((p) => `${p.row},${p.col}`)
  );

  return (
    <div
      className="letter-grid"
      style={{
        gridTemplateColumns: `repeat(${grid[0]?.length ?? 1}, 1fr)`,
      }}
    >
      {grid.map((row, r) =>
        row.map((letter, c) => {
          const key = `${r},${c}`;
          const blocked = letter === BLOCKED;
          const highlighted = highlightSet.has(key);
          return (
            <div
              key={key}
              className={`letter-cell${blocked ? " blocked" : ""}${highlighted ? " highlighted" : ""}`}
              aria-hidden={blocked}
            >
              {blocked ? null : editable ? (
                <input
                  type="text"
                  maxLength={1}
                  value={letter === "?" ? "" : letter}
                  onChange={(e) =>
                    onCellChange?.(r, c, e.target.value.toUpperCase())
                  }
                  aria-label={`Row ${r + 1}, column ${c + 1}`}
                />
              ) : (
                <span>{letter === "?" ? "·" : letter}</span>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
