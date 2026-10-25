import { syntaxTree } from "@codemirror/language";
import type { Range } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import {
  autocompletion,
  pickedCompletion,
  type CompletionContext,
  type CompletionResult,
  type Completion,
} from "@codemirror/autocomplete";
import { api } from "../services/api";
export type FormatCommand =
  "bold" | "italic" | "code" | "heading" | "quote" | "list" | "link";
export function formatSelection(
  view: EditorView,
  command: FormatCommand,
): void {
  const { from, to } = view.state.selection.main;
  const selected = view.state.sliceDoc(from, to);
  if (["heading", "quote", "list"].includes(command)) {
    const first = view.state.doc.lineAt(from),
      last = view.state.doc.lineAt(to);
    const prefix =
      command === "heading" ? "## " : command === "quote" ? "> " : "- ";
    const lines = [];
    for (let line = first.number; line <= last.number; line++)
      lines.push(view.state.doc.line(line));
    const remove = lines.every((line) => line.text.startsWith(prefix));
    view.dispatch({
      changes: lines.map((line) => ({
        from: line.from,
        to: line.from + (remove ? prefix.length : 0),
        insert: remove ? "" : prefix,
      })),
      userEvent: "input",
    });
  } else {
    const [open, close] =
      command === "bold"
        ? ["**", "**"]
        : command === "italic"
          ? ["*", "*"]
          : command === "code"
            ? ["`", "`"]
            : ["[[", "]]"];
    if (
      selected.startsWith(open) &&
      selected.endsWith(close) &&
      selected.length >= open.length + close.length
    )
      view.dispatch({
        changes: {
          from,
          to,
          insert: selected.slice(open.length, -close.length),
        },
        selection: { anchor: from, head: to - open.length - close.length },
        userEvent: "input",
      });
    else if (
      from >= open.length &&
      view.state.sliceDoc(from - open.length, from) === open &&
      view.state.sliceDoc(to, to + close.length) === close
    )
      view.dispatch({
        changes: [
          { from: from - open.length, to: from, insert: "" },
          { from: to, to: to + close.length, insert: "" },
        ],
        selection: { anchor: from - open.length, head: to - open.length },
        userEvent: "input",
      });
    else
      view.dispatch({
        changes: { from, to, insert: open + selected + close },
        selection: { anchor: from + open.length, head: to + open.length },
        userEvent: "input",
      });
  }
  view.focus();
}
export const wikiSyntax = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = this.build(view);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged)
        this.decorations = this.build(update.view);
    }
    build(view: EditorView) {
      const spans: Range<Decoration>[] = [],
        visited = new Set<number>();
      for (const range of view.visibleRanges) {
        const start = view.state.doc.lineAt(range.from).number,
          end = view.state.doc.lineAt(range.to).number;
        for (let number = start; number <= end; number++) {
          if (visited.has(number)) continue;
          visited.add(number);
          const line = view.state.doc.line(number);
          for (const match of line.text.matchAll(/!?\[\[([^\]\n]*)\]\]/g)) {
            let escapes = 0;
            for (
              let at = match.index! - 1;
              at >= 0 && line.text[at] === "\\";
              at--
            )
              escapes++;
            if (escapes % 2) continue;
            const from = line.from + match.index!;
            let node = syntaxTree(view.state).resolveInner(from, 1),
              literal = false;
            for (;;) {
              if (/Code|URL/.test(node.name)) literal = true;
              if (!node.parent) break;
              node = node.parent;
            }
            if (!literal)
              spans.push(
                Decoration.mark({ class: "wiki-link" }).range(
                  from,
                  from + match[0].length,
                ),
              );
          }
        }
      }
      return Decoration.set(spans, true);
    }
  },
  { decorations: (instance) => instance.decorations },
);

export const livePreview = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = this.build(view);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.selectionSet || update.viewportChanged)
        this.decorations = this.build(update.view);
    }
    build(view: EditorView): DecorationSet {
      const spans: Range<Decoration>[] = [];
      const activeLines = new Set(
        view.state.selection.ranges.map(
          (range) => view.state.doc.lineAt(range.head).number,
        ),
      );
      const touches = (from: number, to: number) =>
        view.state.selection.ranges.some(
          (selection) => selection.from <= to && selection.to >= from,
        );
      const wiki: { from: number; to: number }[] = [];
      const visited = new Set<number>();
      for (const range of view.visibleRanges) {
        const first = view.state.doc.lineAt(range.from).number;
        const last = view.state.doc.lineAt(range.to).number;
        for (let number = first; number <= last; number++) {
          if (visited.has(number)) continue;
          visited.add(number);
          const line = view.state.doc.line(number);
          for (const match of line.text.matchAll(/!?\[\[([^\]\n]+)\]\]/g)) {
            const from = line.from + match.index!,
              to = from + match[0].length;
            let escapes = 0;
            for (
              let at = match.index! - 1;
              at >= 0 && line.text[at] === "\\";
              at--
            )
              escapes++;
            if (escapes % 2) continue;
            let node = syntaxTree(view.state).resolveInner(from, 1);
            let code = false;
            for (;;) {
              if (/Code/.test(node.name)) code = true;
              if (!node.parent) break;
              node = node.parent;
            }
            if (code) continue;
            wiki.push({ from, to });
            spans.push(
              Decoration.mark({ class: "live-wiki-link" }).range(from, to),
            );
            if (touches(from, to)) continue;
            const opening = match[0].startsWith("!") ? 3 : 2;
            const pipe = match[1].indexOf("|");
            spans.push(
              Decoration.replace({}).range(
                from,
                from + opening + (pipe >= 0 ? pipe + 1 : 0),
              ),
            );
            spans.push(Decoration.replace({}).range(to - 2, to));
          }
        }
      }
      for (const range of view.visibleRanges)
        syntaxTree(view.state).iterate({
          from: range.from,
          to: range.to,
          enter(node) {
            if (["FencedCode", "CodeBlock"].includes(node.name)) return false;
            if (
              wiki.some((link) => node.from >= link.from && node.to <= link.to)
            )
              return false;
            const line = view.state.doc.lineAt(node.from);
            if (/^ATXHeading\d$/.test(node.name))
              spans.push(
                Decoration.line({
                  class: `live-heading live-h${node.name.slice(-1)}`,
                }).range(line.from),
              );
            if (node.name === "Blockquote")
              spans.push(
                Decoration.line({ class: "live-quote" }).range(line.from),
              );
            if (
              [
                "HeaderMark",
                "EmphasisMark",
                "CodeMark",
                "LinkMark",
                "StrikethroughMark",
                "URL",
              ].includes(node.name)
            ) {
              if (node.name === "HeaderMark") {
                if (!activeLines.has(line.number))
                  spans.push(Decoration.replace({}).range(node.from, node.to));
                return;
              }
              let parent = node.node.parent;
              while (
                parent &&
                ![
                  "StrongEmphasis",
                  "Emphasis",
                  "InlineCode",
                  "Link",
                  "Image",
                  "Strikethrough",
                ].includes(parent.name)
              )
                parent = parent.parent;
              if (parent && !touches(parent.from, parent.to))
                spans.push(Decoration.replace({}).range(node.from, node.to));
            }
          },
        });
      return Decoration.set(spans, true);
    }
  },
  { decorations: (instance) => instance.decorations },
);
export function applyWikiCompletion(
  view: EditorView,
  completion: Completion,
  from: number,
  to: number,
) {
  const after = view.state.sliceDoc(to, to + 2);
  const closing = after.startsWith("]]")
    ? ""
    : after.startsWith("]")
      ? "]"
      : "]]";
  view.dispatch({
    changes: { from, to, insert: completion.label + closing },
    selection: { anchor: from + completion.label.length + 2 },
    annotations: pickedCompletion.of(completion),
    userEvent: "input.complete",
  });
}

export function linkCompletion(vaultId: string, path: string) {
  return autocompletion({
    icons: false,
    override: [
      async (context: CompletionContext): Promise<CompletionResult | null> => {
        try {
          const match = context.matchBefore(/\[\[[^\]\n|]*/);
          if (!match) return null;
          let syntax = syntaxTree(context.state).resolveInner(context.pos, -1);
          for (;;) {
            if (/Code/.test(syntax.name)) return null;
            if (!syntax.parent) break;
            syntax = syntax.parent;
          }
          const typed = match.text.slice(2),
            hash = typed.indexOf("#");
          if (hash >= 0) {
            const resolution = await api.resolve(
              vaultId,
              path,
              typed.slice(0, hash),
            );
            if (!resolution.path) return null;
            const content =
              resolution.path === path
                ? context.state.sliceDoc()
                : (await api.read(vaultId, resolution.path)).content;
            const options = await api.anchorOptions(
              vaultId,
              resolution.path,
              content,
            );
            return {
              from: match.from + 2 + hash + 1,
              options: options.map((label) => ({
                label,
                type: label.startsWith("^") ? "variable" : "text",
                apply: applyWikiCompletion,
              })),
              validFor: /^[^\]\n|]*$/,
            };
          }
          const page = await api.search(vaultId, {
            text: typed.trim(),
            path: "",
            tag: "",
            property: "",
            value: "",
            offset: 0,
          });
          return {
            from: match.from + 2,
            getMatch: (completion, matched = []) => {
              const offset = completion.label.lastIndexOf("/") + 1;
              const result: number[] = [];
              for (let index = 0; index < matched.length; index += 2) {
                const from = Math.max(0, matched[index] - offset);
                const to = matched[index + 1] - offset;
                if (to > from) result.push(from, to);
              }
              return result;
            },
            options: page.hits.map((hit) => ({
              label: hit.path.replace(/\.(md|markdown)$/i, ""),
              displayLabel: hit.path
                .split("/")
                .pop()!
                .replace(/\.(md|markdown)$/i, ""),
              detail: hit.path.includes("/")
                ? hit.path.slice(0, hit.path.lastIndexOf("/"))
                : undefined,
              type: "text",
              apply: applyWikiCompletion,
            })),
            validFor: /^[^\]\n|#]*$/,
          };
        } catch {
          return null;
        }
      },
    ],
    activateOnTyping: true,
  });
}
