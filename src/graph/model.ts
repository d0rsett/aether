export type GraphNode = {
  path: string;
  title: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
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
  // Sample distant nodes for large vaults so each animation frame stays bounded.
  const stride = Math.max(1, Math.ceil(nodes.length / 80));
  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[i];
    for (let j = i + 1; j < nodes.length; j += stride) {
      const b = nodes[j],
        dx = a.x - b.x || 0.01,
        dy = a.y - b.y || 0.01;
      const force = Math.min(
        1,
        (120 * forces.repel) / Math.max(100, dx * dx + dy * dy),
      );
      a.vx += dx * force;
      a.vy += dy * force;
      b.vx -= dx * force;
      b.vy -= dy * force;
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
    if (n.path === pinned) {
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
