import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

// PDF font metrics and CMaps are bundled locally; opening a vault never needs
// a CDN. Keep the upstream filenames because PDF.js requests them by name.
const pdfAssets = ["standard_fonts", "cmaps"].flatMap((folder) =>
  readdirSync(resolve("node_modules/pdfjs-dist", folder))
    .filter(
      (name) => /\.(pfb|ttf|bcmap)$/.test(name) || name.startsWith("LICENSE"),
    )
    .map((name) => ({
      fileName: `pdfjs/${folder}/${name}`,
      source: readFileSync(resolve("node_modules/pdfjs-dist", folder, name)),
    })),
);
pdfAssets.push({
  fileName: "pdfjs/LICENSE",
  source: readFileSync(resolve("node_modules/pdfjs-dist/LICENSE")),
});

export default defineConfig({
  plugins: [
    react(),
    {
      name: "local-pdf-resources",
      generateBundle() {
        for (const asset of pdfAssets)
          this.emitFile({ type: "asset", ...asset });
      },
      configureServer(server) {
        server.middlewares.use((request, response, next) => {
          const asset = pdfAssets.find(
            (entry) => `/${entry.fileName}` === request.url,
          );
          if (!asset) return next();
          response.setHeader("Content-Type", "application/octet-stream");
          response.end(asset.source);
        });
      },
    },
  ],
  clearScreen: false,
  server: { host: "127.0.0.1", port: 1420, strictPort: true },
  test: { environment: "jsdom", include: ["tests/**/*.test.{ts,tsx}"] },
});
