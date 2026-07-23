import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { "/api": "http://localhost:3000" },
  },
  build: {
    // Build output goes straight into the Express static folder, so the
    // backend serves the finished site at http://localhost:3000
    outDir: "../public",
    emptyOutDir: true,
  },
});
