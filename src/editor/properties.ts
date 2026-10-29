import { t } from "../i18n";
import {
  isAlias,
  isMap,
  isScalar,
  isSeq,
  parseDocument,
  type Node,
} from "yaml";
export type PropertyType =
  "text" | "list" | "number" | "date" | "datetime" | "checkbox";
export type PropertyTypes = Record<string, string>;
export const configuredTypeName = (types: PropertyTypes, key: string) =>
  Object.hasOwn(types, key) ? types[key] : undefined;
export type PropertyValue = string | string[] | number | boolean;
export interface NoteProperty {
  key: string;
  type: PropertyType | "unsupported";
  value: PropertyValue;
}
export type PropertyAction =
  | {
      key: string;
      rename: string;
    }
  | {
      key: string;
      value: PropertyValue;
      create: boolean;
    }
  | {
      key: string;
      remove: true;
    };
export interface PropertyCommand {
  id: number;
  action: PropertyAction;
  expected: string;
  done: (error?: string) => void;
}
const invalid =
  "Не удалось прочитать свойства. Исправьте их в исходнике заметки.";
const normalize = (text: string) => text.replace(/\r\n/g, "\n");
function validateKey(key: string) {
  if (!key.trim() || key.length > 256 || /[\x00-\x1f\x7f]/.test(key))
    throw new Error(t("Введите имя свойства длиной до 256 символов."));
}
function frontmatter(content: string) {
  const text = normalize(content);
  const bom = text.startsWith("\uFEFF") ? 1 : 0;
  if (!text.slice(bom).startsWith("---\n"))
    return { text, from: bom, to: bom, source: "", exists: false };
  const from = bom + 4;
  const close = /^[ \t]*(?:---|\.\.\.)[ \t]*$/gm;
  close.lastIndex = from;
  const match = close.exec(text);
  if (!match || match.index - from > 65536) throw new Error(invalid);
  return {
    text,
    from,
    to: match.index,
    source: text.slice(from, match.index),
    exists: true,
  };
}
// CodeMirror uses LF-based offsets even when the file is saved with CRLF.
export function propertyBodyStart(content: string): number | null {
  try {
    const header = frontmatter(content);
    if (!header.exists) return null;
    const newline = header.text.indexOf("\n", header.to);
    return newline < 0 ? null : newline + 1;
  } catch {
    return null;
  }
}
function parsed(content: string) {
  const header = frontmatter(content);
  const document = parseDocument(header.source, {
    keepSourceTokens: true,
    intAsBigInt: true,
  });
  if (
    document.errors.length ||
    (document.contents && !isMap(document.contents))
  )
    throw new Error(invalid);
  if (
    isMap(document.contents) &&
    document.contents.items.some(
      (pair) => !isScalar(pair.key) || typeof pair.key.value !== "string",
    )
  )
    throw new Error(invalid);
  return { ...header, document };
}
function property(
  key: string,
  node: Node | null,
  configured?: string,
): NoteProperty {
  if (node && !isAlias(node) && !node.tag && !node.anchor) {
    if (isScalar(node)) {
      const value: unknown = node.value;
      if (typeof value === "boolean") return { key, type: "checkbox", value };
      if (
        typeof value === "number" &&
        Number.isFinite(value) &&
        (!Number.isInteger(value) || Number.isSafeInteger(value))
      )
        return { key, type: "number", value };
      if (
        typeof value === "bigint" &&
        value <= BigInt(Number.MAX_SAFE_INTEGER) &&
        value >= BigInt(Number.MIN_SAFE_INTEGER)
      )
        return { key, type: "number", value: Number(value) };
      if (typeof value === "string" || value === null)
        return {
          key,
          type:
            configured === "text"
              ? "text"
              : typeof value === "string" &&
                  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)
                ? "datetime"
                : typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
                  ? "date"
                  : "text",
          value: value ?? "",
        };
    }
    if (
      isSeq(node) &&
      node.items.every(
        (item) =>
          isScalar(item) &&
          typeof item.value === "string" &&
          !/[\r\n]/.test(item.value) &&
          item.value.trim() === item.value &&
          item.value.length > 0 &&
          !item.anchor &&
          !item.tag,
      )
    ) {
      return {
        key,
        type: "list",
        value: node.items.map((item) =>
          isScalar(item) ? String(item.value) : "",
        ),
      };
    }
  }
  return {
    key,
    type: "unsupported",
    value: t("Сложное значение \u2014 редактируется в исходнике"),
  };
}
export function readProperties(
  content: string,
  types: PropertyTypes = {},
): {
  items: NoteProperty[];
  expected: string;
  error: string;
} {
  try {
    const header = parsed(content);
    const items = isMap(header.document.contents)
      ? header.document.contents.items.map((pair) => {
          const key = String(isScalar(pair.key) ? pair.key.value : "");
          const configuredName = configuredTypeName(types, key);
          const configured = configuredPropertyType(configuredName);
          const item = property(key, pair.value, configured);
          if (configuredName && !configured)
            return {
              ...item,
              type: "unsupported" as const,
              value: t("Неизвестный тип Obsidian \u2014 откройте исходник"),
            };
          if (
            configured &&
            item.type !== "unsupported" &&
            item.type !== configured
          ) {
            return {
              ...item,
              type: "unsupported" as const,
              value: t(
                "Тип в настройках Obsidian не совпадает со значением \u2014 откройте исходник",
              ),
            };
          }
          return isScalar(pair.key) && (pair.key.anchor || pair.key.tag)
            ? { ...item, type: "unsupported" as const }
            : item;
        })
      : [];
    return { items, expected: header.source, error: "" };
  } catch {
    return { items: [], expected: "", error: invalid };
  }
}
export function configuredPropertyType(
  value: string | undefined,
): PropertyType | undefined {
  if (
    value === "multitext" ||
    value === "list" ||
    value === "tags" ||
    value === "aliases"
  )
    return "list";
  if (
    value === "text" ||
    value === "number" ||
    value === "checkbox" ||
    value === "date" ||
    value === "datetime"
  )
    return value;
  return undefined;
}
export function propertyValue(
  key: string,
  type: PropertyType,
  text: string,
  checked: boolean,
): PropertyValue {
  validateKey(key);
  if (key === "tags" || key === "aliases") type = "list";
  if (type === "checkbox") return checked;
  if (type === "number") {
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text.trim()))
      throw new Error(t("Введите число, например 12 или 3.5."));
    const value = Number(text);
    if (
      !Number.isFinite(value) ||
      (Number.isInteger(value) && !Number.isSafeInteger(value))
    )
      throw new Error(t("Число слишком велико для точного редактирования."));
    return value;
  }
  if (type === "date") {
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(text) ||
      !Number.isFinite(Date.parse(text)) ||
      new Date(text).toISOString().slice(0, 10) !== text
    )
      throw new Error(t("Выберите существующую дату."));
    return text;
  }
  if (type === "datetime") {
    const match =
      /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})?$/.exec(
        text,
      );
    if (
      !match ||
      !Number.isFinite(Date.parse(text)) ||
      new Date(`${match[1]}T00:00:00Z`).toISOString().slice(0, 10) !==
        match[1] ||
      Number(match[2]) > 23 ||
      Number(match[3]) > 59 ||
      Number(match[4] || 0) > 59
    )
      throw new Error(
        t("Введите существующую дату и время, например 2026-10-28T14:30:00."),
      );
    return text;
  }
  if (type === "list") {
    const values = text
      .split(/\r?\n/)
      .map((value) => value.trim())
      .filter(Boolean)
      .map((value) => (key === "tags" ? value.replace(/^#/, "") : value));
    if (
      key === "tags" &&
      values.some((value) => !/^[\p{L}\p{N}_/-]+$/u.test(value))
    )
      throw new Error(
        t(
          "Теги не должны содержать пробелы. Укажите каждый тег с новой строки.",
        ),
      );
    if (
      key === "aliases" &&
      values.some((value) => /[\[\]|#\x00-\x1f\x7f]/.test(value))
    )
      throw new Error(t("Псевдонимы не должны содержать символы []|#."));
    return values;
  }
  return text;
}
export function propertyEdit(
  content: string,
  action: PropertyAction,
  expected: string,
) {
  validateKey(action.key);
  const header = parsed(content);
  if (header.source !== expected)
    throw new Error(
      t("Свойства изменились, пока была открыта форма. Откройте её заново."),
    );
  const map = isMap(header.document.contents) ? header.document.contents : null;
  const pair = map?.items.find(
    (item) => isScalar(item.key) && item.key.value === action.key,
  );
  if ("rename" in action) {
    validateKey(action.rename);
    if (!pair || !isScalar(pair.key) || !pair.key.range)
      throw new Error(t("Свойство больше не существует."));
    if (action.rename !== action.key && map?.has(action.rename))
      throw new Error(t("Свойство с таким именем уже существует."));
    return {
      from: header.from + pair.key.range[0],
      to: header.from + pair.key.range[1],
      insert: JSON.stringify(action.rename),
    };
  }
  const removing = "remove" in action;
  if (
    (!removing && action.create && pair) ||
    ((removing || !action.create) && !pair)
  )
    throw new Error(
      pair
        ? t("Свойство с таким именем уже существует.")
        : t("Свойство больше не существует. Откройте форму заново."),
    );
  if (
    pair &&
    (property(action.key, pair.value).type === "unsupported" ||
      !isScalar(pair.key) ||
      pair.key.anchor ||
      pair.key.tag)
  )
    throw new Error(t("Это свойство можно изменить в исходнике заметки."));
  // Values are JSON scalars/arrays, a portable subset of YAML. Never evaluate
  // aliases or convert unrelated nodes into JavaScript objects.
  if (
    !removing &&
    (JSON.stringify(action.value).length > 65536 ||
      (typeof action.value === "number" && !Number.isFinite(action.value)))
  )
    throw new Error(t("Значение свойства слишком велико."));
  const literal = removing ? "" : JSON.stringify(action.value);
  let from: number, to: number, insert: string;
  if (!header.exists) {
    const entry = `${JSON.stringify(action.key)}: ${literal}\n`;
    if (entry.length > 65536)
      throw new Error(t("Свойства превышают допустимый размер 64 КБ."));
    return {
      from: header.from,
      to: header.to,
      insert: `---\n${entry}---\n`,
    };
  }
  if (map?.flow) {
    if (removing) header.document.delete(action.key);
    else header.document.set(action.key, action.value);
    from = header.from;
    to = header.to;
    try {
      insert = header.document.toString({ lineWidth: 0 });
    } catch {
      throw new Error(invalid);
    }
  } else if (!pair) {
    from = to = header.to;
    const first = map?.items[0]?.key;
    const start = isScalar(first) ? (first.range?.[0] ?? 0) : 0;
    const indent = header.source.slice(
      header.source.lastIndexOf("\n", start - 1) + 1,
      start,
    );
    insert = `${header.source && !header.source.endsWith("\n") ? "\n" : ""}${indent}${JSON.stringify(action.key)}: ${literal}\n`;
  } else {
    const keyRange = isScalar(pair.key) ? pair.key.range : undefined;
    const range = pair.value?.range;
    if (!keyRange || !range) throw new Error(invalid);
    if (removing) {
      from = header.source.lastIndexOf("\n", keyRange[0] - 1) + 1;
      to = range[2];
      insert = "";
    } else {
      from = range[0];
      to = range[1];
      insert =
        literal +
        (header.source.slice(from, to).endsWith("\n")
          ? "\n"
          : header.source[to] === "#"
            ? " "
            : "");
    }
    from += header.from;
    to += header.from;
  }
  const result = header.text.slice(0, from) + insert + header.text.slice(to);
  const next = parsed(result);
  if (next.source.length > 65536)
    throw new Error(t("Свойства превышают допустимый размер 64 КБ."));
  return { from, to, insert };
}
