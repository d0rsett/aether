// Optional build-time HTTP compatibility helper. Only proxies official crates.io
// endpoints onto loopback; Cargo still verifies registry checksums.
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const cache = resolve(".build-cache/registry");
await mkdir(cache, { recursive: true });
let active = 0;
const queue = [];
async function limited(work) {
  if (active >= 6) await new Promise((resolve) => queue.push(resolve));
  active++;
  try {
    return await work();
  } finally {
    active--;
    queue.shift()?.();
  }
}
const server = createServer(async (request, response) => {
  try {
    const path = new URL(request.url, "http://127.0.0.1").pathname;
    if (path === "/config.json") {
      response.setHeader("Content-Type", "application/json");
      response.end(
        JSON.stringify({
          dl: "http://127.0.0.1:1421/crates/{crate}/{version}/download",
          api: "https://crates.io",
        }),
      );
      return;
    }
    if (!/^\/[a-zA-Z0-9_./+-]+$/.test(path) || path.includes("..")) {
      response.writeHead(400).end();
      return;
    }
    const crate = path.match(/^\/crates\/([\w-]+)\/([\w.+-]+)\/download$/);
    const url = crate
      ? `https://static.crates.io/crates/${crate[1]}/${crate[1]}-${crate[2]}.crate`
      : `https://index.crates.io${path}`;
    const file = resolve(cache, Buffer.from(path).toString("base64url"));
    let bytes;
    try {
      bytes = await readFile(file);
    } catch {
      bytes = await limited(async () => {
        const head = await fetch(url, {
          method: "HEAD",
          signal: AbortSignal.timeout(30000),
        });
        if (!head.ok) return { status: head.status };
        const length = Number(head.headers.get("content-length"));
        if (length > 350000) {
          const parts = [];
          for (let offset = 0; offset < length; offset += 131072) {
            parts.push(
              (async () => {
                const end = Math.min(length - 1, offset + 131071);
                const part = await fetch(url, {
                  headers: {
                    Range: `bytes=${offset}-${end}`,
                    "Accept-Encoding": "identity",
                  },
                  signal: AbortSignal.timeout(180000),
                });
                if (part.status !== 206)
                  throw new Error("Range download unavailable");
                const value = Buffer.from(await part.arrayBuffer());
                if (value.length !== end - offset + 1)
                  throw new Error("Incomplete range");
                return value;
              })(),
            );
          }
          return Buffer.concat(await Promise.all(parts));
        }
        const fetched = await fetch(url, {
          signal: AbortSignal.timeout(180000),
        });
        if (!fetched.ok) return { status: fetched.status };
        return Buffer.from(await fetched.arrayBuffer());
      });
      if (!Buffer.isBuffer(bytes)) {
        response.writeHead(bytes.status).end();
        return;
      }
      await writeFile(file, bytes);
    }
    response.setHeader("Content-Type", "application/octet-stream");
    response.setHeader("Cache-Control", "public, max-age=600");
    response.end(bytes);
  } catch (error) {
    console.error(error.message);
    response.writeHead(502).end("Official registry fetch failed");
  }
});
server.listen(1421, "127.0.0.1", () =>
  console.log("Official crates.io compatibility proxy: http://127.0.0.1:1421"),
);
