import { expect, it } from "vitest";
import { GraphSimulation } from "../src/graph/simulation";
import { noteCommunities } from "../src/graph/communities";
import {
  defaultForces,
  mergeGraphNodes,
  type GraphNode,
  type GraphEdge,
} from "../src/graph/model";

function star() {
  const nodes: GraphNode[] = Array.from({ length: 10 }, (_, i) => ({
    path: `N${i}`,
    title: `${i}`,
    x: i ? Math.cos(i) * 90 : 0,
    y: i ? Math.sin(i) * 90 : 0,
    vx: 0,
    vy: 0,
  }));
  const edges: GraphEdge[] = nodes.slice(1).map((n) => [nodes[0].path, n.path]);
  return { nodes, edges };
}
it("pulls neighbors toward a dragged hub, releases it on drop, and cools down", () => {
  const { nodes, edges } = star();
  const engine = new GraphSimulation(nodes, edges, defaultForces);
  expect(engine.running).toBe(false);
  const oldCenter = nodes.slice(1).reduce((x, n) => x + n.x, 0) / 9;
  engine.beginDrag("N0");
  engine.moveDrag(400, 100);
  for (let i = 0; i < 80; i++) engine.tick();
  expect(nodes[0]).toMatchObject({ x: 400, y: 100, fx: 400, fy: 100 });
  expect(nodes.slice(1).reduce((x, n) => x + n.x, 0) / 9).toBeGreaterThan(
    oldCenter + 200,
  );
  expect(
    nodes.slice(1).every((n) => Math.hypot(n.x - 400, n.y - 100) < 180),
  ).toBe(true);
  for (let i = 0; i < 200; i++) engine.tick();
  expect(engine.running).toBe(true);
  engine.endDrag();
  expect(nodes[0].fx).toBeNull();
  expect(nodes[0].pinned).not.toBe(true);
  for (let i = 0; i < 400; i++) engine.tick();
  expect(engine.running).toBe(false);
  engine.dispose();
});
it("separates temporary drag locks from persistent pins and releases on disposal", () => {
  const { nodes, edges } = star();
  const engine = new GraphSimulation(nodes, edges, defaultForces);
  engine.setPinned("N1", true);
  const fixed = { x: nodes[1].x, y: nodes[1].y };
  engine.beginDrag("N0");
  engine.moveDrag(300, 200);
  for (let i = 0; i < 10; i++) engine.tick();
  expect(nodes[1]).toMatchObject(fixed);
  engine.dispose();
  expect(nodes[0].fx).toBeNull();
  expect(nodes[1].fx).toBe(fixed.x);
  engine.setPinned("N1", false);
  expect(nodes[1].fx).toBeNull();
});
it("avoids overlapping nodes using the displayed node size", () => {
  const nodes: GraphNode[] = Array.from({ length: 20 }, (_, i) => ({
    path: `N${i}`,
    title: `${i}`,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
  }));
  const engine = new GraphSimulation(
    nodes,
    [],
    { ...defaultForces, center: 0, repel: 0 },
    3,
  );
  engine.reheat();
  for (let i = 0; i < 80; i++) engine.tick();
  let nearest = Infinity;
  for (let i = 0; i < nodes.length; i++)
    for (let j = i + 1; j < nodes.length; j++)
      nearest = Math.min(
        nearest,
        Math.hypot(nodes[i].x - nodes[j].x, nodes[i].y - nodes[j].y),
      );
  expect(nearest).toBeGreaterThan(30);
  engine.dispose();
});
it("does not mutate IPC edge tuples or treat repeated links as extra springs", () => {
  const a = star(),
    b = star();
  const original = structuredClone(a.edges);
  const first = new GraphSimulation(a.nodes, a.edges, defaultForces);
  const second = new GraphSimulation(
    b.nodes,
    [
      ...b.edges,
      ...b.edges.map(([a, b]): GraphEdge => [b, a]),
      ["missing", "N0"],
      ["N0", "N0"],
    ],
    defaultForces,
  );
  first.reheat();
  second.reheat();
  for (let i = 0; i < 30; i++) {
    first.tick();
    second.tick();
  }
  expect(a.edges).toEqual(original);
  expect(a.nodes).toEqual(b.nodes);
  first.dispose();
  second.dispose();
});
it("detects communities and picks a local center despite a vault-wide index note", () => {
  const nodes = [{ path: "Index", title: "Index" }];
  const edges: GraphEdge[] = [];
  for (const prefix of ["A", "B", "C"]) {
    nodes.push({ path: prefix, title: prefix });
    for (let i = 0; i < 12; i++) {
      const path = `${prefix}${i}`;
      nodes.push({ path, title: path });
      edges.push([prefix, path], ["Index", path]);
      if (i) edges.push([`${prefix}${i - 1}`, path]);
    }
  }
  const groups = noteCommunities(nodes, edges);
  for (const prefix of ["A", "B", "C"]) {
    const group = groups.find((g) => g.members.includes(prefix));
    expect(group?.root).toBe(prefix);
    expect(
      group?.members.filter((n) => n.startsWith(prefix)).length,
    ).toBeGreaterThan(10);
  }
  expect(noteCommunities([...nodes].reverse(), [...edges].reverse())).toEqual(
    groups,
  );
});
it("keeps a 10000-note simulation finite", () => {
  const incoming = Array.from({ length: 10000 }, (_, i) => ({
    path: `N${i}`,
    title: `${i}`,
  }));
  const edges: GraphEdge[] = incoming
    .slice(1)
    .map((n, i) => [incoming[i].path, n.path]);
  const nodes = mergeGraphNodes(incoming, [], edges);
  const engine = new GraphSimulation(nodes, edges, defaultForces);
  engine.reheat();
  const start = performance.now();
  for (let i = 0; i < 10; i++) engine.tick();
  console.log(
    `D3 10000 nodes: ${((performance.now() - start) / 10).toFixed(1)} ms/tick`,
  );
  expect(nodes.every((n) => Number.isFinite(n.x) && Number.isFinite(n.y))).toBe(
    true,
  );
  engine.dispose();
}, 60000);

it("distributes children with consistent clearance around densely connected hubs", () => {
  const incoming = Array.from({ length: 123 }, (_, i) => ({
    path: `N${i}`,
    title: `${i}`,
  }));
  const links: GraphEdge[] = [];
  for (let group = 0; group < 3; group++) {
    const hub = group * 41;
    for (let child = 1; child <= 40; child++) {
      links.push([`N${hub}`, `N${hub + child}`]);
      links.push([`N${hub + child}`, `N${hub + (child % 40) + 1}`]);
    }
    if (group) links.push([`N${hub - 41}`, `N${hub}`]);
  }
  const nodes = mergeGraphNodes(incoming, [], links);
  const engine = new GraphSimulation(nodes, links, defaultForces);
  engine.reheat();
  for (let i = 0; i < 400; i++) engine.tick();
  const nearest = nodes
    .map((node, i) =>
      Math.min(
        ...nodes
          .filter((_, j) => j !== i)
          .map((other) => Math.hypot(node.x - other.x, node.y - other.y)),
      ),
    )
    .sort((a, b) => a - b);
  const median = nearest[Math.floor(nearest.length / 2)];
  console.log("spacing", {
    min: nearest[0],
    median,
    p10: nearest[Math.floor(nearest.length * 0.1)],
    max: nearest.at(-1),
  });
  expect(nearest[0]).toBeGreaterThan(35);
  expect(nearest[Math.floor(nearest.length * 0.1)] / median).toBeGreaterThan(
    0.65,
  );
  expect(nearest.filter((distance) => distance < median * 0.55)).toHaveLength(
    0,
  );
  engine.dispose();
});

it("keeps a connected vault round and fills its interior after settling", () => {
  const incoming = Array.from({ length: 349 }, (_, i) => ({
    path: `R${i}`,
    title: `${i}`,
  }));
  const edges: GraphEdge[] = [];
  for (let i = 1; i < incoming.length; i++) {
    edges.push(["R0", `R${i}`]);
    const hub = 1 + Math.floor((i - 1) / 58) * 58;
    if (i !== hub) edges.push([`R${hub}`, `R${i}`]);
    if (i > 1) edges.push([`R${i - 1}`, `R${i}`]);
  }
  const nodes = mergeGraphNodes(incoming, [], edges);
  const engine = new GraphSimulation(nodes, edges, defaultForces);
  engine.reheat(1);
  for (let i = 0; i < 280; i++) engine.tick();
  const x = nodes.reduce((sum, n) => sum + n.x, 0) / nodes.length;
  const y = nodes.reduce((sum, n) => sum + n.y, 0) / nodes.length;
  const xx = nodes.reduce((sum, n) => sum + (n.x - x) ** 2, 0);
  const yy = nodes.reduce((sum, n) => sum + (n.y - y) ** 2, 0);
  const xy = nodes.reduce((sum, n) => sum + (n.x - x) * (n.y - y), 0);
  const spread = Math.hypot(xx - yy, 2 * xy);
  expect(Math.sqrt((xx + yy + spread) / (xx + yy - spread))).toBeLessThan(1.5);
  const radii = nodes
    .map((n) => Math.hypot(n.x - x, n.y - y))
    .sort((a, b) => a - b);
  // A circle must have an occupied interior, rather than turn into a ring.
  expect(
    radii[Math.floor(nodes.length * 0.1)] /
      radii[Math.floor(nodes.length * 0.9)],
  ).toBeLessThan(0.5);
  engine.dispose();
}, 15000);

it("moves dense hub neighbors promptly without disturbing a disconnected group", () => {
  const nodes: GraphNode[] = Array.from({ length: 13 }, (_, i) => ({
    path: "D" + i,
    title: "Dense " + i,
    x: i === 12 ? -1000 : Math.cos(i) * 140,
    y: i === 12 ? -1000 : Math.sin(i) * 140,
    vx: 0,
    vy: 0,
  }));
  const edges: GraphEdge[] = [];
  for (let a = 0; a < 12; a++)
    for (let b = a + 1; b < 12; b++) edges.push([nodes[a].path, nodes[b].path]);
  const engine = new GraphSimulation(nodes, edges, {
    ...defaultForces,
    center: 0,
    repel: 0,
  });
  engine.reheat();
  for (let i = 0; i < 400; i++) engine.tick();
  const before = nodes.slice(1, 12).reduce((sum, n) => sum + n.x, 0) / 11;
  const isolated = { x: nodes[12].x, y: nodes[12].y };
  engine.beginDrag("D0");
  engine.moveDrag(nodes[0].x + 300, nodes[0].y);
  for (let i = 0; i < 25; i++) engine.tick();
  expect(
    nodes.slice(1, 12).reduce((sum, n) => sum + n.x, 0) / 11 - before,
  ).toBeGreaterThan(70);
  expect(nodes[12].x).toBeCloseTo(isolated.x, 3);
  expect(nodes[12].y).toBeCloseTo(isolated.y, 3);
  engine.endDrag();
  for (let i = 0; i < 400; i++) engine.tick();
  expect(engine.running).toBe(false);
  engine.dispose();
});
