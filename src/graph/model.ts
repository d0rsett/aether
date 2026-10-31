import { communityPositions } from "./communities";
export type GraphNode = {
  path: string;
  title: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  pinned?: boolean;
  fx?: number | null;
  fy?: number | null;
  index?: number;
};
export type GraphEdge = [string, string];
export type Forces = {
  center: number;
  repel: number;
  strength: number;
  distance: number;
};
export const defaultForces: Forces = {
  center: 0.5,
  repel: 1,
  strength: 0.5,
  distance: 100,
};
export function graphNodeRadius(
  path: string,
  degree: Map<string, number>,
  size: number,
): number {
  // Keep ordinary notes small; connectivity should distinguish hubs rather
  // than inflate every child in a dense vault.
  return (
    (2.8 +
      Math.min(12, Math.max(0, Math.sqrt(degree.get(path) ?? 0) - 1) * 1.6)) *
    size
  );
}
export function fitGraphCamera(
  nodes: GraphNode[],
  viewportWidth = 1000,
  viewportHeight = 700,
  padding = 80,
): { x: number; y: number; zoom: number } {
  if (!nodes.length) return { x: 0, y: 0, zoom: 1 };
  const bounds = nodes.reduce(
    (extent, node) => ({
      minX: Math.min(extent.minX, node.x),
      maxX: Math.max(extent.maxX, node.x),
      minY: Math.min(extent.minY, node.y),
      maxY: Math.max(extent.maxY, node.y),
    }),
    { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity },
  );
  const width = Math.max(1, bounds.maxX - bounds.minX),
    height = Math.max(1, bounds.maxY - bounds.minY),
    centerX = (bounds.minX + bounds.maxX) / 2,
    centerY = (bounds.minY + bounds.maxY) / 2,
    availableWidth = Math.max(1, viewportWidth - padding * 2),
    availableHeight = Math.max(1, viewportHeight - padding * 2),
    zoom = Math.max(
      0.02,
      Math.min(2, availableWidth / width, availableHeight / height),
    );
  return { x: -centerX * zoom, y: -centerY * zoom, zoom };
}
export function filterGraph(
  nodes: GraphNode[],
  edges: GraphEdge[],
  query: string,
  root: string | undefined,
  depth: number,
  orphans: boolean,
) {
  const neighbors = new Map<string, Set<string>>();
  for (const [a, b] of edges) {
    if (!neighbors.has(a)) neighbors.set(a, new Set());
    if (!neighbors.has(b)) neighbors.set(b, new Set());
    neighbors.get(a)?.add(b);
    neighbors.get(b)?.add(a);
  }
  const reachable = new Set(root ? [root] : []);
  let frontier = root ? [root] : [];
  for (let step = 0; root && step < depth; step++) {
    const next: string[] = [];
    for (const path of frontier)
      for (const neighbor of neighbors.get(path) ?? []) {
        if (!reachable.has(neighbor)) {
          reachable.add(neighbor);
          next.push(neighbor);
        }
      }
    frontier = next;
  }
  const term = query.trim().toLocaleLowerCase();
  const visible = nodes.filter(
    (n) =>
      (!root || reachable.has(n.path)) &&
      (orphans || neighbors.has(n.path)) &&
      `${n.title} ${n.path}`.toLocaleLowerCase().includes(term),
  );
  const paths = new Set(visible.map((n) => n.path));
  return {
    nodes: visible,
    edges: edges.filter(([a, b]) => paths.has(a) && paths.has(b)),
  };
}
export function initialGraphLayout(
  nodes: Pick<GraphNode, "path" | "title">[],
  edges: GraphEdge[],
): Map<string, { x: number; y: number }> {
  return communityPositions(nodes, edges);
}

export function mergeGraphNodes(
  incoming: { path: string; title: string }[],
  previous: GraphNode[],
  edges: GraphEdge[],
  saved: [string, number, number, boolean][] = [],
): GraphNode[] {
  const old = new Map(previous.map((n) => [n.path, n]));
  const stored = new Map(
    saved.map(([path, x, y, pinned]) => [path, { x, y, pinned }]),
  );
  const fresh = incoming.filter(
    (node) => !old.has(node.path) && !stored.has(node.path),
  );
  const layout = fresh.length ? initialGraphLayout(incoming, edges) : null;
  const anchors = new Map<string, { x: number; y: number }>();
  for (const [a, b] of edges) {
    const knownA = old.get(a) ?? stored.get(a);
    const knownB = old.get(b) ?? stored.get(b);
    if (knownA && !knownB && !anchors.has(b)) anchors.set(b, knownA);
    if (knownB && !knownA && !anchors.has(a)) anchors.set(a, knownB);
  }
  const slots = new Map<string, number>();
  const occupied = new Set<string>();
  for (const node of incoming) {
    const known = old.get(node.path) ?? stored.get(node.path);
    if (known) occupied.add(`${known.x}:${known.y}`);
  }
  const result = incoming.map((node) => {
    const existing = old.get(node.path) ?? stored.get(node.path);
    let { x, y } = existing ?? layout?.get(node.path) ?? { x: 0, y: 0 };
    if (!existing) {
      const anchor = anchors.get(node.path);
      if (anchor) {
        const key = `${anchor.x}:${anchor.y}`;
        const slot = slots.get(key) ?? 0;
        slots.set(key, slot + 1);
        const angle = Math.atan2(24, 32) + slot * 2.399963229728653;
        const radius = 40 + 20 * Math.sqrt(slot);
        x = anchor.x + Math.cos(angle) * radius;
        y = anchor.y + Math.sin(angle) * radius;
      }
      // Keep partial restores and newly indexed orphan notes independently selectable.
      while (occupied.has(`${x}:${y}`)) {
        x += 24;
        y += 32;
      }
      occupied.add(`${x}:${y}`);
    }
    return { ...node, x, y, vx: 0, vy: 0, pinned: existing?.pinned ?? false };
  });
  return result;
}
