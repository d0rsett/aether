// Review the exact tracked + untracked (non-ignored) publication candidate set.
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const git = (...args) =>
  execFileSync("git", args, { cwd: root, encoding: "utf8" });
const split = (value) => value.split("\0").filter(Boolean);
const files = [
  ...new Set(
    split(git("ls-files", "-z", "--cached", "--others", "--exclude-standard")),
  ),
];
const problems = [];
for (const file of split(
  git("ls-files", "-z", "--cached", "--ignored", "--exclude-standard"),
)) {
  problems.push(
    `${file}: already tracked despite .gitignore (review before publishing)`,
  );
}
const forbidden =
  /(^|\/)(node_modules|target|dist|\.build-cache|\.aether|vaults|\.git|\.codex|\.agents)(\/|$)|(^|\/)\.env(?:\.|$)|\.(exe|msi|pdb|pfx|pem|key|sqlite3?|db|log|tsbuildinfo)$/i;
const credentials = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bgh[pousr]_[a-zA-Z0-9]{36,}\b/,
  /\bgithub_pat_[a-zA-Z0-9_]{50,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bsk-(?:proj-)?[a-zA-Z0-9_-]{32,}\b/,
];
let bytes = 0;
for (const file of files) {
  if (forbidden.test(file) && !/^\.env(?:\..+)?\.example$/.test(file))
    problems.push(`${file}: local/generated/sensitive file`);
  const absolute = resolve(root, file);
  let info;
  try {
    info = statSync(absolute);
  } catch {
    continue;
  } // tracked deletion
  if (!info.isFile()) continue;
  bytes += info.size;
  if (info.size > 10 * 1024 * 1024)
    problems.push(`${file}: exceeds repository budget of 10 MiB per file`);
  if (info.size > 2 * 1024 * 1024) continue;
  const data = readFileSync(absolute);
  if (data.includes(0)) continue;
  const text = data.toString("utf8");
  if (credentials.some((pattern) => pattern.test(text)))
    problems.push(`${file}: possible credential (value intentionally hidden)`);
  if (
    /(?:^|[\s"'(])(?:[A-Z]:[\\/]Users[\\/][^\s/\\]+|\/Users\/[^\s/]+|\/home\/[^\s/]+)/i.test(
      text,
    )
  )
    problems.push(`${file}: personal absolute home path`);
}
const probes = [
  "node_modules/probe.js",
  "src-tauri/target/release/aether.exe",
  "src-tauri/gen/probe.json",
  ".build-cache/probe",
  "dist/index.html",
  ".env",
  ".env.production",
  "private.key",
  ".aether/trash/probe.md",
  "vaults/Personal/Note.md",
  "Aether.exe",
  "coverage/index.html",
];
for (const probe of probes) {
  try {
    git("check-ignore", "--no-index", "--quiet", probe);
  } catch {
    problems.push(`${probe}: expected ignore rule is missing`);
  }
}
if (!files.length) problems.push("No publication candidates found");
if (problems.length) {
  console.error(problems.join("\n"));
  process.exitCode = 1;
} else {
  console.log(
    `Repository audit passed: ${files.length} candidate files, ${(bytes / 1024 / 1024).toFixed(2)} MiB; ${probes.length} ignore probes passed.`,
  );
  console.log(
    "No matching credentials, personal home paths, generated output or oversized files. Review git status and staged diff before push; this pattern scan cannot prove the absence of every secret.",
  );
}
