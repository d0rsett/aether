import type { Action, Workspace } from "./model";
import { markdownFile } from "../services/canvasFiles";

export const graphTabPath = "\0graph";
export type GroupId = "primary" | "secondary";
export interface TabGroup {
  tabs: string[];
  active: string | null;
}
export interface GroupLayout {
  primary: TabGroup;
  secondary: TabGroup;
  focused: GroupId;
  ratio: number;
}
export type GroupAction =
  | {
      type: "moveToGroup";
      path: string;
      group: GroupId;
      from?: GroupId;
      target?: string;
      after?: boolean;
      graphOpen?: boolean;
      graphPosition?: number;
      activeGraph?: boolean;
    }
  | {
      type: "openBeside";
      path: string;
      from: GroupId;
      graphOpen?: boolean;
      graphPosition?: number;
      activeGraph?: boolean;
    }
  | { type: "activateGroupTab"; path: string; group: GroupId }
  | { type: "closeGroupTab"; path: string; group: GroupId }
  | { type: "focusGroup"; group: GroupId }
  | { type: "resizeGroups"; ratio: number }
  | { type: "mergeGroups" }
  | { type: "restoreGroups"; layout: GroupLayout }
  | { type: "closeGroupGraph" }
  | { type: "registerGroupGraph"; position: number };
const ids: GroupId[] = ["primary", "secondary"];
export const otherGroup = (id: GroupId): GroupId =>
  id === "primary" ? "secondary" : "primary";
export function groupFor(
  layout: GroupLayout,
  path: string,
  preferred = layout.focused,
): GroupId | undefined {
  return [preferred, otherGroup(preferred)].find((id) =>
    layout[id].tabs.includes(path),
  );
}
function select(group: TabGroup, tabs: string[]): TabGroup {
  const oldIndex = Math.max(0, group.tabs.indexOf(group.active ?? ""));
  return {
    tabs,
    active:
      group.active && tabs.includes(group.active)
        ? group.active
        : (tabs[Math.min(oldIndex, tabs.length - 1)] ?? null),
  };
}
function finish(state: Workspace, layout: GroupLayout): Workspace {
  const paths = [
    ...new Set([...layout.primary.tabs, ...layout.secondary.tabs]),
  ];
  const active = layout[layout.focused].active;
  const tabs = paths.flatMap((path) =>
    state.tabs.filter((tab) => tab.path === path),
  );
  if (!layout.primary.tabs.length || !layout.secondary.tabs.length) {
    const survivor = layout.primary.tabs.length
      ? layout.primary
      : layout.secondary;
    const { groups: _groups, ...rest } = state;
    return {
      ...rest,
      tabs,
      active: survivor.active === graphTabPath ? null : survivor.active,
      lastGroup: layout.primary.tabs.length ? "primary" : "secondary",
    };
  }
  return {
    ...state,
    tabs,
    active: active === graphTabPath ? null : active,
    groups: layout,
  };
}
export function reduceGroups(state: Workspace, action: GroupAction): Workspace {
  if (action.type === "restoreGroups")
    return reconcileGroups(
      { ...state, groups: action.layout },
      { ...state, active: null },
    );
  const current = state.groups;
  if (action.type === "mergeGroups") {
    if (!current) return state;
    const { groups: _groups, ...rest } = state;
    return {
      ...rest,
      tabs: [
        ...new Set([...current.primary.tabs, ...current.secondary.tabs]),
      ].flatMap((path) => state.tabs.filter((tab) => tab.path === path)),
      lastGroup: current.focused,
    };
  }
  if (action.type === "registerGroupGraph") {
    if (!current || groupFor(current, graphTabPath)) return state;
    const tabs = [...current.primary.tabs];
    tabs.splice(Math.min(tabs.length, action.position), 0, graphTabPath);
    return {
      ...state,
      groups: { ...current, primary: { ...current.primary, tabs } },
    };
  }
  if (action.type === "closeGroupGraph") {
    if (!current) return state;
    const next = { ...current };
    for (const id of ids)
      next[id] = select(
        current[id],
        current[id].tabs.filter((path) => path !== graphTabPath),
      );
    return finish(state, next);
  }
  if (action.type === "resizeGroups")
    return current && Number.isFinite(action.ratio)
      ? {
          ...state,
          groups: {
            ...current,
            ratio: Math.max(20, Math.min(80, action.ratio)),
          },
        }
      : state;
  if (action.type === "focusGroup")
    return current && current.focused !== action.group
      ? finish(state, { ...current, focused: action.group })
      : state;
  if (
    action.path !== graphTabPath &&
    !state.tabs.some((tab) => tab.path === action.path)
  )
    return state;
  if (action.type === "closeGroupTab") {
    if (
      !current ||
      !current[otherGroup(action.group)].tabs.includes(action.path)
    )
      return state;
    const source = current[action.group];
    const group = select(
      source,
      source.tabs.filter((path) => path !== action.path),
    );
    return finish(state, {
      ...current,
      [action.group]: group,
      focused: group.tabs.length ? current.focused : otherGroup(action.group),
    });
  }
  if (action.type === "openBeside") {
    const destination = otherGroup(action.from);
    if (current)
      return reduceGroups(state, {
        type: "activateGroupTab",
        group: destination,
        path: action.path,
      });
    const tabs = state.tabs.map((tab) => tab.path);
    if (action.graphOpen)
      tabs.splice(
        Math.min(tabs.length, action.graphPosition ?? tabs.length),
        0,
        graphTabPath,
      );
    return finish(state, {
      primary: {
        tabs,
        active: action.activeGraph
          ? graphTabPath
          : (state.active ?? action.path),
      },
      secondary: { tabs: [action.path], active: action.path },
      focused: "secondary",
      ratio: 50,
    });
  }
  if (!current) {
    if (action.type === "activateGroupTab")
      return {
        ...state,
        active: action.path === graphTabPath ? null : action.path,
      };
    const all = state.tabs.map((tab) => tab.path);
    if (action.graphOpen && action.path !== graphTabPath)
      all.splice(
        Math.min(all.length, action.graphPosition ?? all.length),
        0,
        graphTabPath,
      );
    const remaining = all.filter((path) => path !== action.path);
    if (!remaining.length) return state;
    const source = {
      tabs: remaining,
      active:
        action.activeGraph && remaining.includes(graphTabPath)
          ? graphTabPath
          : state.active && remaining.includes(state.active)
            ? state.active
            : remaining[0],
    };
    const destination = { tabs: [action.path], active: action.path };
    return finish(state, {
      primary: action.group === "primary" ? destination : source,
      secondary: action.group === "secondary" ? destination : source,
      focused: action.group,
      ratio: 50,
    });
  }
  if (action.type === "activateGroupTab") {
    const owner =
      action.path === graphTabPath
        ? (groupFor(current, action.path) ?? action.group)
        : action.group;
    const group = current[owner];
    return finish(state, {
      ...current,
      focused: owner,
      [owner]: {
        tabs: group.tabs.includes(action.path)
          ? group.tabs
          : [...group.tabs, action.path],
        active: action.path,
      },
    });
  }
  const source = action.from ?? groupFor(current, action.path);
  if (!action.target && source === action.group)
    return finish(state, {
      ...current,
      focused: action.group,
      [action.group]: { ...current[action.group], active: action.path },
    });
  const next = { ...current, focused: action.group };
  if (source && source !== action.group)
    next[source] = select(
      current[source],
      current[source].tabs.filter((path) => path !== action.path),
    );
  const target = next[action.group].tabs.filter((path) => path !== action.path);
  const index = action.target ? target.indexOf(action.target) : -1;
  target.splice(
    index < 0 ? target.length : index + Number(action.after),
    0,
    action.path,
  );
  next[action.group] = { tabs: target, active: action.path };
  return finish(state, next);
}

/** Reconcile file operations in the same transaction as buffers and drafts. */
export function reconcileGroups(
  previous: Workspace,
  next: Workspace,
  action?: Action,
): Workspace {
  const current = previous.groups;
  if (!current) return next;
  const layout: GroupLayout = { ...current };
  const rename =
    action?.type === "replace"
      ? { from: action.path, to: action.note.path }
      : action?.type === "relocateImage"
        ? { from: action.path, to: action.destination }
        : null;
  const available = new Set(next.tabs.map((tab) => tab.path));
  available.add(graphTabPath);
  const assigned = new Set<string>();
  for (const id of ids) {
    const group = current[id];
    const remap = (path: string) =>
      rename && path === rename.from ? rename.to : path;
    const tabs = [...new Set(group.tabs.map(remap))].filter((path) => {
      if (
        !available.has(path) ||
        (assigned.has(path) && !markdownFile.test(path))
      )
        return false;
      assigned.add(path);
      return true;
    });
    layout[id] = select(
      {
        tabs: group.tabs.map(remap),
        active: group.active ? remap(group.active) : null,
      },
      tabs,
    );
  }
  for (const tab of next.tabs)
    if (!assigned.has(tab.path)) {
      const group = action?.type === "open" ? action.group : undefined;
      layout[group ?? layout.focused].tabs.push(tab.path);
    }
  if (action?.type === "close") {
    // Closing selects a neighbour in the same group, never the other editor.
    const focused = layout[layout.focused];
    return finish(next, {
      ...layout,
      focused: focused.tabs.length
        ? layout.focused
        : otherGroup(layout.focused),
    });
  }
  const background = action?.type === "open" && action.background;
  if (
    next.active &&
    !background &&
    (!action ||
      action.type === "open" ||
      action.type === "openImage" ||
      action.type === "openInTab" ||
      action.type === "activate")
  ) {
    const requested = action?.type === "open" ? action.group : undefined;
    const owner = requested ?? groupFor(layout, next.active);
    if (owner) {
      layout.focused = owner;
      const group = layout[owner];
      layout[owner] = {
        tabs: group.tabs.includes(next.active)
          ? group.tabs
          : [...group.tabs, next.active],
        active: next.active,
      };
    }
  }
  return finish(next, layout);
}

export function parseGroupLayout(value: unknown): GroupLayout | undefined {
  if (
    !value ||
    typeof value !== "object" ||
    !("primary" in value) ||
    !("secondary" in value) ||
    !("focused" in value) ||
    !("ratio" in value)
  )
    return;
  if (
    (value.focused !== "primary" && value.focused !== "secondary") ||
    typeof value.ratio !== "number" ||
    !Number.isFinite(value.ratio)
  )
    return;
  const parse = (candidate: unknown): TabGroup | undefined => {
    if (
      !candidate ||
      typeof candidate !== "object" ||
      !("tabs" in candidate) ||
      !Array.isArray(candidate.tabs) ||
      !("active" in candidate)
    )
      return;
    if (
      candidate.tabs.length > 1000 ||
      !candidate.tabs.every(
        (path): path is string => typeof path === "string" && !!path,
      )
    )
      return;
    const tabs = [...new Set(candidate.tabs)];
    return {
      tabs,
      active:
        typeof candidate.active === "string" && tabs.includes(candidate.active)
          ? candidate.active
          : (tabs[0] ?? null),
    };
  };
  const primary = parse(value.primary),
    secondary = parse(value.secondary);
  if (!primary || !secondary) return;
  const right = select(
    secondary,
    secondary.tabs.filter(
      (path) => markdownFile.test(path) || !primary.tabs.includes(path),
    ),
  );
  return {
    primary,
    secondary: right,
    focused: value.focused,
    ratio: Math.max(20, Math.min(80, value.ratio)),
  };
}
