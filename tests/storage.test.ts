import { beforeEach, expect, it } from "vitest";
import { readWorkspace, writeWorkspace } from "../src/workspace/storage";

beforeEach(() => localStorage.clear());
it("persists dirty drafts separately per vault, including the original disk revision", () => {
  writeWorkspace("vault-a", {
    active: "Привет.md",
    tabs: [
      {
        path: "Привет.md",
        content: "edited",
        savedContent: "disk",
        revision: "base",
      },
    ],
  });
  expect(readWorkspace("vault-a").drafts["Привет.md"]).toEqual({
    content: "edited",
    revision: "base",
  });
  expect(readWorkspace("vault-b").paths).toEqual([]);
});
it("rejects corrupt workspace data without crashing", () => {
  localStorage.setItem("aether.workspace.v1:vault", "{not json");
  expect(readWorkspace("vault")).toEqual({
    paths: [],
    active: null,
    drafts: {},
  });
});
it("removes recovered drafts after an explicit save", () => {
  writeWorkspace("vault", {
    active: "note.md",
    tabs: [
      {
        path: "note.md",
        content: "saved",
        savedContent: "saved",
        revision: "r2",
      },
    ],
  });
  expect(readWorkspace("vault").drafts).toEqual({});
});
