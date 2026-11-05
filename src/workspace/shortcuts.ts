import { platform } from "../services/platform";

export const shortcutsKey = "aether.shortcuts.v1";
export const shortcutCommands = {
  settings: ["Настройки", "Comma"],
  search: ["Поиск по хранилищу", "Shift+KeyF"],
  save: ["Сохранить", "KeyS"],
  openVault: ["Открыть хранилище", "KeyO"],
  newVault: ["Создать хранилище", "Shift+KeyN"],
  newNote: ["Новая заметка", "KeyN"],
  close: ["Закрыть вкладку", "KeyW"],
  palette: ["Палитра команд", "KeyP"],
  sidebar: ["Переключить левую панель", "Backslash"],
  reading: ["Чтение / Live Preview", "KeyE"],
  bold: ["Жирный", "KeyB"],
  italic: ["Курсив", "KeyI"],
  find: ["Поиск в заметке", "KeyF"],
  undo: ["Отменить", "KeyZ"],
  redo: ["Повторить", platform.macOS ? "Shift+KeyZ" : "KeyY"],
} as const;
export const editorShortcutIds = [
  "bold",
  "italic",
  "find",
  "undo",
  "redo",
] as const;
export type EditorShortcut = (typeof editorShortcutIds)[number];
export function isEditorShortcut(id: ShortcutCommand): id is EditorShortcut {
  return editorShortcutIds.some((command) => command === id);
}
export type ShortcutCommand = keyof typeof shortcutCommands;
export type Shortcuts = Partial<Record<ShortcutCommand, string>>;
export const shortcutIds = Object.keys(shortcutCommands).filter(
  (id): id is ShortcutCommand => Object.hasOwn(shortcutCommands, id),
);
const valid =
  /^(?:Shift\+)?(?:Alt\+)?(?:Key[A-Z]|Digit[0-9]|Comma|Period|Backslash|Slash|Semicolon|BracketLeft|BracketRight)$/;
const reserved = new Set([
  "KeyA",
  "KeyC",
  "KeyD",
  "KeyG",
  "KeyH",
  "KeyL",
  "KeyR",
  "KeyT",
  "KeyU",
  "KeyV",
  "KeyX",
  "Slash",
  "BracketLeft",
  "BracketRight",
  "Shift+KeyG",
  "Shift+KeyK",
  "Shift+KeyL",
  "Shift+KeyT",
  "Shift+KeyP",
  "Alt+KeyG",
  "Alt+Backslash",
  "Shift+Backslash",
  "Shift+KeyU",
]);
if (!platform.macOS) reserved.add("Shift+KeyZ");

export function binding(shortcuts: Shortcuts, id: ShortcutCommand): string {
  return shortcuts[id] ?? shortcutCommands[id][1];
}
export function conflictingShortcut(
  shortcuts: Shortcuts,
  id: ShortcutCommand,
  value: string,
) {
  if (reserved.has(value))
    return "Сочетание уже используется редактором или системой.";
  const other = shortcutIds.find(
    (item) => item !== id && binding(shortcuts, item) === value,
  );
  return other ? shortcutCommands[other][0] : null;
}
export function readShortcuts(): Shortcuts {
  try {
    const raw: unknown = JSON.parse(
      localStorage.getItem(shortcutsKey) ?? "null",
    );
    if (!raw || typeof raw !== "object") return {};
    const entries: Record<string, unknown> = Object.fromEntries(
      Object.entries(raw),
    );
    const result: Shortcuts = {};
    for (const id of shortcutIds) {
      const value = entries[id];
      if (
        typeof value === "string" &&
        valid.test(value) &&
        !reserved.has(value)
      )
        result[id] = value;
    }
    if (
      new Set(shortcutIds.map((id) => binding(result, id))).size !==
      shortcutIds.length
    )
      return {};
    return result;
  } catch {
    return {};
  }
}
export function shortcutFromEvent(
  event: Pick<
    KeyboardEvent,
    "code" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey"
  >,
): string | null {
  if (
    !(platform.macOS
      ? event.metaKey && !event.ctrlKey
      : event.ctrlKey && !event.metaKey)
  )
    return null;
  const value = `${event.shiftKey ? "Shift+" : ""}${event.altKey ? "Alt+" : ""}${event.code}`;
  return valid.test(value) ? value : null;
}
const punctuation: Record<string, string> = {
  Comma: ",",
  Period: ".",
  Backslash: "\\",
  Slash: "/",
  Semicolon: ";",
  BracketLeft: "[",
  BracketRight: "]",
};
export function shortcutLabel(value: string): string {
  return [
    platform.macOS ? "⌘" : "Ctrl",
    ...value
      .split("+")
      .map((part) => punctuation[part] ?? part.replace(/^(?:Key|Digit)/, "")),
  ].join(" ");
}
export function editorShortcutKey(
  shortcuts: Shortcuts,
  id: EditorShortcut,
): string {
  return [
    "Mod",
    ...binding(shortcuts, id)
      .split("+")
      .map(
        (part) =>
          punctuation[part] ??
          part
            .replace(/^(?:Key|Digit)/, "")
            .replace(/^[A-Z]$/, (key) => key.toLowerCase()),
      ),
  ].join("-");
}
