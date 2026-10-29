import { t } from "../i18n";
import {
  foldGutter,
  foldKeymap,
  foldService,
  syntaxTree,
  codeFolding,
} from "@codemirror/language";
import {
  keymap,
  ViewPlugin,
  type EditorView,
  type ViewUpdate,
} from "@codemirror/view";
import { EditorState } from "@codemirror/state";
// Gutter blocks include heading padding and wrapped lines. Align the icon with
// the first visible text line, without changing CodeMirror's text coordinates.
const alignFoldMarkers = ViewPlugin.fromClass(
  class {
    constructor(readonly view: EditorView) {
      this.measure();
    }
    update(update: ViewUpdate) {
      if (update.geometryChanged || update.docChanged || update.selectionSet)
        this.measure();
    }
    measure() {
      this.view.requestMeasure({
        key: this,
        read: (view) => {
          const offsets: {
            marker: HTMLElement;
            offset: number;
          }[] = [];
          for (const marker of view.dom.querySelectorAll<HTMLElement>(
            ".fold-toggle",
          )) {
            const cell = marker.parentElement;
            if (!cell || cell.style.visibility === "hidden") continue;
            const cellRect = cell.getBoundingClientRect();
            if (!cellRect.height) continue;
            const block = view.lineBlockAtHeight(
              cellRect.top - view.documentTop + 1,
            );
            const at = view.domAtPos(block.from);
            let line = (
              at.node instanceof Element ? at.node : at.node.parentElement
            )?.closest(".cm-line");
            if (!line && at.node instanceof Element) {
              const child = at.node.childNodes[at.offset];
              if (child instanceof Element) line = child.closest(".cm-line");
            }
            let offset = 0;
            if (line?.classList.contains("live-heading")) {
              const walker = document.createTreeWalker(
                line,
                NodeFilter.SHOW_TEXT,
              );
              let text = walker.nextNode();
              while (text) {
                if (
                  text.textContent?.trim() &&
                  !/^[#\s]+$/.test(text.textContent)
                ) {
                  const range = document.createRange();
                  const start = text.textContent.search(/\S/);
                  range.setStart(text, start);
                  range.setEnd(text, start + 1);
                  if (typeof range.getBoundingClientRect === "function") {
                    const rect = range.getBoundingClientRect();
                    if (rect.height) {
                      offset =
                        rect.top +
                        rect.height / 2 -
                        (cellRect.top + cellRect.height / 2);
                      break;
                    }
                  }
                }
                text = walker.nextNode();
              }
            }
            offsets.push({ marker, offset });
          }
          return offsets;
        },
        write: (offsets) => {
          for (const { marker, offset } of offsets)
            marker.style.transform = offset ? `translateY(${offset}px)` : "";
        },
      });
    }
  },
);
export const noteFolding = [
  codeFolding({ placeholderText: "…" }),
  alignFoldMarkers,
  EditorState.phrases.of({
    "Fold line": "Свернуть раздел",
    "Unfold line": "Развернуть раздел",
    "folded code": "Свёрнутый текст",
    unfold: "Развернуть",
  }),
  foldService.of((state, from, to) => {
    const header = /^\uFEFF?---\n[\s\S]*?\n(?:---|\.\.\.)(?:\n|$)/.exec(
      state.doc.sliceString(0, Math.min(state.doc.length, 65536)),
    );
    if (header && from < header[0].length) return null;
    const tree = syntaxTree(state);
    let section: {
      from: number;
      to: number;
    } | null = null;
    tree.iterate({
      enter(node) {
        if (
          /^(ATXHeading|SetextHeading)/.test(node.name) &&
          node.from >= from &&
          node.from <= to
        ) {
          const level = Number(node.name.at(-1));
          let end = node.node.parent?.to ?? state.doc.length;
          tree.iterate({
            from: node.to,
            enter(next) {
              if (
                /^(ATXHeading|SetextHeading)/.test(next.name) &&
                next.from > node.from &&
                Number(next.name.at(-1)) <= level
              ) {
                end = Math.min(end, Math.max(to, next.from - 1));
              }
            },
          });
          if (end > to) section = { from: to, to: end };
        }
        if (
          node.name === "ListItem" &&
          node.from >= from &&
          node.from <= to &&
          node.to > to
        )
          section = { from: to, to: node.to };
      },
    });
    return section;
  }),
  foldGutter({
    markerDOM(open) {
      const marker = document.createElement("span");
      marker.className = "fold-toggle";
      marker.dataset.foldState = open ? "open" : "closed";
      marker.title = open ? t("Свернуть раздел") : t("Развернуть раздел");
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("width", "14");
      svg.setAttribute("height", "14");
      svg.setAttribute("viewBox", "0 0 24 24");
      svg.setAttribute("fill", "none");
      svg.setAttribute("stroke", "currentColor");
      svg.setAttribute("stroke-width", "1.8");
      svg.setAttribute("stroke-linecap", "round");
      svg.setAttribute("stroke-linejoin", "round");
      svg.setAttribute("aria-hidden", "true");
      const path = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "path",
      );
      path.setAttribute("d", open ? "m6 9 6 6 6-6" : "m9 6 6 6-6 6");
      svg.append(path);
      marker.append(svg);
      return marker;
    },
  }),
  keymap.of(foldKeymap),
];
