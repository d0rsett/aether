export const preferencesKey = "aether.preferences.v1";

const defaults: Preferences = {
  mode: "live",
  startup: "last",
  links: "new",
  tabList: true,
  attachmentFolder: undefined,
  attachmentFormat: "vault",
};

export interface Preferences {
  mode: "live" | "source" | "reading";
  startup: "last" | "note" | "recent";
  links: "new" | "current";
  tabList: boolean;
  attachmentFolder?: string | null;
  attachmentFormat: "vault" | "wiki" | "markdown";
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
