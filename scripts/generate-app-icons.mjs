// Render the checked-in SVG so PNG, Windows ICO and macOS ICNS stay in sync.
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
} from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const icons = new URL("../src-tauri/icons/", import.meta.url);
const svg = await readFile(new URL("icon.svg", icons), "utf8");
const browser = await chromium.launch({
  headless: true,
  ...(process.platform === "win32" ? { channel: "msedge" } : {}),
});
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  const render = async (size) => {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(
      `<html><body style="margin:0;background:transparent">${svg.replace('width="512" height="512"', `width="${size}" height="${size}"`)}</body></html>`,
    );
    return page.screenshot({ omitBackground: true });
  };
  await writeFile(new URL("icon.png", icons), await render(1024));
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const images = [];
  for (const size of sizes) images.push(await render(size));
  const header = Buffer.alloc(6 + sizes.length * 16);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  sizes.forEach((size, i) => {
    const entry = 6 + i * 16;
    header[entry] = header[entry + 1] = size === 256 ? 0 : size;
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(images[i].length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += images[i].length;
  });
  await writeFile(
    new URL("icon.ico", icons),
    Buffer.concat([header, ...images]),
  );
  // The macOS bundler cannot convert a lone 1024px PNG into an ICNS family.
  // Use Tauri's generator to include its supported standard and Retina sizes.
  const cache = new URL("../.build-cache/", import.meta.url);
  await mkdir(cache, { recursive: true });
  const generated = await mkdtemp(join(fileURLToPath(cache), "app-icons-"));
  execFileSync(
    process.execPath,
    [
      fileURLToPath(
        new URL("../node_modules/@tauri-apps/cli/tauri.js", import.meta.url),
      ),
      "icon",
      fileURLToPath(new URL("icon.png", icons)),
      "--output",
      generated,
    ],
    { windowsHide: true, stdio: "pipe" },
  );
  await copyFile(join(generated, "icon.icns"), new URL("icon.icns", icons));
  console.log(
    `Generated PNG, Windows ICO and macOS ICNS in ${fileURLToPath(icons)}`,
  );
} finally {
  await browser.close();
}
