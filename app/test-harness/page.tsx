"use client";

import { useEffect, useState } from "react";
import { detectGridLayout } from "@/lib/gridDetect";
import { extractGridFromImage } from "@/lib/ocr";
import { normalizeGrid } from "@/lib/solver";
import { loadDictionary } from "@/lib/dictionary";

/**
 * Exposes grid/OCR modules on `window.__SS_TEST__` for Playwright scripts.
 * Not linked from the main UI; visit /test-harness while dev server is running.
 */
export default function TestHarnessPage() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    window.__SS_TEST__ = {
      detectGridLayout,
      extractGridFromImage,
      normalizeGrid,
    };
    void loadDictionary("nwl2023").finally(() => setReady(true));
  }, []);

  return (
    <div className="app" style={{ padding: "2rem" }}>
      <span className={ready ? "badge ready" : "badge loading"}>
        {ready ? "test-harness ready" : "Loading dictionary…"}
      </span>
    </div>
  );
}
