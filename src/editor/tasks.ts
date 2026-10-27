import { EditorView } from "@codemirror/view";
import type { RenderNode } from "../services/api";
import { isolateHistory } from "@codemirror/commands";

export function toggleTask(
  view: EditorView,
  node: RenderNode,
  snapshot: string,
): boolean {
  if (
    view.state.readOnly ||
    view.state.sliceDoc() !== snapshot ||
    !/^\[[ xX]\]$/.test(node.text) ||
    view.state.doc.sliceString(node.from, node.to) !== node.text
  )
    return false;
  view.dispatch({
    annotations: isolateHistory.of("full"),
    changes: {
      from: node.from + 1,
      to: node.from + 2,
      insert: node.level ? " " : "x",
    },
    userEvent: "input.task",
  });
  return true;
}
