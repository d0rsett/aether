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

it("preserves coordinates and pins while adding and removing indexed notes", async () => {
  const { mergeGraphNodes } = await import("../src/graph/model");
  const previous = nodes();
  previous[0].pinned = true;
  const merged = mergeGraphNodes(
    [
      { path: "A.md", title: "Renamed title" },
      { path: "new.md", title: "New" },
    ],
    previous,
    [["A.md", "new.md"]],
  );
  expect(merged[0]).toMatchObject({
    x: previous[0].x,
    y: previous[0].y,
    pinned: true,
    title: "Renamed title",
  });
  expect(merged).toHaveLength(2);
  expect(merged[1].x).toBe(previous[0].x + 32);
  expect(
    mergeGraphNodes(
      [{ path: "A.md", title: "A" }],
      [],
      [],
      [["A.md", 72, 41, true]],
    )[0],
  ).toMatchObject({ x: 72, y: 41, pinned: true });
});
it("keeps dense labels apart while allowing the hovered note label", async () => {
  const { graphLabels } = await import("../src/graph/model");
  const list = nodes();
  list.forEach((n) => {
    n.x = 1;
    n.y = 1;
  });
  expect(graphLabels(list, 1, null).size).toBe(1);
  expect(graphLabels(list, 1, list[2].path).has(list[2].path)).toBe(true);
  expect(graphLabels(list, 0.2, null).size).toBe(0);
});
it("handles a 10000-note graph without non-finite coordinates", () => {
  const list: GraphNode[] = Array.from({ length: 10000 }, (_, i) => ({
    path: `N${i}.md`,
    title: `N${i}`,
    x: Math.cos(i * 2.4) * Math.sqrt(i + 1) * 24,
    y: Math.sin(i * 2.4) * Math.sqrt(i + 1) * 24,
    vx: 0,
    vy: 0,
  }));
  const links: GraphEdge[] = list
    .slice(1)
    .map((n, i) => [list[i].path, n.path]);
  const start = performance.now();
  for (let i = 0; i < 10; i++) stepLayout(list, links, defaultForces);
  console.log(
    `10000-note graph: ${((performance.now() - start) / 10).toFixed(1)} ms per layout step`,
  );
  expect(list.every((n) => Number.isFinite(n.x) && Number.isFinite(n.y))).toBe(
    true,
  );
});
