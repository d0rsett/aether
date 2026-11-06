import { imageExtension } from "./images";

export const canvasFileDragType = "application/x-aether-canvas-file";
export const markdownFile = /\.(md|markdown)$/i;
export const mediaFile =
  /\.(pdf|mp3|wav|ogg|m4a|flac|3gp|mp4|webm|mov|mkv|ogv)$/i;

export function canvasFilePath(path: unknown): path is string {
  return (
    typeof path === "string" &&
    path.length <= 4096 &&
    !/[\uD800-\uDFFF]/u.test(path) &&
    path
      .split("/")
      .every(
        (part) =>
          part.length > 0 &&
          part !== "." &&
          part !== ".." &&
          !/[\\:<>|"\x00-\x1f?*]/.test(part) &&
          ![".aether", ".obsidian", ".git"].includes(part.toLowerCase()),
      )
  );
}

export function isCanvasAttachment(path: string): boolean {
  return (
    markdownFile.test(path) || !!imageExtension(path) || mediaFile.test(path)
  );
}

export function canvasFileTarget(path: string): string {
  return "/" + path.split("/").map(encodeURIComponent).join("/");
}

export function readCanvasFileDrag(
  raw: string,
  vaultId: string,
): string | null {
  try {
    const payload: unknown = JSON.parse(raw);
    if (
      !payload ||
      typeof payload !== "object" ||
      !("vaultId" in payload) ||
      payload.vaultId !== vaultId ||
      !("path" in payload) ||
      !canvasFilePath(payload.path)
    )
      return null;
    const path = payload.path;
    return isCanvasAttachment(path) ? path : null;
  } catch {
    return null;
  }
}
