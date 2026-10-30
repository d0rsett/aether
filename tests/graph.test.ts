import { expect, it } from "vitest";
import {
  defaultForces,
  filterGraph,
  stepLayout,
  type GraphNode,
  type GraphEdge,
} from "../src/graph/model";
const nodes = (): GraphNode[] =>
  ["A.md", "B.md", "folder/C.md", "orphan.md"].map((path, i) => ({
    path,
    title: path,
    x: i * 30,
    y: i * 20,
    vx: 0,
    vy: 0,
  }));
const edges: GraphEdge[] = [
  ["A.md", "B.md"],
  ["B.md", "folder/C.md"],
];
it("expands local depth in both directions and excludes unrelated notes", () => {
  expect(
    filterGraph(nodes(), edges, "", "A.md", 1, true).nodes.map((n) => n.path),
  ).toEqual(["A.md", "B.md"]);
  expect(
    filterGraph(nodes(), edges, "", "A.md", 2, true).nodes.map((n) => n.path),
  ).toEqual(["A.md", "B.md", "folder/C.md"]);
  expect(
    filterGraph(nodes(), edges, "", "folder/C.md", 1, true).nodes.map(
      (n) => n.path,
    ),
  ).toEqual(["B.md", "folder/C.md"]);
});
it("filters paths and orphans and removes edges to hidden nodes", () => {
  expect(
    filterGraph(nodes(), edges, "folder", undefined, 1, true).edges,
  ).toEqual([]);
  expect(
    filterGraph(nodes(), edges, "folder", undefined, 1, true).nodes,
  ).toHaveLength(1);
  expect(
    filterGraph(nodes(), edges, "", undefined, 1, false).nodes,
  ).toHaveLength(3);
});
it("keeps dragged nodes fixed while relaxing neighbors to finite positions", () => {
  const list = nodes(),
    original = { ...list[0] };
  for (let i = 0; i < 100; i++) stepLayout(list, edges, defaultForces, "A.md");
  expect(list[0]).toEqual(original);
  expect(list[1].x).not.toBe(30);
  expect(list.every((n) => Number.isFinite(n.x) && Number.isFinite(n.y))).toBe(
    true,
  );
});
