import {
  codePalettePresets,
  defaultPaletteColor,
  palettePresets,
} from "./theme";

export const preferencesKey = "aether.preferences.v1";

export const codePaletteOptions = [
  ["appearance", "Как в оформлении"],
  ...codePalettePresets.map(({ id, name }) => [id, name] as const),
] as const;

export const codeBackgroundOptions = [
  ["appearance", "Как в оформлении"],
  ["syntax", "Под палитру кода"],
  ...codePalettePresets.map(({ id, name }) => [id, name] as const),
] as const;

const defaults: Preferences = {
  mode: "live",
  startup: "last",
  links: "new",
  tabList: true,
  attachmentFolder: undefined,
  attachmentFormat: "vault",
  codeHighlighting: true,
  codePalette: "appearance",
  codeBackground: "appearance",
  codeAutoIndent: true,
  indentWidth: "2",
};

export interface Preferences {
  mode: "live" | "source" | "reading";
  startup: "last" | "note" | "recent";
  links: "new" | "current";
  tabList: boolean;
  attachmentFolder?: string | null;
  attachmentFormat: "vault" | "wiki" | "markdown";
  codeHighlighting: boolean;
  codePalette: (typeof codePaletteOptions)[number][0];
  codeBackground: (typeof codeBackgroundOptions)[number][0];
  codeAutoIndent: boolean;
  indentWidth: "2" | "4" | "8";
}

export function resolveCodeAppearance(
  codePalette: Preferences["codePalette"],
  codeBackground: Preferences["codeBackground"],
  appearanceColor: string | null,
) {
  const palette =
    codePalette === "appearance"
      ? (palettePresets.find(
          ({ id, color }) =>
            color === (appearanceColor ?? defaultPaletteColor) ||
            // Keep code colors for profiles using the previous graphite swatch.
            (id === "graphite" && appearanceColor === "#808080"),
        )?.id ?? "aether")
      : codePalette;
  const background = codeBackground === "syntax" ? palette : codeBackground;
  return {
    palette,
    tint: codePalettePresets.find(({ id }) => id === background)?.color,
  };
}

export function readPreferences(): Preferences {
  try {
    const value: unknown = JSON.parse(
      localStorage.getItem(preferencesKey) ?? "null",
    );
    if (!value || typeof value !== "object") return defaults;
    const stored: Record<string, unknown> = Object.fromEntries(
      Object.entries(value),
    );
    const codePalette =
      codePaletteOptions.find(
        ([palette]) => palette === stored.codePalette,
      )?.[0] ?? defaults.codePalette;
    const codeBackground =
      codeBackgroundOptions.find(
        ([background]) => background === stored.codeBackground,
      )?.[0] ?? defaults.codeBackground;
    return {
      mode:
        stored.mode === "source" || stored.mode === "reading"
          ? stored.mode
          : "live",
      startup:
        stored.startup === "note" || stored.startup === "recent"
          ? stored.startup
          : "last",
      links: stored.links === "current" ? "current" : "new",
      tabList: stored.tabList !== false,
      attachmentFolder:
        typeof stored.attachmentFolder === "string" ||
        stored.attachmentFolder === null
          ? stored.attachmentFolder
          : undefined,
      attachmentFormat:
        stored.attachmentFormat === "wiki" ||
        stored.attachmentFormat === "markdown"
          ? stored.attachmentFormat
          : "vault",
      codeHighlighting: stored.codeHighlighting !== false,
      codePalette,
      codeBackground,
      codeAutoIndent: stored.codeAutoIndent !== false,
      indentWidth:
        stored.indentWidth === "4" || stored.indentWidth === "8"
          ? stored.indentWidth
          : defaults.indentWidth,
    };
  } catch {
    return defaults;
  }
}

export const startupNoteKey = (vault: string) => `aether.startup-note:${vault}`;
export const recentKey = (vault: string) => `aether.recent:${vault}`;
export function readRecent(vault: string): string[] {
  try {
    const value: unknown = JSON.parse(
      localStorage.getItem(recentKey(vault)) ?? "[]",
    );
    return Array.isArray(value)
      ? value
          .filter((path): path is string => typeof path === "string")
          .slice(0, 20)
      : [];
  } catch {
    return [];
  }
}
export function readStartupNote(vault: string): string {
  try {
    return localStorage.getItem(startupNoteKey(vault)) ?? "";
  } catch {
    return "";
  }
}
