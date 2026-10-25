import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/native",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  use: { actionTimeout: 15_000 },
  reporter: [
    ["list"],
    ["json", { outputFile: ".build-cache/native-results/report.json" }],
  ],
  outputDir: ".build-cache/native-results/artifacts",
});
