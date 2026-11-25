import { insertNewlineKeepIndent } from "@codemirror/commands";
import { indentService, indentUnit, syntaxTree } from "@codemirror/language";
import { Prec, type EditorState, type Range } from "@codemirror/state";
import { Decoration, keymap, ViewPlugin } from "@codemirror/view";
import type { Preferences } from "../workspace/preferences";

function inCodeBody(state: EditorState, position: number): boolean {
  const tree = syntaxTree(state);
  let node = tree.resolve(position, -1);
  if (node.type.isTop) node = tree.resolve(position, 1);
  for (;;) {
    if (node.name === "CodeBlock") return true;
    if (node.name === "FencedCode") {
      const opening = node.firstChild;
      const closing = node.lastChild;
      const line = state.doc.lineAt(position).number;
      return (
        opening !== null &&
        line > state.doc.lineAt(opening.from).number &&
        (closing?.name !== "CodeMark" ||
          closing.from === opening.from ||
          line < state.doc.lineAt(closing.from).number)
      );
    }
    if (!node.parent) return false;
    node = node.parent;
  }
}

export function editorIndentation(
  width: Preferences["indentWidth"],
  codeAutoIndent: boolean,
) {
  const unit = indentUnit.of(" ".repeat(Number(width)));
  if (codeAutoIndent) return unit;
  return [
    unit,
    indentService.of((context, position) =>
      inCodeBody(context.state, position) ? null : undefined,
    ),
    Prec.highest(
      keymap.of([
        {
          key: "Enter",
          run: (view) =>
            !view.state.readOnly &&
            view.state.selection.ranges.every((range) =>
              inCodeBody(view.state, range.from),
            ) &&
            insertNewlineKeepIndent(view),
        },
      ]),
    ),
  ];
}

const codeLine = Decoration.line({ class: "editor-code-line" });
const firstCodeLine = Decoration.line({
  class: "editor-code-line editor-code-first",
});
const lastCodeLine = Decoration.line({
  class: "editor-code-line editor-code-last",
});
const singleCodeLine = Decoration.line({
  class: "editor-code-line editor-code-first editor-code-last",
});

export const codeBlockAppearance = ViewPlugin.define(
  (view) => {
    const build = () => {
      const { doc } = view.state;
      const tree = syntaxTree(view.state);
      const lines = new Set<number>();
      const decorations: Range<Decoration>[] = [];
      for (const range of view.visibleRanges) {
        const from = doc.lineAt(range.from).number;
        const to = doc.lineAt(range.to).number;
        tree.iterate({
          from: range.from,
          to: range.to,
          enter(node) {
            if (node.name !== "FencedCode" && node.name !== "CodeBlock") return;
            const first = doc.lineAt(node.from).number;
            const last = doc.lineAt(node.to).number;
            for (
              let number = Math.max(first, from);
              number <= Math.min(last, to);
              number++
            ) {
              if (lines.has(number)) continue;
              lines.add(number);
              let decoration = codeLine;
              if (first === last) decoration = singleCodeLine;
              else if (number === first) decoration = firstCodeLine;
              else if (number === last) decoration = lastCodeLine;
              decorations.push(decoration.range(doc.line(number).from));
            }
            return false;
          },
        });
      }
      return Decoration.set(decorations, true);
    };
    return {
      decorations: build(),
      update(update) {
        if (
          update.docChanged ||
          update.viewportChanged ||
          syntaxTree(update.startState) !== syntaxTree(update.state)
        )
          this.decorations = build();
      },
    };
  },
  { decorations: (plugin) => plugin.decorations },
);
