export type ThemePreference = "dark" | "light" | "system";

export const themeKey = "aether.theme";
export const paletteKey = "aether.palette";
export const defaultPaletteColor = "#454752";
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
const appearancePresets = [
  { id: "graphite", name: "Графит", color: defaultPaletteColor },
  { id: "sage", name: "Шалфей", color: "#7c9b80" },
  { id: "blue", name: "Синий", color: "#568cda" },
  { id: "lavender", name: "Лаванда", color: "#a48cdb" },
  { id: "sand", name: "Песочный", color: "#c5a471" },
  { id: "rose", name: "Розовый", color: "#d387a4" },
  { id: "teal", name: "Бирюзовый", color: "#53aaa6" },
  { id: "terracotta", name: "Терракота", color: "#cb8668" },
] as const;

const codePresets = [
  { id: "aether", name: "Aether", color: "#a4bea2" },
  { id: "ocean", name: "Океан", color: "#4382b3" },
  { id: "sunset", name: "Закат", color: "#d17b96" },
  { id: "dracula", name: "Dracula", color: "#9771c9" },
  { id: "nord", name: "Nord", color: "#81a1c1" },
  { id: "gruvbox", name: "Gruvbox", color: "#bd8a45" },
  { id: "solarized", name: "Solarized", color: "#2aa198" },
  { id: "one", name: "Atom One", color: "#7486a1" },
  { id: "catppuccin", name: "Catppuccin", color: "#ad8ad7" },
  { id: "tokyo-night", name: "Tokyo Night", color: "#6278c5" },
  { id: "monokai", name: "Monokai", color: "#a6a64f" },
] as const;

export const palettePresets = [...appearancePresets, ...codePresets] as const;
export const codePalettePresets = [
  ...codePresets,
  ...appearancePresets,
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
