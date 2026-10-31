import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCollide,
  forceX,
  forceY,
  type Simulation,
  type ForceLink,
  type SimulationLinkDatum,
} from "d3-force";
import {
  graphNodeRadius,
  type Forces,
  type GraphNode,
  type GraphEdge,
} from "./model";
import { layoutEdges } from "./communities";

/** D3 owns physics; the workspace owns scheduling and persistent positions.
 * Its timer stays stopped, so hidden/unmounted graphs cannot keep running. */
export class GraphSimulation {
  private readonly simulation: Simulation<GraphNode, undefined>;
  private readonly nodesByPath: Map<string, GraphNode>;
  private readonly degree = new Map<string, number>();
  private readonly links: { source: string; target: string }[];
  private dragging: GraphNode | undefined;
  private linkForce:
    ForceLink<GraphNode, SimulationLinkDatum<GraphNode>> | undefined;
  private disposed = false;

  constructor(
    private readonly nodes: GraphNode[],
    edges: GraphEdge[],
    forces: Forces,
    size = 1,
  ) {
    this.nodesByPath = new Map(nodes.map((node) => [node.path, node]));
    this.links = layoutEdges(nodes, edges).map(([source, target]) => {
      this.degree.set(source, (this.degree.get(source) ?? 0) + 1);
      this.degree.set(target, (this.degree.get(target) ?? 0) + 1);
      return { source, target };
    });
    for (const node of nodes) {
      node.fx = node.pinned ? node.x : null;
      node.fy = node.pinned ? node.y : null;
    }
    this.simulation = forceSimulation(nodes)
      .stop()
      .alphaDecay(0.025)
      .velocityDecay(0.4);
    this.configure(forces, size);
    // Restoring a saved view must not silently rearrange it.
    this.simulation.alpha(0);
  }

  configure(forces: Forces, size: number): void {
    const degree = (path: string) => Math.max(1, this.degree.get(path) ?? 0);
    const pathOf = (node: string | number | GraphNode) =>
      typeof node === "object" ? node.path : String(node);
    const linkDegree = (link: SimulationLinkDatum<GraphNode>) =>
      Math.max(degree(pathOf(link.source)), degree(pathOf(link.target)));
    this.linkForce = forceLink<GraphNode, SimulationLinkDatum<GraphNode>>(
      this.links.map((link) => ({ ...link })),
    )
      .id((node) => node.path)
      // A high-degree hub needs a larger neighbourhood to fit its notes.
      .distance(
        (link) =>
          forces.distance *
          Math.min(3, Math.max(1, Math.sqrt(linkDegree(link)) / 3)),
      )
      .strength(
        (link) =>
          forces.strength /
          (this.dragging &&
          (pathOf(link.source) === this.dragging.path ||
            pathOf(link.target) === this.dragging.path)
            ? 1
            : Math.min(
                degree(pathOf(link.source)),
                degree(pathOf(link.target)),
              )),
      );
    this.simulation
      .force("links", this.linkForce)
      .force(
        "charge",
        forceManyBody<GraphNode>()
          .strength(-40 * forces.repel)
          .distanceMin(24)
          .theta(0.9),
      )
      .force(
        "collisions",
        forceCollide<GraphNode>()
          .radius((node) =>
            Math.max(
              35 * Math.sqrt(size),
              graphNodeRadius(node.path, this.degree, size) + 12,
            ),
          )
          .strength(1)
          .iterations(3),
      )
      .force("x", forceX<GraphNode>(0).strength(forces.center * 0.015))
      .force("y", forceY<GraphNode>(0).strength(forces.center * 0.015))
      .force("disc", (alpha: number) => {
        // A soft circular envelope, never a ring or a hard restriction on dragging.
        if (this.dragging) return;
        const radius =
          Math.max(160, 42 * Math.sqrt(this.nodes.length)) * Math.sqrt(size);
        for (const node of this.nodes) {
          if (node.pinned) continue;
          const distance = Math.hypot(node.x, node.y);
          if (distance <= radius) continue;
          const correction = (distance - radius) * 0.25 * alpha;
          node.vx -= (node.x / distance) * correction;
          node.vy -= (node.y / distance) * correction;
        }
      });
  }
  reheat(alpha = 0.45): void {
    if (this.disposed) return;
    this.simulation.alpha(Math.max(alpha, this.simulation.alpha()));
  }
  get running(): boolean {
    return (
      !this.disposed &&
      (!!this.dragging || this.simulation.alpha() >= this.simulation.alphaMin())
    );
  }
  tick(): void {
    if (!this.disposed) this.simulation.tick();
  }
  beginDrag(path: string): void {
    this.endDrag();
    this.dragging = this.nodesByPath.get(path);
    if (!this.dragging) return;
    this.dragging.fx = this.dragging.x;
    this.dragging.fy = this.dragging.y;
    // Keep neighbors responsive without restarting a full layout on touch.
    // Recompute cached strengths only at drag boundaries. Incident links
    // respond directly even when both ends belong to dense communities.
    if (this.linkForce) this.linkForce.strength(this.linkForce.strength());
    this.simulation.alphaTarget(0.2);
    this.reheat(0.2);
  }
  moveDrag(x: number, y: number): void {
    if (!this.dragging) return;
    this.dragging.x = this.dragging.fx = x;
    this.dragging.y = this.dragging.fy = y;
    this.dragging.vx = this.dragging.vy = 0;
  }
  endDrag(): void {
    if (this.dragging) {
      this.dragging.fx = this.dragging.pinned ? this.dragging.x : null;
      this.dragging.fy = this.dragging.pinned ? this.dragging.y : null;
      this.dragging = undefined;
      if (this.linkForce) this.linkForce.strength(this.linkForce.strength());
    }
    this.simulation.alphaTarget(0);
  }
  setPinned(path: string, pinned: boolean): void {
    const node = this.nodesByPath.get(path);
    if (!node) return;
    node.pinned = pinned;
    node.fx = pinned ? node.x : null;
    node.fy = pinned ? node.y : null;
    this.reheat();
  }
  dispose(): void {
    this.endDrag();
    this.simulation.stop().alpha(0);
    this.disposed = true;
  }
}
