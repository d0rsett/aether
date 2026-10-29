import { t, subscribeLocale } from "../i18n";
import { createRoot, type Root } from "react-dom/client";
import { undo, redo } from "@codemirror/commands";
import {
  Facet,
  StateEffect,
  StateField,
  type EditorState,
  type Extension,
  type Text,
  Text as EditorText,
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
import { toggleTask } from "./tasks";
import type { NotePreviews } from "../services/notePreviews";
import { parseTable } from "./tables";
interface Config {
  previews?: NotePreviews;
  onNavigate?: (source: string, target: string) => void;
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
const rememberFootnote = StateEffect.define<{
  target: string;
  position: number;
}>();
const footnoteReturn = StateField.define<{
  target: string;
  position: number;
} | null>({
  create: () => null,
  update(value, transaction) {
    if (value && transaction.docChanged)
      value = {
        ...value,
        position: transaction.changes.mapPos(value.position),
      };
    for (const effect of transaction.effects)
      if (effect.is(rememberFootnote)) value = effect.value;
    return value;
  },
});
function attachment(node: RenderNode) {
  return (
    node.kind === "image" || node.kind === "embed" || node.kind === "embedLimit"
  );
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
    const tableSource =
      node.kind === "table" ? doc.sliceString(first.from, last.to) : "";
    const validTable =
      node.kind === "table" &&
      /^[\t >]*$/.test(doc.sliceString(first.from, range.from)) &&
      !!parseTable(tableSource);
    if (node.kind === "table" && !validTable) return;
    if (forceBlock && !wholeLine && !validTable) return;
    const block =
      !["highlight", "task"].includes(node.kind) && (forceBlock || wholeLine);
    if (!block && first.number !== last.number && node.kind !== "comment")
      return;
    spans.push({
      from: block ? first.from : range.from,
      to: block ? last.to : to,
      node,
      block,
      key:
        node.kind === "table"
          ? doc.sliceString(
              block ? first.from : range.from,
              block ? last.to : to,
            )
          : fingerprint(node),
    });
  };
  const visit = (node: RenderNode) => {
    // Obsidian keeps inline footnote source visible while editing.
    if (node.kind === "inlineFootnote") return;
    if (
      node.kind === "table" ||
      node.kind === "footnote" ||
      node.kind === "callout" ||
      (node.kind === "codeBlock" && node.target === "mermaid")
    ) {
      add(node, node, true);
      return;
    }
    if (node.kind === "paragraph") {
      if (node.children.some((child) => child.kind === "literalHtml")) {
        add(node, node, true);
        return;
      }
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
    if (
      ["highlight", "comment", "task", "footnoteRef"].includes(node.kind) ||
      node.kind === "math" ||
      attachment(node)
    ) {
      add(node, node, node.kind === "math" && node.level === 1);
      return;
    }
    if (node.kind === "literalHtml") {
      add(node, node, true);
      return;
    }
    if (["codeBlock", "code"].includes(node.kind)) return;
    node.children.forEach(visit);
  };
  nodes.forEach(visit);
  return spans
    .sort((a, b) => a.from - b.from)
    .reduce<RichSpan[]>((result, span) => {
      if (!result.length || span.from >= result[result.length - 1].to)
        result.push(span);
      return result;
    }, []);
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
    refreshTable?: (span: RichSpan) => void;
    releaseLocale?: () => void;
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
      (this.span.node.kind !== "table" ||
        fingerprint(this.span.node) === fingerprint(other.span.node)) &&
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
    if (
      entry?.refreshTable &&
      ["table", "callout"].includes(this.span.node.kind)
    ) {
      entry.refreshTable(this.span);
      return true;
    }
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
        ? t("таблицу")
        : this.span.node.kind === "callout"
          ? t("выноску")
          : this.span.node.kind === "comment"
            ? t("комментарий")
            : this.span.node.kind === "footnote"
              ? t("сноску")
              : ["literalHtml", "paragraph"].includes(this.span.node.kind)
                ? t("HTML-блок")
                : this.span.node.kind === "codeBlock"
                  ? t("диаграмму")
                  : this.span.node.kind === "math"
                    ? t("формулу")
                    : t("блок");
    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "live-edit-source";
    edit.textContent = t("Изменить");
    edit.setAttribute("aria-label", t`Изменить ${label}`);
    const releaseLocale = subscribeLocale(() => {
      edit.textContent = t("Изменить");
      edit.setAttribute("aria-label", t`Изменить ${t(label)}`);
    });
    const reveal = () => {
      // Decorations may have moved since this widget was created. Ask the current view.
      const pos = view.posAtDOM(dom);
      const span = view.state
        .field(richPreviewState)
        .spans.find(
          (candidate) =>
            candidate.from <= pos &&
            candidate.to >= pos &&
            candidate.node.kind === this.span.node.kind,
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
        !event.target.closest(
          "a,button,input,textarea,select,dialog,iframe,audio,video",
        )
      )
        reveal();
    });
    if (
      !attachment(this.span.node) &&
      this.span.node.kind !== "table" &&
      !["highlight", "task"].includes(this.span.node.kind)
    )
      dom.append(edit);
    const content = document.createElement(this.span.block ? "div" : "span");
    content.className = this.span.block
      ? "live-render-content reading-document"
      : "live-render-content";
    dom.append(content);
    const root = createRoot(content);
    let tableSource = view.state.doc.sliceString(this.span.from, this.span.to);
    let tableVersion = 0;
    let renderedTable = fingerprint(this.span.node);
    let blockFrom = this.span.from;
    const nested = new Map<
      RenderNode,
      {
        from: number;
        to: number;
        source: string;
      }
    >();
    const prepareNested = (node: RenderNode) => {
      nested.clear();
      const visit = (child: RenderNode) => {
        if (child.kind === "table") {
          let end = child.to;
          while (
            end > child.from &&
            view.state.doc.sliceString(end - 1, end) === "\n"
          )
            end--;
          const from = view.state.doc.lineAt(child.from).from - blockFrom;
          const to = view.state.doc.lineAt(end).to - blockFrom;
          const source = tableSource.slice(from, to);
          if (from >= 0 && to <= tableSource.length && parseTable(source))
            nested.set(child, { from, to, source });
        } else child.children.forEach(visit);
      };
      if (node.kind === "callout") visit(node);
    };
    prepareNested(this.span.node);
    const render = (node: RenderNode) =>
      root.render(
        renderNode(node, {
          ...this.config,
          tableFor: (node) => {
            const slot = nested.get(node);
            if (!slot) return undefined;
            return {
              source: slot.source,
              version: tableVersion,
              onHistory: (forward) => (forward ? redo(view) : undo(view)),
              apply: (value) => {
                const pos = view.posAtDOM(dom);
                const current = view.state
                  .field(richPreviewState)
                  .spans.find(
                    (span) =>
                      span.node.kind === "callout" &&
                      span.from <= pos &&
                      span.to >= pos,
                  );
                if (
                  !current ||
                  view.state.readOnly ||
                  view.state.doc.sliceString(current.from, current.to) !==
                    tableSource
                )
                  throw new Error("stale callout table");
                const from = slot.from,
                  to = slot.to;
                tableSource =
                  tableSource.slice(0, from) + value + tableSource.slice(to);
                const delta = value.length - (to - from);
                slot.source = value;
                slot.to = from + value.length;
                for (const other of nested.values())
                  if (other !== slot && other.from >= to) {
                    other.from += delta;
                    other.to += delta;
                  }
                view.dispatch({
                  changes: {
                    from: current.from + from,
                    to: current.from + to,
                    insert: EditorText.of(value.split("\n")),
                  },
                  userEvent: "input.table",
                });
              },
            };
          },
          onFootnote: (target, back, from) => {
            const spans = view.state.field(richPreviewState).spans;
            const destination = spans.find(
              (span) =>
                span.node.kind === (back ? "footnoteRef" : "footnote") &&
                span.node.target === target,
            );
            const saved = view.state.field(footnoteReturn);
            const position =
              back && saved?.target === target
                ? saved.position
                : destination?.from;
            if (position !== undefined) {
              const current = spans.find(
                (span) =>
                  span.key === this.span.key &&
                  span.from <= view.posAtDOM(dom) &&
                  span.to >= view.posAtDOM(dom),
              );
              view.dispatch({
                selection: { anchor: position },
                effects: [
                  EditorView.scrollIntoView(position, {
                    y: "center",
                  }),
                  ...(!back
                    ? [
                        rememberFootnote.of({
                          target,
                          position:
                            from +
                            (current ? current.from - this.span.from : 0),
                        }),
                      ]
                    : []),
                ],
              });
              view.focus();
            } else this.config.onError(t("Сноска не найдена в заметке."));
          },
          table:
            this.span.node.kind === "table"
              ? {
                  source: tableSource,
                  version: tableVersion,
                  onHistory: (forward) => (forward ? redo(view) : undo(view)),
                  apply: (value) => {
                    const pos = view.posAtDOM(dom);
                    const current = view.state
                      .field(richPreviewState)
                      .spans.find(
                        (span) =>
                          span.from <= pos &&
                          span.to >= pos &&
                          span.node.kind === "table",
                      );
                    const expected = tableSource;
                    if (
                      !current ||
                      view.state.readOnly ||
                      view.state.doc.sliceString(current.from, current.to) !==
                        expected
                    )
                      throw new Error("stale table");
                    tableSource = value;
                    view.dispatch({
                      changes: {
                        from: current.from,
                        to: current.to,
                        insert: EditorText.of(value.split("\n")),
                      },
                      userEvent: "input.table",
                    });
                  },
                }
              : undefined,
          onWiki: this.config.onWiki,
          onError: this.config.onError,
          onTask: (node) => {
            const pos = view.posAtDOM(dom);
            const current = view.state
              .field(richPreviewState)
              .spans.find(
                (span) =>
                  span.from <= pos &&
                  span.to >= pos &&
                  span.node.kind === this.span.node.kind,
              );
            if (!current) return;
            const shift = current.from - this.span.from;
            toggleTask(
              view,
              { ...node, from: node.from + shift, to: node.to + shift },
              view.state.sliceDoc(),
            );
          },
        }),
      );
    render(this.span.node);
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => {
            if (mounted.has(dom)) view.requestMeasure();
          });
    observer?.observe(dom);
    mounted.set(dom, {
      releaseLocale,
      root,
      observer,
      attachmentIdentity: this.attachmentIdentity(),
      refreshTable: ["table", "callout"].includes(this.span.node.kind)
        ? (span) => {
            blockFrom = span.from;
            const source = view.state.doc.sliceString(span.from, span.to);
            const parsed = fingerprint(span.node);
            if (source !== tableSource) {
              const focused = document.activeElement;
              const input =
                focused instanceof HTMLTextAreaElement && dom.contains(focused)
                  ? focused
                  : null;
              const label = input?.getAttribute("aria-label");
              const focusedTable = input?.closest(".inline-table-editor");
              const tableIndex = focusedTable
                ? [...dom.querySelectorAll(".inline-table-editor")].indexOf(
                    focusedTable,
                  )
                : -1;
              const row = Number(input?.dataset.row ?? 0),
                column = Number(input?.dataset.column ?? 0);
              const start = input?.selectionStart;
              const end = input?.selectionEnd;
              tableSource = source;
              tableVersion++;
              renderedTable = parsed;
              prepareNested(span.node);
              render(span.node);
              if (label)
                requestAnimationFrame(() => {
                  if (!dom.isConnected || !view.dom.isConnected) return;
                  if (
                    document.activeElement !== document.body &&
                    document.activeElement !== focused
                  )
                    return;
                  const table = [
                    ...dom.querySelectorAll(".inline-table-editor"),
                  ][tableIndex];
                  const cells = [
                    ...(table?.querySelectorAll("textarea") ?? []),
                  ];
                  const lastRow = Math.max(
                    0,
                    ...cells.map((cell) => Number(cell.dataset.row ?? 0)),
                  );
                  const lastColumn = Math.max(
                    0,
                    ...cells.map((cell) => Number(cell.dataset.column ?? 0)),
                  );
                  const replacement = cells.find(
                    (cell) =>
                      Number(cell.dataset.row) === Math.min(row, lastRow) &&
                      Number(cell.dataset.column) ===
                        Math.min(column, lastColumn),
                  );
                  replacement?.focus();
                  if (replacement && start != null && end != null)
                    replacement.setSelectionRange(start, end);
                });
            } else if (parsed !== renderedTable) {
              renderedTable = parsed;
              prepareNested(span.node);
              render(span.node);
            }
          }
        : undefined,
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
    entry.releaseLocale?.();
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
      if (active(state, span) && span.node.kind !== "task") return [];
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
    const mapNode = (node: RenderNode): RenderNode => ({
      ...node,
      from: tr.changes.mapPos(node.from, -1),
      to: tr.changes.mapPos(node.to, 1),
      children: node.children.map(mapNode),
    });
    if (tr.docChanged)
      spans = spans.flatMap((span) => {
        const from = tr.changes.mapPos(
          span.from,
          ["table", "callout"].includes(span.node.kind) ? -1 : 1,
        );
        const to = tr.changes.mapPos(
          span.to,
          ["table", "callout"].includes(span.node.kind) ? 1 : -1,
        );
        if (from >= to) return [];
        if (tr.changes.touchesRange(span.from, span.to)) {
          if (span.node.kind === "table" || span.node.kind === "callout")
            return [
              {
                ...span,
                from,
                to,
                node:
                  span.node.kind === "callout" ? mapNode(span.node) : span.node,
                key: tr.state.doc.sliceString(from, to),
              },
            ];
          if (!attachment(span.node)) return [];
          const source = tr.state.doc.sliceString(from, to);
          // Keep the preview while its label or adjacent prose is being edited.
          // The asynchronous parser will refresh the label afterwards.
          if (!source.includes(span.node.target) || !/!\[/.test(source))
            return [];
        }
        return [
          {
            ...span,
            from,
            to,
            node: span.node.kind === "callout" ? mapNode(span.node) : span.node,
          },
        ];
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
  return [configuration.of(config), footnoteReturn, richPreviewState, loader];
}
