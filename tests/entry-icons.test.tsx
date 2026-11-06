import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import {
  readEntryIcons,
  useEntryIcons,
} from "../src/workspace/entryIconStorage";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

it("stores icons by vault and moves nested assignments with a renamed folder", () => {
  const { result, rerender } = renderHook(
    ({ vault }) => useEntryIcons(vault, vi.fn()),
    { initialProps: { vault: "first" } },
  );
  act(() => {
    result.current.assign("first", "Plans", "folderOpen");
    result.current.assign("first", "Plans/Board.canvas", "star");
    result.current.assign("first", "Plans Archive/Board.canvas", "archive");
    result.current.assign("second", "Plans/Board.canvas", "heart");
    result.current.remap("first", "Plans", "Projects", true);
  });
  expect([...result.current.icons]).toEqual([
    ["Plans Archive/Board.canvas", "archive"],
    ["Projects", "folderOpen"],
    ["Projects/Board.canvas", "star"],
  ]);
  rerender({ vault: "second" });
  expect([...result.current.icons]).toEqual([["Plans/Board.canvas", "heart"]]);
  act(() => {
    result.current.assign("second", "Plans/Board.canvas", null);
  });
  expect(readEntryIcons("second").size).toBe(0);
  expect(readEntryIcons("first").get("Projects/Board.canvas")).toBe("star");
});
