export type GraphNode = {
  path: string;
  title: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  pinned?: boolean;
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
export function stepLayout(
  nodes: GraphNode[],
  edges: GraphEdge[],
  forces: Forces,
  pinned?: string,
) {
  const byPath = new Map(nodes.map((n) => [n.path, n]));
  // Aggregate nearby nodes in fixed-size cells instead of comparing every pair.
  const cells = new Map<string, { x: number; y: number; count: number }>();
  for (const n of nodes) {
    const key = Math.floor(n.x / 100) + ":" + Math.floor(n.y / 100);
    const cell = cells.get(key) ?? { x: 0, y: 0, count: 0 };
    cell.x += n.x;
    cell.y += n.y;
    cell.count++;
    cells.set(key, cell);
  }
  for (const n of nodes) {
    const cx = Math.floor(n.x / 100),
      cy = Math.floor(n.y / 100);
    for (let dx = -2; dx <= 2; dx++)
      for (let dy = -2; dy <= 2; dy++) {
        const cell = cells.get(cx + dx + ":" + (cy + dy));
        if (!cell) continue;
        const own = dx === 0 && dy === 0,
          count = cell.count - (own ? 1 : 0);
        if (count <= 0) continue;
        const x = n.x - (cell.x - (own ? n.x : 0)) / count || 0.01,
          y = n.y - (cell.y - (own ? n.y : 0)) / count || 0.01;
        const force = Math.min(
          1,
          (120 * forces.repel * count) / Math.max(100, x * x + y * y),
        );
        n.vx += x * force;
        n.vy += y * force;
      }
  }
  for (const [a, b] of edges) {
    const x = byPath.get(a),
      y = byPath.get(b);
    if (!x || !y) continue;
    const dx = y.x - x.x,
      dy = y.y - x.y,
      d = Math.max(1, Math.hypot(dx, dy));
    const pull = ((d - forces.distance) / d) * forces.strength * 0.025;
    x.vx += dx * pull;
    x.vy += dy * pull;
    y.vx -= dx * pull;
    y.vy -= dy * pull;
  }
  for (const n of nodes) {
    if (n.path === pinned || n.pinned) {
      n.vx = 0;
      n.vy = 0;
      continue;
    }
    n.vx = (n.vx - n.x * forces.center * 0.0006) * 0.75;
    n.vy = (n.vy - n.y * forces.center * 0.0006) * 0.75;
    n.x += Math.max(-12, Math.min(12, n.vx));
    n.y += Math.max(-12, Math.min(12, n.vy));
  }
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
  const result = incoming.map((n, i) => {
    const existing = old.get(n.path) ?? stored.get(n.path);
    return {
      ...n,
      x: existing?.x ?? Math.cos(i * 2.39996) * Math.sqrt(i + 1) * 24,
      y: existing?.y ?? Math.sin(i * 2.39996) * Math.sqrt(i + 1) * 24,
      vx: 0,
      vy: 0,
      pinned: existing?.pinned ?? false,
    };
  });
  const byPath = new Map(result.map((n) => [n.path, n]));
  for (const [a, b] of edges) {
    const fresh =
      !old.has(a) && !stored.has(a)
        ? byPath.get(a)
        : !old.has(b) && !stored.has(b)
          ? byPath.get(b)
          : undefined;
    const anchor = fresh?.path === a ? old.get(b) : old.get(a);
    if (fresh && anchor) {
      fresh.x = anchor.x + 32;
      fresh.y = anchor.y + 24;
    }
  }
  return result;
}
export function graphLabels(
  nodes: GraphNode[],
  zoom: number,
  hovered: string | null,
): Set<string> {
  const cells = new Set<string>(),
    result = new Set<string>();
  for (const n of nodes) {
    const cell =
      Math.floor((n.x * zoom) / 100) + ":" + Math.floor((n.y * zoom) / 24);
    if (n.path === hovered || (zoom >= 0.45 && !cells.has(cell))) {
      result.add(n.path);
      cells.add(cell);
    }
  }
  return result;
}
