export type ThemePreference = "dark" | "light" | "system";

export const themeKey = "aether.theme";
export const paletteKey = "aether.palette";
export const densityKey = "aether.density";
export const dividerKey = "aether.dividerWidth";
export function readDividerWidth(): number {
  try {
    const value = Number(localStorage.getItem(dividerKey));
    return [1, 2, 3].includes(value) ? value : 1;
  } catch {
    return 1;
  }
}
export type Density = "compact" | "comfortable";
export function readDensity(): Density {
  try {
    return localStorage.getItem(densityKey) === "compact"
      ? "compact"
      : "comfortable";
  } catch {
    return "comfortable";
  }
}
export const palettePresets = [
  { name: "Графит", color: "#808080" },
  { name: "Шалфей", color: "#7c9b80" },
  { name: "Синий", color: "#568cda" },
  { name: "Лаванда", color: "#a48cdb" },
  { name: "Песочный", color: "#c5a471" },
  { name: "Розовый", color: "#d387a4" },
  { name: "Бирюзовый", color: "#53aaa6" },
  { name: "Терракота", color: "#cb8668" },
] as const;

export function parsePalette(value: string | null): string | null {
  return value && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : null;
}

export function readPalette(): string | null {
  try {
    return parsePalette(localStorage.getItem(paletteKey));
  } catch {
    return null;
  }
}

export function parseTheme(value: string | null): ThemePreference {
  return value === "system" || value === "light" ? value : "dark";
}

export function readTheme(): ThemePreference {
  try {
    return parseTheme(localStorage.getItem(themeKey));
  } catch {
    return "dark";
  }
}

export function resolveTheme(
  preference: ThemePreference,
  systemLight: boolean,
) {
  return preference === "system"
    ? systemLight
      ? "light"
      : "dark"
    : preference;
}
