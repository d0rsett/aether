import { afterEach, expect, it } from "vitest";
import {
  defaultGraphView,
  readGraphView,
  writeGraphView,
  readGraphTab,
  writeGraphTab,
} from "../src/workspace/graphStorage";
afterEach(() => localStorage.clear());
it("restores graph state per vault without mixing positions or tab selection", () => {
  const state = defaultGraphView();
  state.query = "Проект";
  state.root = "A.md";
  state.local = true;
  state.camera = { x: 42, y: -18, zoom: 1.7 };
  state.positions = [["A.md", 33, 44, true]];
  writeGraphView("one", state);
  writeGraphTab("one", true, true);
  expect(readGraphView("one")).toEqual(state);
  expect(readGraphView("two")).toEqual(defaultGraphView());
  expect(readGraphTab("one")).toEqual({ open: true, active: true });
  expect(readGraphTab("two")).toEqual({ open: false, active: false });
  writeGraphTab("one", false, true);
  expect(readGraphTab("one")).toEqual({ open: false, active: false });
});
it("validates stored data and rejects malformed coordinates", () => {
  localStorage.setItem(
    "aether.graph.v1:bad",
    JSON.stringify({
      camera: { zoom: 99, x: "bad" },
      depth: -7,
      positions: [
        ["ok.md", 1, 2, true],
        ["bad.md", "NaN", 3],
        ["huge.md", 1e100, 3],
      ],
      forces: { repel: -2 },
      local: "yes",
    }),
  );
  const read = readGraphView("bad");
  expect(read.positions).toEqual([["ok.md", 1, 2, true]]);
  expect(read.camera).toEqual({ x: 0, y: 0, zoom: 5 });
  expect(read.depth).toBe(1);
  expect(read.forces.repel).toBe(0);
  expect(read.local).toBe(false);
  localStorage.setItem("aether.graph.v1:bad", "{");
  expect(readGraphView("bad")).toEqual(defaultGraphView());
});
