import type { detectGridLayout } from "@/lib/gridDetect";
import type { extractGridFromImage } from "@/lib/ocr";
import type { normalizeGrid } from "@/lib/solver";

declare global {
  interface Window {
    __SS_TEST__?: {
      detectGridLayout: typeof detectGridLayout;
      extractGridFromImage: typeof extractGridFromImage;
      normalizeGrid: typeof normalizeGrid;
    };
  }
}

export {};
