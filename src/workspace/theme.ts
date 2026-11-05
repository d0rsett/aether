export type ThemePreference = "dark" | "light" | "system";

export const themeKey = "aether.theme";
export const paletteKey = "aether.palette";

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
