import { useSyncExternalStore } from "react";
import { english as frontendEnglish } from "./en";
import { backendEnglish } from "./backend";
const english = { ...backendEnglish, ...frontendEnglish };

export type Locale = "ru" | "en";
const storageKey = "aether.ui.language";
const listeners = new Set<() => void>();
let locale: Locale = "ru";
try {
  if (localStorage.getItem(storageKey) === "en") locale = "en";
} catch {
  /* Preferences remain usable in memory. */
}
export const getLocale = () => locale;
export function subscribeLocale(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function useLocale() {
  return useSyncExternalStore(subscribeLocale, getLocale, getLocale);
}
export function setLocale(next: Locale) {
  locale = next;
  document.documentElement.lang = next;
  let saved = true;
  try {
    localStorage.setItem(storageKey, next);
  } catch {
    saved = false;
  }
  listeners.forEach((listener) => listener());
  return saved;
}
const normalize = (value: string) => value.replace(/\s+/g, " ").trim();
// Dialogs and errors may outlive the language they were created in.
const reverse = new Map(Object.entries(english).map(([ru, en]) => [en, ru]));
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Host errors arrive formatted; match only known message shapes and keep their
// interpolated paths and note names as data.
const patterns = Object.entries(english)
  .flatMap(([ru, en]) => {
    if (!/\{\w*\}/.test(ru)) return [];
    const make = (value: string) =>
      new RegExp(
        "^" +
          value
            .split(/\{\w*\}/)
            .map(escape)
            .join("([\\s\\S]*?)") +
          "$",
      );
    return [{ ru, en, ruPattern: make(ru), enPattern: make(en) }];
  })
  .sort((a, b) => b.ru.length - a.ru.length);
export function t(message: string): string;
export function t(parts: TemplateStringsArray, ...values: unknown[]): string;
export function t(
  input: string | TemplateStringsArray,
  ...values: unknown[]
): string {
  if (typeof input !== "string") {
    const key = normalize(
      input.reduce(
        (text, part, index) => text + (index ? `{${index - 1}}` : "") + part,
        "",
      ),
    );
    const translated = locale === "en" ? (english[key] ?? key) : key;
    return translated.replace(/\{(\d+)\}/g, (_match, index: string) =>
      String(values[Number(index)] ?? ""),
    );
  }
  const key = normalize(input);
  let translated = locale === "en" ? english[key] : reverse.get(key);
  if (translated === undefined) {
    for (const pattern of patterns) {
      const match = (
        locale === "en" ? pattern.ruPattern : pattern.enPattern
      ).exec(key);
      if (!match) continue;
      let index = 0;
      translated = (locale === "en" ? pattern.en : pattern.ru).replace(
        /\{\w*\}/g,
        () => match[++index] ?? "",
      );
      break;
    }
  }
  if (translated === undefined) return input;
  return (
    (input.match(/^\s*/)?.[0] ?? "") +
    translated +
    (input.match(/\s*$/)?.[0] ?? "")
  );
}
