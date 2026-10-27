import type { EditorView } from "@codemirror/view";
import { isolateHistory } from "@codemirror/commands";
import { Text } from "@codemirror/state";
import { propertyEdit, type PropertyAction } from "./properties";

export function applyProperty(
  view: EditorView,
  action: PropertyAction,
  expected: string,
) {
  if (view.state.readOnly)
    throw new Error("Заметка недоступна для редактирования.");
  const change = propertyEdit(view.state.sliceDoc(), action, expected);
  view.dispatch({
    changes: { ...change, insert: Text.of(change.insert.split("\n")) },
    annotations: isolateHistory.of("full"),
    userEvent: "input.property",
  });
}
