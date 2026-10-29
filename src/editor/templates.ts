import { t } from "../i18n";
import { parseDocument, isMap, isScalar, isAlias, isNode, visit } from "yaml";
import type { EditorView } from "@codemirror/view";
import { Text } from "@codemirror/state";
import { isolateHistory } from "@codemirror/commands";
export function expandTemplate(
  source: string,
  title: string,
  now = new Date(),
) {
  const pad = (value: number) => String(value).padStart(2, "0");
  const tokens: Record<string, string> = {
    YYYY: String(now.getFullYear()),
    MM: pad(now.getMonth() + 1),
    DD: pad(now.getDate()),
    HH: pad(now.getHours()),
    mm: pad(now.getMinutes()),
    ss: pad(now.getSeconds()),
  };
  return source.replace(
    /\{\{(title|date|time)(?::([^}]+))?\}\}/g,
    (_match, kind: string, format: string | undefined) => {
      if (kind === "title") return title;
      return (format ?? (kind === "date" ? "YYYY-MM-DD" : "HH:mm")).replace(
        /YYYY|MM|DD|HH|mm|ss/g,
        (token) => tokens[token],
      );
    },
  );
}
function header(text: string) {
  const opening = /^\uFEFF?---\n/.exec(text);
  if (!opening) return null;
  const close = /^(?:---|\.\.\.)[ \t]*(?:\n|$)/gm;
  close.lastIndex = opening[0].length;
  const match = close.exec(text);
  if (match && match.index - opening[0].length > 65536)
    throw new Error(t("Свойства шаблона или заметки превышают 64 КБ."));
  return match
    ? {
        source: text.slice(opening[0].length, match.index),
        end: match.index + match[0].length,
        bom: text.startsWith("\uFEFF") ? "\uFEFF" : "",
      }
    : null;
}
export function templateChanges(
  content: string,
  template: string,
  from: number,
  to: number,
) {
  const source = template.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  const incoming = header(source),
    current = header(content);
  if (source.startsWith("---\n") && !incoming)
    throw new Error(t("В шаблоне не закрыт блок свойств."));
  if (!incoming) return [{ from, to, insert: source }];
  const added = parseDocument(incoming.source);
  if (added.errors.length || (added.contents && !isMap(added.contents)))
    throw new Error(t("Исправьте свойства в файле шаблона."));
  if (!added.contents)
    return [{ from, to, insert: source.slice(incoming.end) }];
  visit(added, (_key, node) => {
    if (isAlias(node) || (isNode(node) && "anchor" in node && node.anchor))
      throw new Error(
        t("Для вставки шаблона упростите YAML-ссылки и якоря в его свойствах."),
      );
  });
  const existing = parseDocument(current?.source ?? "");
  if (
    existing.errors.length ||
    (existing.contents && !isMap(existing.contents))
  )
    throw new Error(
      t("Исправьте свойства текущей заметки перед вставкой шаблона."),
    );
  for (const pair of added.contents.items) {
    if (!isScalar(pair.key) || typeof pair.key.value !== "string")
      throw new Error(t("Неподдерживаемое имя свойства в шаблоне."));
    if (!existing.has(pair.key.value))
      existing.set(pair.key.value, pair.value?.clone() ?? null);
  }
  const merged = `${current?.bom ?? (content.startsWith("\uFEFF") ? "\uFEFF" : "")}---\n${existing.toString({ lineWidth: 0 })}---\n`;
  const end = current?.end ?? (content.startsWith("\uFEFF") ? 1 : 0);
  if (current && from < end)
    throw new Error(t("Поставьте курсор в текст заметки ниже свойств."));
  const body = source.slice(incoming.end);
  return [
    { from: 0, to: end, insert: merged },
    { from: Math.max(end, from), to: Math.max(end, to), insert: body },
  ];
}
export function insertTemplate(view: EditorView, template: string) {
  if (view.state.readOnly)
    throw new Error(t("Заметка недоступна для редактирования."));
  const selection = view.state.selection.main;
  const changes = templateChanges(
    view.state.sliceDoc(),
    template,
    selection.from,
    selection.to,
  );
  view.dispatch({
    changes: changes.map((change) => ({
      ...change,
      insert: Text.of(change.insert.split("\n")),
    })),
    annotations: isolateHistory.of("full"),
    userEvent: "input.template",
    scrollIntoView: true,
  });
  view.focus();
}
