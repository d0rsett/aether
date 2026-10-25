import type { Note } from "../services/api";

export interface Tab extends Note {
  savedContent: string;
}
export interface Workspace {
  tabs: Tab[];
  active: string | null;
}
export type Action =
  | { type: "open"; note: Note }
  | { type: "activate"; path: string }
  | { type: "edit"; path: string; content: string }
  | { type: "saved"; path: string; content: string; revision: string }
  | { type: "replace"; path: string; note: Note }
  | { type: "close"; path: string }
  | { type: "reset" };

export const initialWorkspace: Workspace = { tabs: [], active: null };
export const dirty = (tab: Tab): boolean => tab.content !== tab.savedContent;
export const titleOf = (path: string): string =>
  path
    .split("/")
    .pop()
    ?.replace(/\.(md|markdown)$/i, "") ?? path;

export function workspaceReducer(state: Workspace, action: Action): Workspace {
  switch (action.type) {
    case "open":
      return {
        tabs: state.tabs.some((t) => t.path === action.note.path)
          ? state.tabs
          : [
              ...state.tabs,
              { ...action.note, savedContent: action.note.content },
            ],
        active: action.note.path,
      };
    case "activate":
      return { ...state, active: action.path };
    case "edit":
      return {
        ...state,
        tabs: state.tabs.map((t) =>
          t.path === action.path ? { ...t, content: action.content } : t,
        ),
      };
    case "saved":
      return {
        ...state,
        tabs: state.tabs.map((t) =>
          t.path === action.path
            ? { ...t, savedContent: action.content, revision: action.revision }
            : t,
        ),
      };
    case "replace":
      return {
        ...state,
        active: state.active === action.path ? action.note.path : state.active,
        tabs: state.tabs.map((t) =>
          t.path === action.path
            ? { ...action.note, savedContent: action.note.content }
            : t,
        ),
      };
    case "close": {
      const index = state.tabs.findIndex((t) => t.path === action.path);
      const tabs = state.tabs.filter((t) => t.path !== action.path);
      return {
        tabs,
        active:
          state.active === action.path
            ? (tabs[Math.min(index, tabs.length - 1)]?.path ?? null)
            : state.active,
      };
    }
    case "reset":
      return initialWorkspace;
  }
}
