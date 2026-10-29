import {
  closeHoverTooltips,
  hasHoverTooltips,
  hoverTooltip,
  keymap,
} from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { createRoot } from "react-dom/client";
import { NoteEmbed } from "../reading/NoteEmbed";
import { api, type RenderNode } from "../services/api";
import type { RenderContext } from "../reading/ReadingView";

export function noteLinkHover(context: RenderContext) {
  let previousDoc: object | undefined;
  let parsed: ReturnType<typeof api.renderMarkdown> | undefined;
  return [
    hoverTooltip(
      async (view, position) => {
        const node = syntaxTree(view.state).resolveInner(position, -1);
        let candidate = false;
        for (
          let parent: typeof node | null = node;
          parent;
          parent = parent.parent
        ) {
          if (/Code|Image/.test(parent.name)) return null;
          if (parent.name === "Link") candidate = true;
        }
        const line = view.state.doc.lineAt(position);
        for (const match of line.text.matchAll(/\[\[([^\]\n]+)\]\]/g)) {
          const from = line.from + (match.index ?? 0);
          if (position >= from && position <= from + match[0].length)
            candidate = true;
        }
        if (!candidate) return null;
        const doc = view.state.doc;
        if (doc !== previousDoc) {
          previousDoc = doc;
          parsed = api.renderMarkdown(
            context.vaultId,
            context.path,
            view.state.sliceDoc(),
          );
        }
        let document;
        try {
          document = await parsed;
        } catch {
          return null;
        }
        if (view.state.doc !== doc || !document) return null;
        let link: RenderNode | undefined;
        const visit = (node: RenderNode) => {
          if (node.from > position || node.to < position) return;
          if (node.kind === "link" || node.kind === "wiki") link = node;
          else node.children.forEach(visit);
        };
        document.nodes.forEach(visit);
        if (
          !link ||
          /^[a-z][a-z0-9+.-]*:/i.test(link.target) ||
          /\.(pdf|png|jpe?g|svg|webp|gif|bmp|mp\d|wav|ogg|webm|m4a|flac|mov|mkv|canvas|txt|csv|docx|xlsx|pptx|zip)(#|$)/i.test(
            link.target,
          )
        )
          return null;
        const target = link.target,
          wiki = link.kind === "wiki";
        return {
          pos: link.from,
          end: link.to,
          above: false,
          create() {
            const dom = window.document.createElement("div");
            dom.className = "note-hover";
            dom.setAttribute("role", "region");
            dom.setAttribute("aria-label", "Предпросмотр ссылки");
            const root = createRoot(dom);
            root.render(
              <NoteEmbed
                preview
                target={target}
                label={target}
                wiki={wiki}
                context={context}
              />,
            );
            return {
              dom,
              destroy() {
                queueMicrotask(() => root.unmount());
              },
            };
          },
        };
      },
      { hoverTime: 450, hideOnChange: true },
    ),
    keymap.of([
      {
        key: "Escape",
        run: (view) => {
          if (!hasHoverTooltips(view.state)) return false;
          view.dispatch({ effects: closeHoverTooltips });
          return true;
        },
      },
    ]),
  ];
}
