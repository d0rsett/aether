import { expect, it } from "vitest";
import {
  filterGraph,
  fitGraphCamera,
  graphNodeRadius,
  initialGraphLayout,
  mergeGraphNodes,
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
it("fits the camera to the graph bounding box and centers it", () => {
  const list = nodes();
  list[0].x = -100;
  list[0].y = -50;
  list[1].x = 300;
  list[1].y = 150;
  const camera = fitGraphCamera(list);
  expect(camera.zoom).toBeCloseTo(2);
  expect(camera.x).toBeCloseTo(-200);
  expect(camera.y).toBeCloseTo(-100);
  expect(fitGraphCamera([])).toEqual({ x: 0, y: 0, zoom: 1 });
  expect(
    fitGraphCamera([{ path: "A.md", title: "A", x: 100, y: 40, vx: 0, vy: 0 }]),
  ).toEqual({ x: -200, y: -80, zoom: 2 });
});
it("uses degree-based node radius without mutating graph state", () => {
  const degree = new Map([
    ["A.md", 4],
    ["B.md", 0],
  ]);
  expect(graphNodeRadius("A.md", degree, 2)).toBeCloseTo(8.8);
  expect(graphNodeRadius("B.md", degree, 2)).toBeCloseTo(5.6);
  expect(degree.get("A.md")).toBe(4);
});
it("seeds a reproducible, evenly filled disc instead of separate cluster islands", () => {
  const incoming = Array.from({ length: 350 }, (_, i) => ({
    path: `N${i}`,
    title: `${i}`,
  }));
  const edges: GraphEdge[] = incoming
    .slice(1)
    .map((n, i) => [incoming[i].path, n.path]);
  const layout = initialGraphLayout(incoming, edges);
  expect(layout.size).toBe(incoming.length);
  const values = [...layout.values()];
  const radius = 42 * Math.sqrt(incoming.length);
  expect(values.every((p) => Math.hypot(p.x, p.y) <= radius)).toBe(true);
  expect(
    values.filter((p) => Math.hypot(p.x, p.y) < radius / 2).length,
  ).toBeGreaterThan(75);
  const sx = values.reduce((sum, p) => sum + p.x * p.x, 0),
    sy = values.reduce((sum, p) => sum + p.y * p.y, 0);
  expect(Math.max(sx, sy) / Math.min(sx, sy)).toBeLessThan(1.1);
  const reversed = initialGraphLayout(
    [...incoming].reverse(),
    [...edges].reverse(),
  );
  for (const [path, position] of layout)
    expect(reversed.get(path)).toEqual(position);
});
it("uses clustered positions only when no saved layout exists", () => {
  const incoming = [
      { path: "A Core.md", title: "A Core" },
      { path: "A1.md", title: "A1" },
    ],
    edges: GraphEdge[] = [["A Core.md", "A1.md"]],
    clustered = mergeGraphNodes(incoming, [], edges),
    saved = mergeGraphNodes(incoming, [], edges, [["A Core.md", 72, 41, true]]);
  expect(
    Math.hypot(
      clustered[0].x - clustered[1].x,
      clustered[0].y - clustered[1].y,
    ),
  ).toBeGreaterThan(10);
  expect(saved[0]).toMatchObject({ x: 72, y: 41, pinned: true });
});
it("keeps new orphan notes distinct during partial restore and index refresh", () => {
  const incoming = ["A", "B", "C"].map((path) => ({ path, title: path }));
  const restored = mergeGraphNodes(incoming, [], [], [["A", 72, 41, true]]);
  expect(restored[0]).toMatchObject({ x: 72, y: 41, pinned: true });
  expect(new Set(restored.map((n) => `${n.x}:${n.y}`)).size).toBe(3);
  const refreshed = mergeGraphNodes(
    [...incoming, { path: "D", title: "D" }],
    restored,
    [],
  );
  expect(refreshed.slice(0, 3)).toEqual(restored);
  expect(new Set(refreshed.map((n) => `${n.x}:${n.y}`)).size).toBe(4);
});

it("fans out new siblings around saved neighbors without moving the neighbor", () => {
  const incoming = ["A", "B", "C"].map((path) => ({ path, title: path }));
  const result = mergeGraphNodes(
    incoming,
    [],
    [
      ["A", "B"],
      ["C", "A"],
    ],
    [["A", 72, 41, true]],
  );
  expect(result[0]).toMatchObject({ x: 72, y: 41, pinned: true });
  expect(new Set(result.map((n) => `${n.x}:${n.y}`)).size).toBe(3);
  for (const n of result.slice(1))
    expect(Math.hypot(n.x - 72, n.y - 41)).toBeLessThan(100);
});
