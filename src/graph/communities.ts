import { UndirectedGraph } from "graphology";
import louvain from "graphology-communities-louvain";
import type { GraphEdge, GraphNode } from "./model";

export interface NoteCommunity {
  root: string;
  members: string[];
}

/** Ignore edge direction/repetition for geometry, without altering navigation data. */
export function layoutEdges(
  nodes: Pick<GraphNode, "path">[],
  edges: GraphEdge[],
): GraphEdge[] {
  const paths = new Set(nodes.map((node) => node.path));
  const seen = new Set<string>();
  const result: GraphEdge[] = [];
  for (const [a, b] of edges) {
    if (a === b || !paths.has(a) || !paths.has(b)) continue;
    const pair: GraphEdge = a < b ? [a, b] : [b, a];
    const key = JSON.stringify(pair);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(pair);
    }
  }
  return result.sort(
    (a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]),
  );
}

export function noteCommunities(
  nodes: Pick<GraphNode, "path">[],
  edges: GraphEdge[],
): NoteCommunity[] {
  const graph = new UndirectedGraph();
  for (const node of [...nodes].sort((a, b) => a.path.localeCompare(b.path)))
    graph.addNode(node.path);
  for (const [a, b] of layoutEdges(nodes, edges)) graph.addEdge(a, b);
  // Stable ordering and traversal keep reset reproducible, independent of IPC order.
  const partition = louvain(graph, { randomWalk: false, getEdgeWeight: null });
  const groups = new Map<number, string[]>();
  for (const path of graph.nodes()) {
    const id = partition[path];
    const members = groups.get(id) ?? [];
    members.push(path);
    groups.set(id, members);
  }
  return [...groups.values()]
    .map((members) => {
      const memberSet = new Set(members);
      const scores = new Map(
        members.map((path) => {
          const internal = graph
            .neighbors(path)
            .filter((neighbor) => memberSet.has(neighbor)).length;
          // A vault-wide map with many external links should not displace a local hub.
          return [
            path,
            (internal * internal) / Math.max(1, graph.degree(path)),
          ] as const;
        }),
      );
      members.sort(
        (a, b) =>
          (scores.get(b) ?? 0) - (scores.get(a) ?? 0) || a.localeCompare(b),
      );
      return { root: members[0], members };
    })
    .sort(
      (a, b) =>
        b.members.length - a.members.length || a.root.localeCompare(b.root),
    );
}

/** Equal-area disc seeds prevent folder order or cluster counts from stretching
 * the whole vault into a strip. Links, not rigid rings, place dependent notes. */
export function communityPositions(
  nodes: Pick<GraphNode, "path" | "title">[],
  edges: GraphEdge[],
): Map<string, { x: number; y: number }> {
  const result = new Map<string, { x: number; y: number }>();
  if (!nodes.length) return result;
  const links = layoutEdges(nodes, edges);
  const degree = new Map<string, number>();
  for (const [a, b] of links) {
    degree.set(a, (degree.get(a) ?? 0) + 1);
    degree.set(b, (degree.get(b) ?? 0) + 1);
  }
  const ranked = [...nodes].sort(
    (a, b) =>
      (degree.get(b.path) ?? 0) - (degree.get(a.path) ?? 0) ||
      a.path.localeCompare(b.path),
  );
  const dominant =
    (degree.get(ranked[0].path) ?? 0) >
    2.5 * Math.max(1, degree.get(ranked[1]?.path) ?? 0)
      ? ranked[0].path
      : null;
  const hubs = noteCommunities(nodes, links)
    .map((group) => group.root)
    .filter((path) => path !== dominant && (degree.get(path) ?? 0) >= 4)
    .slice(0, 64);
  const goldenAngle = 2.399963229728653;
  const slots = nodes.map((_, index) => ({
    x: Math.cos(index * goldenAngle) * 42 * Math.sqrt(index),
    y: Math.sin(index * goldenAngle) * 42 * Math.sqrt(index),
  }));
  const occupied = new Set<number>();
  const assign = (path: string, x: number, y: number) => {
    let best = -1,
      distance = Infinity;
    slots.forEach((slot, index) => {
      if (occupied.has(index)) return;
      const d = (slot.x - x) ** 2 + (slot.y - y) ** 2;
      if (d < distance) {
        distance = d;
        best = index;
      }
    });
    if (best >= 0) {
      occupied.add(best);
      result.set(path, slots[best]);
    }
  };
  if (dominant) assign(dominant, 0, 0);
  const radius = 42 * Math.sqrt(nodes.length) * 0.68;
  hubs.forEach((path, index) => {
    const angle = (index * Math.PI * 2) / hubs.length + 0.3;
    assign(path, Math.cos(angle) * radius, Math.sin(angle) * radius);
  });
  // A stable hash breaks up artificial file-name/folder bands in the initial disc.
  const hash = (path: string) => {
    let value = 2166136261;
    for (const character of path)
      value = Math.imul(value ^ character.charCodeAt(0), 16777619);
    return value >>> 0;
  };
  let next = 0;
  for (const node of [...nodes].sort(
    (a, b) => hash(a.path) - hash(b.path) || a.path.localeCompare(b.path),
  )) {
    if (result.has(node.path)) continue;
    while (occupied.has(next)) next++;
    occupied.add(next);
    result.set(node.path, slots[next]);
    next++;
  }
  return result;
}
