import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { BLOCKED } from "../lib/gridDetect";

interface LetterGridProps {
  grid: string[][];
  highlightPath?: { row: number; col: number }[];
  editable?: boolean;
  onCellChange?: (row: number, col: number, value: string) => void;
}

interface Point {
  x: number;
  y: number;
}

const ARROW_SHRINK = 14;

function shrinkLine(from: Point, to: Point, shrink: number) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  if (len <= shrink * 2) {
    return { x1: from.x, y1: from.y, x2: to.x, y2: to.y };
  }
  const ux = dx / len;
  const uy = dy / len;
  return {
    x1: from.x + ux * shrink,
    y1: from.y + uy * shrink,
    x2: to.x - ux * shrink,
    y2: to.y - uy * shrink,
  };
}

export function LetterGrid({
  grid,
  highlightPath = [],
  editable = false,
  onCellChange,
}: LetterGridProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const cellRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const [overlaySize, setOverlaySize] = useState({ width: 0, height: 0 });
  const [centers, setCenters] = useState<Map<string, Point>>(new Map());
  const [badgePositions, setBadgePositions] = useState<Map<string, Point>>(
    new Map()
  );

  const validPath = useMemo(
    () =>
      highlightPath.filter((p) => {
        const row = grid[p.row];
        if (!row) return false;
        const letter = row[p.col];
        return letter !== undefined && letter !== BLOCKED;
      }),
    [highlightPath, grid]
  );

  const highlightSet = useMemo(
    () => new Set(validPath.map((p) => `${p.row},${p.col}`)),
    [validPath]
  );

  const pathStartKey =
    validPath.length > 0 ? `${validPath[0].row},${validPath[0].col}` : null;
  const pathEndKey =
    validPath.length > 0
      ? `${validPath[validPath.length - 1].row},${validPath[validPath.length - 1].col}`
      : null;
  const pathLastIndex = validPath.length - 1;

  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;

    // No path selected — skip overlay measurement entirely to avoid a
    // ResizeObserver ↔ setState feedback loop (blank screen crash).
    if (validPath.length === 0) {
      setOverlaySize((prev) =>
        prev.width === 0 && prev.height === 0 ? prev : { width: 0, height: 0 }
      );
      setCenters((prev) => (prev.size === 0 ? prev : new Map()));
      setBadgePositions((prev) => (prev.size === 0 ? prev : new Map()));
      return;
    }

    const measure = () => {
      const rect = wrap.getBoundingClientRect();
      const width = rect.width;
      const height = rect.height;

      setOverlaySize((prev) =>
        Math.abs(prev.width - width) < 0.5 &&
        Math.abs(prev.height - height) < 0.5
          ? prev
          : { width, height }
      );

      const nextCenters = new Map<string, Point>();
      const nextBadges = new Map<string, Point>();
      for (const p of validPath) {
        const key = `${p.row},${p.col}`;
        const el = cellRefs.current.get(key);
        if (!el) continue;
        const cellRect = el.getBoundingClientRect();
        nextCenters.set(key, {
          x: cellRect.left + cellRect.width / 2 - rect.left,
          y: cellRect.top + cellRect.height / 2 - rect.top,
        });
        nextBadges.set(key, {
          x: cellRect.left - rect.left + 3,
          y: cellRect.top - rect.top + 3,
        });
      }

      const syncPoints = (
        prev: Map<string, Point>,
        next: Map<string, Point>
      ) => {
        if (prev.size !== next.size) return next;
        for (const [key, pt] of next) {
          const old = prev.get(key);
          if (
            !old ||
            Math.abs(old.x - pt.x) > 0.5 ||
            Math.abs(old.y - pt.y) > 0.5
          ) {
            return next;
          }
        }
        return prev;
      };

      setCenters((prev) => syncPoints(prev, nextCenters));
      setBadgePositions((prev) => syncPoints(prev, nextBadges));
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(wrap);
    return () => observer.disconnect();
  }, [validPath, grid]);

  const arrows = useMemo(() => {
    const lines: { key: string; x1: number; y1: number; x2: number; y2: number }[] =
      [];
    for (let i = 0; i < validPath.length - 1; i++) {
      const fromKey = `${validPath[i].row},${validPath[i].col}`;
      const toKey = `${validPath[i + 1].row},${validPath[i + 1].col}`;
      const from = centers.get(fromKey);
      const to = centers.get(toKey);
      if (!from || !to) continue;
      const line = shrinkLine(from, to, ARROW_SHRINK);
      lines.push({ key: `${fromKey}-${toKey}`, ...line });
    }
    return lines;
  }, [validPath, centers]);

  const showOverlay = overlaySize.width > 0 && validPath.length > 0;

  return (
    <div className="letter-grid-wrap" ref={wrapRef}>
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
            const isPathStart = key === pathStartKey;
            const isPathEnd = key === pathEndKey && key !== pathStartKey;
            return (
              <div
                key={key}
                ref={(el) => {
                  if (el) cellRefs.current.set(key, el);
                  else cellRefs.current.delete(key);
                }}
                className={`letter-cell${blocked ? " blocked" : ""}${highlighted ? " highlighted" : ""}${isPathStart ? " path-start" : ""}${isPathEnd ? " path-end" : ""}`}
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
      {showOverlay && (
        <svg
          className="letter-grid-path"
          width={overlaySize.width}
          height={overlaySize.height}
          viewBox={`0 0 ${overlaySize.width} ${overlaySize.height}`}
          aria-hidden
        >
          <defs>
            <marker
              id="letter-path-arrow"
              markerWidth="8"
              markerHeight="8"
              refX="7"
              refY="4"
              orient="auto"
              markerUnits="strokeWidth"
            >
              <path
                d="M0,0 L8,4 L0,8 Z"
                className="letter-grid-path__head"
              />
            </marker>
          </defs>
          {arrows.map(({ key, x1, y1, x2, y2 }) => (
            <line
              key={key}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              className="letter-grid-path__line"
              markerEnd="url(#letter-path-arrow)"
            />
          ))}
        </svg>
      )}
      {showOverlay && (
        <div className="letter-grid-steps" aria-hidden>
          {validPath.map((p, i) => {
            const key = `${p.row},${p.col}`;
            const pos = badgePositions.get(key);
            if (!pos) return null;
            return (
              <span
                key={key}
                className={`letter-cell-step${i === 0 ? " letter-cell-step--start" : ""}${i === pathLastIndex && pathLastIndex > 0 ? " letter-cell-step--end" : ""}`}
                style={{ left: pos.x, top: pos.y }}
              >
                {i + 1}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
