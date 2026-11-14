import { afterEach, describe, expect, it } from "vitest";
import {
  initialWorkspace,
  workspaceReducer as reduce,
  type Workspace,
} from "../src/workspace/model";
import { graphTabPath, parseGroupLayout } from "../src/workspace/groups";
import { readWorkspace, writeWorkspace } from "../src/workspace/storage";

const note = (path: string) => ({
  path,
  content: path + " text",
  revision: "r1",
});
function opened(): Workspace {
  return ["A.md", "B.md", "C.md", "D.md"].reduce(
    (state, path) => reduce(state, { type: "open", note: note(path) }),
    initialWorkspace,
  );
}
function split(): Workspace {
  return reduce(opened(), {
    type: "moveToGroup",
    path: "B.md",
    group: "secondary",
  });
}
afterEach(() => localStorage.clear());

describe("independent tab groups", () => {
  it("moves the dragged tab into a second group without replacing its buffer", () => {
    const original = opened();
    const edited = reduce(original, {
      type: "edit",
      path: "B.md",
      content: "unsaved",
    });
    const moved = reduce(edited, {
      type: "moveToGroup",
      path: "B.md",
      group: "secondary",
    });
    expect(moved.groups?.primary).toEqual({
      tabs: ["A.md", "C.md", "D.md"],
      active: "D.md",
    });
    expect(moved.groups?.secondary).toEqual({ tabs: ["B.md"], active: "B.md" });
    expect(moved.tabs.find((tab) => tab.path === "B.md")).toBe(edited.tabs[1]);
    expect(original.tabs.map((tab) => tab.path)).toEqual([
      "A.md",
      "B.md",
      "C.md",
      "D.md",
    ]);
  });
  it("can create a group on either half", () => {
    const state = reduce(opened(), {
      type: "moveToGroup",
      path: "B.md",
      group: "primary",
    });
    expect(state.groups?.primary.tabs).toEqual(["B.md"]);
    expect(state.groups?.secondary.tabs).toEqual(["A.md", "C.md", "D.md"]);
  });
  it("keeps each group's active tab when switching focus and opening new files", () => {
    let state = reduce(split(), { type: "open", note: note("E.md") });
    state = reduce(state, { type: "activate", path: "A.md" });
    expect(state.groups?.secondary.active).toBe("E.md");
    state = reduce(state, { type: "open", note: note("F.md") });
    expect(state.groups?.primary.active).toBe("F.md");
    expect(state.groups?.secondary.tabs).toEqual(["B.md", "E.md"]);
    state = reduce(state, { type: "focusGroup", group: "secondary" });
    expect(state.active).toBe("E.md");
    expect(state.groups?.primary.active).toBe("F.md");
  });
  it("reorders within and across groups without duplicate ownership", () => {
    let state = reduce(split(), {
      type: "moveToGroup",
      path: "C.md",
      group: "secondary",
      target: "B.md",
    });
    expect(state.groups?.secondary.tabs).toEqual(["C.md", "B.md"]);
    state = reduce(state, {
      type: "moveToGroup",
      path: "B.md",
      group: "secondary",
      target: "C.md",
      after: false,
    });
    expect(state.groups?.secondary.tabs).toEqual(["B.md", "C.md"]);
    state = reduce(state, {
      type: "moveToGroup",
      path: "B.md",
      group: "primary",
      target: "A.md",
      after: true,
    });
    expect(state.groups?.primary.tabs).toEqual(["A.md", "B.md", "D.md"]);
    expect(state.groups?.secondary.tabs).toEqual(["C.md"]);
    expect(new Set(state.tabs.map((tab) => tab.path)).size).toBe(4);
  });
  it("chooses a neighbour in the same group on close and collapses an empty group", () => {
    let state = reduce(split(), {
      type: "moveToGroup",
      path: "C.md",
      group: "secondary",
    });
    state = reduce(state, { type: "close", path: "C.md" });
    expect(state.active).toBe("B.md");
    expect(state.groups?.primary.active).toBe("D.md");
    state = reduce(state, { type: "close", path: "B.md" });
    expect(state.groups).toBeUndefined();
    expect(state.active).toBe("D.md");
    expect(state.tabs.map((tab) => tab.path)).toEqual(["A.md", "D.md"]);
  });
  it("keeps inactive group selections and memberships through rename and image moves", () => {
    let state = reduce(split(), { type: "openImage", path: "image.png" });
    state = reduce(state, { type: "activate", path: "A.md" });
    state = reduce(state, {
      type: "replace",
      path: "B.md",
      note: note("Renamed.md"),
    });
    state = reduce(state, {
      type: "relocateImage",
      path: "image.png",
      destination: "assets/image.png",
    });
    expect(state.groups?.secondary.tabs).toEqual([
      "Renamed.md",
      "assets/image.png",
    ]);
    expect(state.groups?.secondary.active).toBe("assets/image.png");
    expect(state.active).toBe("A.md");
  });
  it("preserves a background file open without changing the selected tab", () => {
    const state = reduce(split(), {
      type: "open",
      note: note("Embedded.md"),
      background: true,
    });
    expect(state.active).toBe("B.md");
    expect(state.groups?.secondary.tabs).toContain("Embedded.md");
    expect(state.groups?.secondary.active).toBe("B.md");
  });
  it("hosts the graph in one group while keeping a note selected in the other", () => {
    let state = reduce(opened(), {
      type: "moveToGroup",
      path: graphTabPath,
      group: "secondary",
      graphOpen: true,
    });
    expect(state.groups?.primary.active).toBe("D.md");
    expect(state.groups?.secondary.active).toBe(graphTabPath);
    expect(state.active).toBeNull();
    state = reduce(state, {
      type: "open",
      note: note("From graph.md"),
      background: true,
    });
    expect(state.groups?.secondary.active).toBe(graphTabPath);
    state = reduce(state, { type: "closeGroupGraph" });
    expect(state.groups?.secondary.active).toBe("From graph.md");
    expect(state.active).toBe("From graph.md");
  });
  it("merges groups while retaining all buffers and tab order", () => {
    const state = split();
    const merged = reduce(state, { type: "mergeGroups" });
    expect(merged.groups).toBeUndefined();
    expect(merged.tabs.map((tab) => tab.path)).toEqual([
      "A.md",
      "C.md",
      "D.md",
      "B.md",
    ]);
    expect(merged.tabs.every((tab) => state.tabs.includes(tab))).toBe(true);
    expect(merged.active).toBe("B.md");
  });
  it("restores group order, focused group, ratio and drafts in the existing session", () => {
    let state = reduce(split(), {
      type: "edit",
      path: "B.md",
      content: "draft",
    });
    state = reduce(state, { type: "resizeGroups", ratio: 65 });
    writeWorkspace("vault", state);
    const saved = readWorkspace("vault");
    expect(saved.drafts["B.md"].content).toBe("draft");
    expect(saved.groups).toEqual(state.groups);
    const restored = reduce(opened(), {
      type: "restoreGroups",
      layout: saved.groups!,
    });
    expect(restored.groups).toEqual(state.groups);
    expect(restored.active).toBe("B.md");
  });
  it("migrates the old two-file layout once and does not resurrect it after merging", () => {
    localStorage.setItem(
      "aether.workspace.v1:vault",
      JSON.stringify({ paths: ["A.md", "B.md"], active: "B.md", drafts: {} }),
    );
    localStorage.setItem(
      "aether.split.v1:vault",
      JSON.stringify({ primary: "A.md", secondary: "B.md", ratio: 60 }),
    );
    expect(readWorkspace("vault").groups?.secondary.tabs).toEqual(["B.md"]);
    writeWorkspace("vault", opened());
    expect(readWorkspace("vault").groups).toBeUndefined();
  });
  it("discards invalid membership and missing files without dropping existing buffers", () => {
    expect(
      parseGroupLayout({
        primary: {},
        secondary: {},
        focused: "other",
        ratio: NaN,
      }),
    ).toBeUndefined();
    const layout = parseGroupLayout({
      primary: { tabs: ["A.md", "A.md", "Gone.md"], active: "Gone.md" },
      secondary: { tabs: ["A.md", "B.md"], active: "B.md" },
      focused: "secondary",
      ratio: 200,
    })!;
    const state = reduce(opened(), { type: "restoreGroups", layout });
    expect(state.groups?.ratio).toBe(80);
    expect(state.groups?.primary.tabs).toEqual(["A.md"]);
    expect(state.groups?.secondary.tabs).toEqual([
      "A.md",
      "B.md",
      "C.md",
      "D.md",
    ]);
    expect(state.tabs).toHaveLength(4);
  });
  it("restores two views of one draft and closes each view independently", () => {
    let state = reduce(initialWorkspace, { type: "open", note: note("A.md") });
    state = reduce(state, {
      type: "openBeside",
      path: "A.md",
      from: "primary",
    });
    state = reduce(state, {
      type: "edit",
      path: "A.md",
      content: "shared draft",
    });
    state = reduce(state, {
      type: "open",
      note: note("B.md"),
      group: "primary",
    });
    expect(state.groups?.primary.active).toBe("B.md");
    expect(state.groups?.secondary.tabs).toEqual(["A.md"]);
    writeWorkspace("vault", state);
    const saved = readWorkspace("vault");
    expect(saved.paths).toEqual(["A.md", "B.md"]);
    state = reduce(state, { type: "restoreGroups", layout: saved.groups! });
    state = reduce(state, {
      type: "closeGroupTab",
      path: "A.md",
      group: "secondary",
    });
    expect(state.groups).toBeUndefined();
    expect(state.tabs.find(({ path }) => path === "A.md")?.content).toBe(
      "shared draft",
    );
  });
});
