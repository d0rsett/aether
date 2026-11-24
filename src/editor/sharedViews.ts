import {
  Compartment,
  Transaction,
  type TransactionSpec,
} from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { historyField } from "@codemirror/commands";

export type SharedEditors = Map<string, Map<EditorView, Compartment>>;

export function joinEditors(
  editors: SharedEditors,
  key: string,
  view: EditorView,
  history: Compartment,
) {
  let views = editors.get(key);
  if (!views) editors.set(key, (views = new Map()));
  const other = views.keys().next().value;
  if (other && other.state.doc.eq(view.state.doc)) {
    const value = other.state.field(historyField);
    view.dispatch({
      effects: history.reconfigure(historyField.init(() => value)),
    });
  }
  views.set(view, history);
  return () => {
    views.delete(view);
    if (!views.size) editors.delete(key);
  };
}

export function syncEditors(
  editors: SharedEditors,
  key: string,
  origin: EditorView,
  transactions: readonly Transaction[],
) {
  for (const [peer, history] of editors.get(key) ?? []) {
    if (peer === origin) continue;
    const changes: TransactionSpec[] = [];
    let doc = peer.state.doc;
    for (const transaction of transactions) {
      if (!transaction.docChanged) continue;
      if (!transaction.startState.doc.eq(doc)) break;
      changes.push({
        changes: transaction.changes,
        annotations: [
          Transaction.addToHistory.of(false),
          Transaction.remote.of(true),
        ],
        sequential: true,
        filter: false,
      });
      doc = transaction.newDoc;
    }
    if (!changes.length || !doc.eq(origin.state.doc)) continue;
    const value = origin.state.field(historyField);
    // Apply the edits before installing the resulting undo history, so that
    // CodeMirror maps the peer's own selection but doesn't map history twice.
    peer.dispatch(...changes);
    peer.dispatch({
      effects: history.reconfigure(historyField.init(() => value)),
      annotations: Transaction.remote.of(true),
    });
  }
}
