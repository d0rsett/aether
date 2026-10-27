import type { RenderNode } from "./api";

export function attachmentExtension(target: string): string | null {
  if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(target)) return null;
  let path = target.split("#")[0];
  try {
    path = decodeURIComponent(path);
  } catch {
    /* Keep malformed paths visible as unresolved attachments. */
  }
  return (
    /\.(png|jpe?g|gif|webp|svg|bmp|pdf|mp3|wav|ogg|m4a|flac|3gp|mp4|webm|mov|mkv|ogv|canvas|txt|csv|docx|xlsx|pptx|zip)$/i
      .exec(path)?.[1]
      .toUpperCase() ?? null
  );
}

export interface AttachmentReference {
  target: string;
  wiki: boolean;
  label: string;
  extension: string;
}
function text(node: RenderNode): string {
  return node.text || node.children.map(text).join("");
}
export function collectAttachments(nodes: RenderNode[]): AttachmentReference[] {
  const result = new Map<string, AttachmentReference>();
  const visit = (node: RenderNode) => {
    if (["codeBlock", "code", "literalHtml"].includes(node.kind)) return;
    const extension = attachmentExtension(node.target);
    if (extension && ["embed", "image", "wiki", "link"].includes(node.kind)) {
      const wiki = node.kind === "embed" || node.kind === "wiki";
      let label =
        !wiki || node.hasAlias ? node.children.map(text).join("") : "";
      const parts = label.split("|");
      if (/^\d+(?:x\d+)?$/.test(parts.at(-1)?.trim() || ""))
        label = parts.slice(0, -1).join("|");
      const key = `${wiki}:${node.target}`;
      const previous = result.get(key);
      if (!previous || (!previous.label && label.trim()))
        result.set(key, {
          target: node.target,
          wiki,
          label: label.trim(),
          extension,
        });
      return;
    }
    node.children.forEach(visit);
  };
  nodes.forEach(visit);
  return [...result.values()];
}
