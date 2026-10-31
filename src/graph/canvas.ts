import {
  layoutGraphLabels,
  graphLabelBounds,
  graphLabelOpacity,
  graphLabelFont,
  GRAPH_LABEL_LINE_HEIGHT,
  type GraphLabel,
} from "./labels";
import { graphNodeRadius, type GraphNode, type GraphEdge } from "./model";

export interface GraphCanvasState {
  visible: { nodes: GraphNode[]; edges: GraphEdge[] };
  positions: Map<string, GraphNode>;
  degree: Map<string, number>;
  camera: { x: number; y: number; zoom: number };
  active: string | null;
  hover: string | null;
  labels: boolean;
  size: number;
  thickness: number;
  canvasMode: boolean;
}

/** Draw from current mutable node positions without a React render per frame. */
export function paintGraph(
  element: HTMLCanvasElement,
  state: GraphCanvasState,
): void {
  const rect = element.getBoundingClientRect(),
    ratio = Math.min(2, window.devicePixelRatio || 1),
    width = Math.round(rect.width * ratio),
    height = Math.round(rect.height * ratio);
  if (!width || !height) return;
  if (element.width !== width || element.height !== height) {
    element.width = width;
    element.height = height;
  }
  const ctx = element.getContext("2d");
  if (!ctx) return;
  const {
      visible,
      positions,
      degree,
      camera,
      active,
      hover,
      labels,
      size,
      thickness,
    } = state,
    theme = getComputedStyle(document.documentElement),
    color = (name: string) => theme.getPropertyValue(name).trim(),
    baseScale = Math.min(rect.width / 1000, rect.height / 700) * ratio,
    scale = baseScale * camera.zoom,
    translateX = width / 2 + camera.x * baseScale,
    translateY = height / 2 + camera.y * baseScale;
  if (!Number.isFinite(scale) || scale <= 0) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.setTransform(scale, 0, 0, scale, translateX, translateY);
  const left = (-80 - translateX) / scale,
    right = (width + 80 - translateX) / scale,
    top = (-80 - translateY) / scale,
    bottom = (height + 80 - translateY) / scale,
    highlighted = new Set(hover ? [hover] : []);
  for (const [a, b] of visible.edges) {
    if (a === hover) highlighted.add(b);
    if (b === hover) highlighted.add(a);
  }
  const shownLabels = labels
      ? layoutGraphLabels(
          // Captions are at most 120 × 42 CSS pixels; include a margin for
          // labels whose node is just outside the viewport.
          visible.nodes.filter((n) => {
            const margin = 160 / (scale / ratio) + 60 * size;
            return (
              n.x >= left - margin &&
              n.x <= right + margin &&
              n.y >= top - margin &&
              n.y <= bottom + margin
            );
          }),
          degree,
          size,
          scale / ratio,
        )
      : new Map<string, GraphLabel>(),
    normalEdges = new Path2D(),
    dimEdges = new Path2D(),
    highlightedEdges = new Path2D();
  for (const [a, b] of visible.edges) {
    const x = positions.get(a),
      y = positions.get(b);
    if (
      !x ||
      !y ||
      Math.max(x.x, y.x) < left - 100 ||
      Math.min(x.x, y.x) > right + 100 ||
      Math.max(x.y, y.y) < top - 100 ||
      Math.min(x.y, y.y) > bottom + 100
    )
      continue;
    const target = hover
      ? a === hover || b === hover
        ? highlightedEdges
        : dimEdges
      : normalEdges;
    target.moveTo(x.x, x.y);
    target.lineTo(y.x, y.y);
  }
  ctx.lineWidth = (0.7 * thickness) / (scale / ratio);
  ctx.lineCap = "round";
  if (hover) {
    ctx.globalAlpha = 0.08;
    ctx.strokeStyle = color("--subtle");
    ctx.stroke(dimEdges);
    ctx.globalAlpha = 0.8;
    ctx.strokeStyle = color("--accent");
    ctx.stroke(highlightedEdges);
  } else {
    ctx.globalAlpha = 0.3;
    ctx.strokeStyle = color("--subtle");
    ctx.stroke(normalEdges);
  }
  const normalNodes = new Path2D(),
    dimNodes = new Path2D(),
    highlightedNodes = new Path2D();
  for (const n of visible.nodes) {
    const r = graphNodeRadius(n.path, degree, size);
    if (n.x + r < left || n.x - r > right || n.y + r < top || n.y - r > bottom)
      continue;
    const target =
      n.path === active || n.path === hover
        ? highlightedNodes
        : hover && !highlighted.has(n.path)
          ? dimNodes
          : normalNodes;
    target.moveTo(n.x + r, n.y);
    target.arc(n.x, n.y, r, 0, Math.PI * 2);
  }
  ctx.globalAlpha = hover ? 0.12 : 1;
  ctx.fillStyle = color("--muted");
  ctx.fill(dimNodes);
  ctx.globalAlpha = 1;
  ctx.fill(normalNodes);
  ctx.fillStyle = color("--accent");
  ctx.fill(highlightedNodes);
  if (shownLabels.size) {
    const labelOpacity = graphLabelOpacity(scale / ratio);
    ctx.fillStyle = color("--text");
    ctx.font = graphLabelFont(scale / ratio);
    ctx.strokeStyle = color("--base");
    ctx.lineWidth = 3 / (scale / ratio);
    ctx.lineJoin = "round";
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    for (const n of visible.nodes) {
      if (!shownLabels.has(n.path)) continue;
      const label = shownLabels.get(n.path);
      if (!label) continue;
      const box = graphLabelBounds(n, label);
      if (
        box.right < left ||
        box.left > right ||
        box.bottom < top ||
        box.top > bottom
      )
        continue;
      ctx.globalAlpha =
        labelOpacity * (hover && !highlighted.has(n.path) ? 0.12 : 1);
      label.lines.forEach((line: string, index: number) => {
        const x = n.x + label.x,
          y =
            n.y + label.y + (index * GRAPH_LABEL_LINE_HEIGHT) / (scale / ratio);
        ctx.strokeText(line, x, y);
        ctx.fillText(line, x, y);
      });
    }
  }
  ctx.globalAlpha = 1;
}
