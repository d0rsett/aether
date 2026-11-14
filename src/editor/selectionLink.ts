import { StateEffect, StateField } from "@codemirror/state";
import { isolateHistory } from "@codemirror/commands";
import type { EditorView } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { t } from "../i18n";
import { api } from "../services/api";

interface LinkSelection {
  from: number;
  to: number;
  text: string;
}
const markSelection = StateEffect.define<LinkSelection | null>();
export const linkSelection = StateField.define<LinkSelection | null>({
  create: () => null,
  update(selection, tr) {
    for (const effect of tr.effects)
      if (effect.is(markSelection)) return effect.value;
    if (!selection || !tr.docChanged) return selection;
    const from = tr.changes.mapPos(selection.from, 1);
    const to = tr.changes.mapPos(selection.to, -1);
    return from < to && tr.newDoc.sliceString(from, to) === selection.text
      ? { ...selection, from, to }
      : null;
  },
});

export function startSelectionLink(view: EditorView): string {
  const { state } = view;
  const { from, to } = state.selection.main;
  const text = state.sliceDoc(from, to);
  let insideMarkup = false;
  syntaxTree(state).iterate({
    from,
    to,
    enter(node) {
      if (
        node.from < to &&
        node.to > from &&
        /Code|Link|Image|URL/.test(node.name)
      ) {
        insideMarkup = true;
        return false;
      }
    },
  });
  if (
    state.readOnly ||
    state.selection.ranges.length !== 1 ||
    !text.trim() ||
    /[\[\]|\r\n]/.test(text) ||
    insideMarkup
  )
    throw new Error(t("Выделите обычный текст в пределах одной строки."));
  view.dispatch({ effects: markSelection.of({ from, to, text }) });
  return text.trim();
}

export function cancelSelectionLink(view: EditorView) {
  if (view.dom.isConnected) view.dispatch({ effects: markSelection.of(null) });
}

export async function insertSelectionLink(
  view: EditorView,
  vault: string,
  source: string,
  path: string,
  isCurrent: () => boolean,
) {
  const target = path.replace(/\.(md|markdown)$/i, "");
  if (!target || /[#[\]|\r\n]/.test(target))
    throw new Error(t("Имя этой заметки нельзя использовать в Wiki-ссылке."));
  const resolved = await api.resolve(vault, source, target);
  if (!isCurrent()) return false;
  if (resolved.path !== path)
    throw new Error(t("Не удалось однозначно найти заметку для ссылки."));
  const selection = view.state.field(linkSelection, false);
  if (!view.dom.isConnected || !selection || view.state.readOnly)
    throw new Error(t("Выделенный текст изменился. Выделите его заново."));
  const { from, to, text } = selection;
  // Keep surrounding whitespace outside the link, where Markdown renders it as before.
  const lead = text.length - text.trimStart().length;
  const tail = text.length - text.trimEnd().length;
  const label = text.trim();
  const insert = label === target ? `[[${target}]]` : `[[${target}|${label}]]`;
  view.dispatch({
    changes: { from: from + lead, to: to - tail, insert },
    selection: { anchor: from + lead + insert.length },
    annotations: isolateHistory.of("full"),
    effects: markSelection.of(null),
    userEvent: "input.link",
  });
  return true;
}
