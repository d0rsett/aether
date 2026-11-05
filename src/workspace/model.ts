import type { Note } from "../services/api";

export interface Tab extends Note {
  kind?: "image";
  savedContent: string;
}
export interface Workspace {
  tabs: Tab[];
  active: string | null;
}
export type Action =
  | { type: "open"; note: Note; background?: boolean }
  | { type: "openImage"; path: string }
  | { type: "relocateImage"; path: string; destination: string }
  | { type: "activate"; path: string }
  | { type: "showRecent" }
  | { type: "openInTab"; previous: string; note: Note }
  | { type: "reorder"; path: string; target: string; after: boolean }
  | { type: "edit"; path: string; content: string }
  | { type: "saved"; path: string; content: string; revision: string }
  | { type: "replace"; path: string; note: Note }
  | { type: "close"; path: string }
  | { type: "reset" };

export const initialWorkspace: Workspace = { tabs: [], active: null };
export const dirty = (tab: Tab): boolean =>
  tab.kind !== "image" && tab.content !== tab.savedContent;
export const titleOf = (path: string): string =>
  path
    .split("/")
    .pop()
    ?.replace(/\.(md|markdown)$/i, "") ?? path;

export function workspaceReducer(state: Workspace, action: Action): Workspace {
  switch (action.type) {
    case "showRecent":
      return { ...state, active: null };
    case "openInTab": {
      const previous = state.tabs.find((tab) => tab.path === action.previous);
      if (!previous || dirty(previous) || previous.path === action.note.path)
        return workspaceReducer(state, { type: "open", note: action.note });
      if (state.tabs.some((tab) => tab.path === action.note.path))
        return {
          tabs: state.tabs.filter((tab) => tab !== previous),
          active: action.note.path,
        };
      return {
        tabs: state.tabs.map((tab) =>
          tab === previous
            ? { ...action.note, savedContent: action.note.content }
            : tab,
        ),
        active: action.note.path,
      };
    }
    case "reorder": {
      if (action.path === action.target) return state;
      const tab = state.tabs.find((item) => item.path === action.path);
      if (!tab || !state.tabs.some((item) => item.path === action.target))
        return state;
      const tabs = state.tabs.filter((item) => item !== tab);
      const index = tabs.findIndex((item) => item.path === action.target);
      tabs.splice(index + Number(action.after), 0, tab);
      return { ...state, tabs };
    }
    case "openImage":
      return {
        tabs: state.tabs.some((tab) => tab.path === action.path)
          ? state.tabs
          : [
              ...state.tabs,
              {
                path: action.path,
                kind: "image",
                content: "",
                savedContent: "",
                revision: "",
              },
            ],
        active: action.path,
      };
    case "relocateImage":
      return {
        tabs: state.tabs.map((tab) =>
          tab.kind === "image" && tab.path === action.path
            ? { ...tab, path: action.destination }
            : tab,
        ),
        active:
          state.active === action.path ? action.destination : state.active,
      };
    case "open":
      return {
        tabs: state.tabs.some((t) => t.path === action.note.path)
          ? state.tabs
          : [
              ...state.tabs,
              { ...action.note, savedContent: action.note.content },
            ],
        active: action.background ? state.active : action.note.path,
      };
    case "activate":
      return { ...state, active: action.path };
    case "edit":
      return {
        ...state,
        tabs: state.tabs.map((t) =>
          t.path === action.path && t.kind !== "image"
            ? { ...t, content: action.content }
            : t,
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
