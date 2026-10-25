import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = [
  resolve(root, "node_modules/@tauri-apps/cli/tauri.js"),
  "build",
  "--no-bundle",
  "--features",
  "e2e",
  "--config",
  "src-tauri/tauri.e2e.conf.json",
];
if (process.env.AETHER_CARGO_PROXY === "1")
  args.push(
    "--",
    "--offline",
    "--config",
    'source.crates-io.replace-with="aether-local"',
    "--config",
    'source.aether-local.registry="sparse+http://127.0.0.1:1421/"',
  );
const child = spawn(process.execPath, args, {
  cwd: root,
  env: {
    ...process.env,
    CARGO_TARGET_DIR: resolve(root, "src-tauri/target/e2e"),
  },
  stdio: "inherit",
  windowsHide: true,
});
child.on("error", (error) => {
  console.error(error);
  process.exitCode = 1;
});
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
