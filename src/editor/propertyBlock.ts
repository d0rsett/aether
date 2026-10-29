import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { undo, redo } from "@codemirror/commands";
import { StateField, Transaction, type EditorState } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  WidgetType,
  type DecorationSet,
} from "@codemirror/view";
import { InlineProperties } from "../components/InlineProperties";
import { applyProperty } from "./propertyInput";
import { propertyBodyStart, readProperties } from "./properties";

interface Config {
  vaultId: string;
  path: string;
  onSource: () => void;
}
const roots = new WeakMap<
  HTMLElement,
  {
    root: Root;
    render: (content: string) => void;
    observer: ResizeObserver | null;
  }
>();
class PropertyWidget extends WidgetType {
  constructor(
    readonly content: string,
    readonly header: string,
    readonly config: Config,
  ) {
    super();
  }
  eq(other: PropertyWidget) {
    return (
      this.header === other.header &&
      this.config.vaultId === other.config.vaultId &&
      this.config.path === other.config.path
    );
  }
  updateDOM(dom: HTMLElement) {
    const entry = roots.get(dom);
    if (!entry) return false;
    entry.render(this.content);
    return true;
  }
  toDOM(view: EditorView) {
    const dom = document.createElement("div");
    dom.className = "live-property-block";
    dom.contentEditable = "false";
    const root = createRoot(dom);
    let expected = readProperties(this.content).expected;
    let applying = false;
    let accepted = [expected];
    const render = (content: string) => {
      const current = readProperties(content).expected;
      if (!applying && current !== expected) accepted = [];
      expected = current;
      if (!accepted.includes(current)) accepted.push(current);
      if (accepted.length > 8) accepted.shift();
      root.render(
        createElement(InlineProperties, {
          content,
          vaultId: this.config.vaultId,
          path: this.config.path,
          onSource: this.config.onSource,
          onHistory: (forward) => (forward ? redo(view) : undo(view)),
          onApply: (action, snapshot, done) => {
            try {
              if (!dom.isConnected || !view.dom.isConnected)
                throw new Error("Редактор больше недоступен.");
              if (!accepted.includes(snapshot))
                throw new Error(
                  "Свойства изменились. Проверьте значение и повторите попытку.",
                );
              applying = true;
              const hadHeader = /^\uFEFF?---\r?\n/.test(view.state.sliceDoc());
              applyProperty(view, action, expected);
              expected = readProperties(view.state.sliceDoc()).expected;
              if ("create" in action && action.create && !hadHeader) {
                const body = propertyBodyStart(view.state.sliceDoc());
                const selection = view.state.selection.main;
                if (body !== null && selection.empty && selection.head < body)
                  view.dispatch({
                    selection: { anchor: body },
                    annotations: Transaction.addToHistory.of(false),
                  });
              }
              done();
            } catch (error) {
              done(
                error instanceof Error
                  ? error.message
                  : "Не удалось изменить свойство.",
              );
            } finally {
              applying = false;
            }
          },
        }),
      );
    };
    render(this.content);
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => {
            if (roots.has(dom)) view.requestMeasure();
          });
    observer?.observe(dom);
    roots.set(dom, { root, render, observer });
    return dom;
  }
  ignoreEvent() {
    return true;
  }
  destroy(dom: HTMLElement) {
    const entry = roots.get(dom);
    if (!entry) return;
    entry.observer?.disconnect();
    roots.delete(dom);
    queueMicrotask(() => entry.root.unmount());
  }
}
function decoration(state: EditorState, config: Config): DecorationSet {
  const doc = state.doc;
  const first = doc.line(1);
  const hasHeader =
    first.text.replace(/^\uFEFF/, "") === "---" && doc.lines > 1;
  let end: number | null = null;
  if (hasHeader) {
    for (let i = 2; i <= doc.lines; i++) {
      const line = doc.line(i);
      if (line.from - first.from > 65536) break;
      if (/^[ \t]*(?:---|\.\.\.)[ \t]*$/.test(line.text)) {
        end = line.to;
        break;
      }
    }
  }
  const header = end === null ? "" : doc.sliceString(first.from, end);
  const widget = new PropertyWidget(state.sliceDoc(), header, config);
  if (
    end !== null &&
    state.selection.ranges.some(
      (range) => range.from <= end! && range.to >= first.from,
    )
  )
    return Decoration.none;
  if (end !== null)
    return Decoration.set([
      Decoration.replace({ widget, block: true }).range(first.from, end),
    ]);
  return Decoration.set([
    Decoration.widget({ widget, block: true, side: -1 }).range(first.from),
  ]);
}
export function propertyBlock(config: Config) {
  return StateField.define<DecorationSet>({
    create: (state) => decoration(state, config),
    update: (value, transaction) =>
      transaction.docChanged || transaction.selection
        ? decoration(transaction.state, config)
        : value,
    provide: (field) => EditorView.decorations.from(field),
  });
}
