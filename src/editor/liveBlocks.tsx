import { createRoot, type Root } from "react-dom/client";
import {
  Facet,
  StateEffect,
  StateField,
  type EditorState,
  type Extension,
  type Text,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import { api, errorMessage, type RenderNode } from "../services/api";
import { renderNode } from "../reading/ReadingView";

interface Config {
  vaultId: string;
  path: string;
  theme: string;
  onWiki: (target: string) => void;
  onError: (message: string) => void;
}
export interface RichSpan {
  from: number;
  to: number;
  node: RenderNode;
  block: boolean;
  key: string;
}
interface Preview {
  spans: RichSpan[];
  decorations: DecorationSet;
}
const configuration = Facet.define<Config, Config | null>({
  combine: (values) => values[0] ?? null,
});
export const parsedPreview = StateEffect.define<{
  doc: Text;
  spans: RichSpan[];
}>();
function attachment(node: RenderNode) {
  return node.kind === "image" || node.kind === "embed";
}
function fingerprint(node: RenderNode): string {
  return JSON.stringify(node, (key, value: unknown) =>
    ["from", "to", "line", "endLine"].includes(key) ? undefined : value,
  );
}

export function collectRichSpans(nodes: RenderNode[], doc: Text): RichSpan[] {
  const spans: RichSpan[] = [];
  const add = (node: RenderNode, range = node, forceBlock = false) => {
    if (range.from < 0 || range.to > doc.length || range.from >= range.to)
      return;
    let to = range.to;
    while (to > range.from && doc.sliceString(to - 1, to) === "\n") to--;
    if (to <= range.from) return;
    const first = doc.lineAt(range.from),
      last = doc.lineAt(to);
    const wholeLine =
      !doc.sliceString(first.from, range.from).trim() &&
      !doc.sliceString(to, last.to).trim();
    if (forceBlock && !wholeLine) return;
    const block = forceBlock || wholeLine;
    if (!block && first.number !== last.number) return;
    spans.push({
      from: block ? first.from : range.from,
      to: block ? last.to : to,
      node,
      block,
      key: fingerprint(node),
    });
  };
  const visit = (node: RenderNode) => {
    if (
      node.kind === "table" ||
      (node.kind === "codeBlock" && node.target === "mermaid")
    ) {
      add(node, node, true);
      return;
    }
    if (node.kind === "paragraph") {
      const meaningful = node.children.filter(
        (child) => child.kind !== "text" || child.text.trim(),
      );
      if (
        meaningful.length === 1 &&
        (attachment(meaningful[0]) ||
          (meaningful[0].kind === "math" && meaningful[0].level === 1))
      ) {
        add(meaningful[0], node, true);
        return;
      }
    }
    if (node.kind === "math" || attachment(node)) {
      add(node, node, node.kind === "math" && node.level === 1);
      return;
    }
    if (["codeBlock", "literalHtml", "code"].includes(node.kind)) return;
    node.children.forEach(visit);
  };
  nodes.forEach(visit);
  return spans
    .sort((a, b) => a.from - b.from)
    .filter((span, index, all) => !index || span.from >= all[index - 1].to);
}

function active(state: EditorState, span: RichSpan): boolean {
  return state.selection.ranges.some(
    (range) =>
      state.doc.lineAt(range.from).from <= span.to &&
      state.doc.lineAt(range.to).to >= span.from,
  );
}
const mounted = new WeakMap<
  HTMLElement,
  {
    root: Root;
    observer: ResizeObserver | null;
    attachmentIdentity: string | null;
  }
>();
class RichWidget extends WidgetType {
  constructor(
    readonly span: RichSpan,
    readonly config: Config,
  ) {
    super();
  }
  eq(other: RichWidget) {
    return (
      this.span.key === other.span.key &&
      this.span.block === other.span.block &&
      this.config.theme === other.config.theme &&
      this.config.vaultId === other.config.vaultId &&
      this.config.path === other.config.path
    );
  }
  get estimatedHeight() {
    return this.span.block ? (this.span.node.kind === "math" ? 90 : 220) : -1;
  }
  private attachmentIdentity() {
    return attachment(this.span.node)
      ? JSON.stringify([
          this.config.vaultId,
          this.config.path,
          this.span.node.kind,
          this.span.node.target,
        ])
      : null;
  }
  updateDOM(dom: HTMLElement) {
    const entry = mounted.get(dom);
    const identity = this.attachmentIdentity();
    if (!entry || !identity || entry.attachmentIdentity !== identity)
      return false;
    entry.root.render(renderNode(this.span.node, this.config));
    return true;
  }
  toDOM(view: EditorView): HTMLElement {
    const dom = document.createElement(this.span.block ? "div" : "span");
    dom.className = this.span.block
      ? "live-block-preview"
      : "live-inline-preview";
    dom.contentEditable = "false";
    dom.dataset.liveKind = this.span.node.kind;
    if (attachment(this.span.node)) dom.dataset.sourceVisible = "true";
    const label =
      this.span.node.kind === "table"
        ? "таблицу"
        : this.span.node.kind === "codeBlock"
          ? "диаграмму"
          : this.span.node.kind === "math"
            ? "формулу"
            : "изображение";
    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "live-edit-source";
    edit.textContent = "Изменить";
    edit.setAttribute("aria-label", `Изменить ${label}`);
    const reveal = () => {
      // Decorations may have moved since this widget was created. Ask the current view.
      const pos = view.posAtDOM(dom);
      const span = view.state
        .field(richPreviewState)
        .spans.find(
          (candidate) =>
            candidate.from <= pos &&
            candidate.to >= pos &&
            candidate.key === this.span.key,
        );
      if (!span) return;
      view.dispatch({
        selection: { anchor: span.from },
        effects: EditorView.scrollIntoView(span.from, { y: "center" }),
      });
      view.focus();
    };
    edit.addEventListener("mousedown", (event) => event.preventDefault());
    edit.addEventListener("click", reveal);
    dom.addEventListener("dblclick", (event) => {
      if (
        !(event.target instanceof Element) ||
        !event.target.closest("a,button,iframe")
      )
        reveal();
    });
    if (!attachment(this.span.node)) dom.append(edit);
    const content = document.createElement(this.span.block ? "div" : "span");
    content.className = this.span.block
      ? "live-render-content reading-document"
      : "live-render-content";
    dom.append(content);
    const root = createRoot(content);
    root.render(
      renderNode(this.span.node, {
        ...this.config,
        onWiki: this.config.onWiki,
        onError: this.config.onError,
      }),
    );
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => {
            if (mounted.has(dom)) view.requestMeasure();
          });
    observer?.observe(dom);
    mounted.set(dom, {
      root,
      observer,
      attachmentIdentity: this.attachmentIdentity(),
    });
    return dom;
  }
  ignoreEvent() {
    return true;
  }
  destroy(dom: HTMLElement) {
    const entry = mounted.get(dom);
    if (!entry) return;
    entry.observer?.disconnect();
    mounted.delete(dom);
    queueMicrotask(() => entry.root.unmount());
  }
}
function decorations(spans: RichSpan[], state: EditorState): DecorationSet {
  const config = state.facet(configuration);
  if (!config) return Decoration.none;
  return Decoration.set(
    spans.flatMap((span) => {
      if (attachment(span.node)) {
        const line = state.doc.lineAt(span.to);
        const preview = Decoration.widget({
          widget: new RichWidget({ ...span, block: true }, config),
          block: true,
          side: 1,
        }).range(line.to);
        return span.block
          ? [
              Decoration.line({ class: "live-attachment-source-line" }).range(
                state.doc.lineAt(span.from).from,
              ),
              preview,
            ]
          : [preview];
      }
      if (active(state, span)) return [];
      return [
        Decoration.replace({
          widget: new RichWidget(span, config),
          block: span.block,
        }).range(span.from, span.to),
      ];
    }),
    true,
  );
}
export const richPreviewState = StateField.define<Preview>({
  create: () => ({ spans: [], decorations: Decoration.none }),
  update(value, tr) {
    let spans = value.spans;
    if (tr.docChanged)
      spans = spans.flatMap((span) => {
        const from = tr.changes.mapPos(span.from, 1);
        const to = tr.changes.mapPos(span.to, -1);
        if (from >= to) return [];
        if (tr.changes.touchesRange(span.from, span.to)) {
          if (!attachment(span.node)) return [];
          const source = tr.state.doc.sliceString(from, to);
          // Keep the preview while its label or adjacent prose is being edited.
          // The asynchronous parser will refresh the label afterwards.
          if (!source.includes(span.node.target) || !/!\[/.test(source))
            return [];
        }
        return [{ ...span, from, to }];
      });
    for (const effect of tr.effects)
      if (effect.is(parsedPreview) && effect.value.doc === tr.state.doc)
        spans = effect.value.spans;
    return tr.docChanged ||
      tr.selection ||
      tr.effects.some((effect) => effect.is(parsedPreview))
      ? { spans, decorations: decorations(spans, tr.state) }
      : value;
  },
  provide: (field) =>
    EditorView.decorations.from(field, (value) => value.decorations),
});

const loader = ViewPlugin.fromClass(
  class {
    private timer: ReturnType<typeof setTimeout> | undefined;
    private disposed = false;
    private generation = 0;
    constructor(readonly view: EditorView) {
      this.schedule();
    }
    update(update: ViewUpdate) {
      if (update.docChanged) this.schedule();
    }
    schedule() {
      clearTimeout(this.timer);
      const generation = ++this.generation;
      this.timer = setTimeout(() => {
        const config = this.view.state.facet(configuration);
        if (!config || this.disposed) return;
        const doc = this.view.state.doc;
        void api
          .renderMarkdown(
            config.vaultId,
            config.path,
            this.view.state.sliceDoc(),
          )
          .then((result) => {
            if (
              !this.disposed &&
              this.generation === generation &&
              this.view.state.doc === doc
            )
              this.view.dispatch({
                effects: parsedPreview.of({
                  doc,
                  spans: collectRichSpans(result.nodes, doc),
                }),
              });
          })
          .catch((error) => {
            if (!this.disposed && this.generation === generation)
              config.onError(errorMessage(error));
          });
      }, 160);
    }
    destroy() {
      this.disposed = true;
      ++this.generation;
      clearTimeout(this.timer);
    }
  },
);
export function richPreview(config: Config): Extension {
  return [configuration.of(config), richPreviewState, loader];
}
