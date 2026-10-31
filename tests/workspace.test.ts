import { describe, expect, it } from "vitest";
import {
  dirty,
  initialWorkspace,
  workspaceReducer,
} from "../src/workspace/model";

const note = { path: "Заметки/Привет.md", content: "original", revision: "r1" };
describe("workspace safety", () => {
  it("keeps image tabs read-only, unique and separate from note drafts", () => {
    let state = workspaceReducer(initialWorkspace, { type: "open", note });
    state = workspaceReducer(state, {
      type: "edit",
      path: note.path,
      content: "unsaved text",
    });
    state = workspaceReducer(state, { type: "openImage", path: "photo.png" });
    state = workspaceReducer(state, { type: "openImage", path: "photo.png" });
    state = workspaceReducer(state, {
      type: "edit",
      path: "photo.png",
      content: "should be ignored",
    });
    expect(state.tabs).toHaveLength(2);
    expect(dirty(state.tabs[1])).toBe(false);
    expect(state.tabs[1].content).toBe("");
    state = workspaceReducer(state, {
      type: "relocateImage",
      path: "photo.png",
      destination: "Media/photo.png",
    });
    expect(state.active).toBe("Media/photo.png");
    state = workspaceReducer(state, { type: "close", path: "Media/photo.png" });
    expect(state.active).toBe(note.path);
    expect(state.tabs[0].content).toBe("unsaved text");
    expect(dirty(state.tabs[0])).toBe(true);
  });
  it("opens a note only once and switches tabs", () => {
    let state = workspaceReducer(initialWorkspace, { type: "open", note });
    state = workspaceReducer(state, {
      type: "open",
      note: { ...note, path: "second.md" },
    });
    state = workspaceReducer(state, { type: "open", note });
    expect(state.tabs).toHaveLength(2);
    expect(state.active).toBe(note.path);
  });
  it("does not discard edits typed while a save is in flight", () => {
    let state = workspaceReducer(initialWorkspace, { type: "open", note });
    state = workspaceReducer(state, {
      type: "edit",
      path: note.path,
      content: "saved snapshot",
    });
    state = workspaceReducer(state, {
      type: "edit",
      path: note.path,
      content: "newer text",
    });
    state = workspaceReducer(state, {
      type: "saved",
      path: note.path,
      content: "saved snapshot",
      revision: "r2",
    });
    expect(state.tabs[0].content).toBe("newer text");
    expect(state.tabs[0].revision).toBe("r2");
    expect(dirty(state.tabs[0])).toBe(true);
  });
  it("renames and closes the active tab without leaving an invalid selection", () => {
    let state = workspaceReducer(initialWorkspace, { type: "open", note });
    state = workspaceReducer(state, {
      type: "replace",
      path: note.path,
      note: { ...note, path: "Мир.md" },
    });
    expect(state.active).toBe("Мир.md");
    state = workspaceReducer(state, { type: "close", path: "Мир.md" });
    expect(state).toEqual(initialWorkspace);
  });
});

it("opens background notes without activating or replacing existing drafts", async () => {
  const { workspaceReducer, initialWorkspace } =
    await import("../src/workspace/model");
  let state = workspaceReducer(initialWorkspace, {
    type: "open",
    note: { path: "A.md", content: "saved", revision: "one" },
  });
  state = workspaceReducer(state, {
    type: "edit",
    path: "A.md",
    content: "draft",
  });
  state = workspaceReducer(state, {
    type: "open",
    note: { path: "B.md", content: "B", revision: "two" },
    background: true,
  });
  expect(state.active).toBe("A.md");
  state = workspaceReducer(state, {
    type: "open",
    note: { path: "A.md", content: "stale", revision: "old" },
    background: true,
  });
  expect(state.tabs[0].content).toBe("draft");
  expect(state.tabs).toHaveLength(2);
});
