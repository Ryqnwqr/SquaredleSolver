import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          tesseract: ["tesseract.js"],
          dictionary: ["an-array-of-english-words"],
        },
      },
    },
  },
});
