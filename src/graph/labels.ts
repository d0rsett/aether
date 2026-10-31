import { graphNodeRadius, type GraphNode } from "./model";

export const GRAPH_LABEL_FONT =
  '11px "Segoe UI", -apple-system, BlinkMacSystemFont, sans-serif';
export const GRAPH_LABEL_LINE_HEIGHT = 14;
export interface GraphLabel {
  lines: string[];
  x: number;
  y: number;
  width: number;
  height: number;
  fontScale: number;
}
interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}
type MeasureText = (text: string) => number;
let context: CanvasRenderingContext2D | null | undefined;
const widths = new Map<string, number>();
export function measureGraphText(text: string): number {
  if (context === undefined) {
    context =
      typeof CanvasRenderingContext2D === "undefined"
        ? null
        : document.createElement("canvas").getContext("2d");
    if (context) context.font = GRAPH_LABEL_FONT;
  }
  const cached = widths.get(text);
  if (cached !== undefined) return cached;
  const width = context ? context.measureText(text).width : text.length * 7;
  if (widths.size >= 4096) widths.clear();
  widths.set(text, width);
  return width;
}

function wrapLabel(title: string, measure: MeasureText): string[] {
  const lines: string[] = [];
  let line = "";
  // A title can be one long word; split by characters when necessary.
  for (const word of title.slice(0, 512).trim().split(/\s+/)) {
    if (line && measure(`${line} ${word}`) <= 120) {
      line += ` ${word}`;
      continue;
    }
    if (line) {
      lines.push(line);
      line = "";
    }
    for (const character of word) {
      if (line && measure(line + character) > 120) {
        lines.push(line);
        line = "";
      }
      line += character;
    }
  }
  if (line) lines.push(line);
  if (lines.length <= 3) return lines;
  let last = lines[2];
  while (last && measure(last + "…") > 120)
    last = Array.from(last).slice(0, -1).join("");
  return [lines[0], lines[1], last + "…"];
}

const preparedTitles = new Map<
  string,
  Pick<GraphLabel, "lines" | "width" | "height">
>();
function prepareTitle(title: string, measure: MeasureText) {
  const cached =
    measure === measureGraphText ? preparedTitles.get(title) : undefined;
  if (cached) return cached;
  const lines = wrapLabel(title, measure);
  const prepared = {
    lines,
    width: Math.max(0, ...lines.map(measure)),
    height: lines.length * GRAPH_LABEL_LINE_HEIGHT,
  };
  if (measure === measureGraphText) {
    if (preparedTitles.size >= 20000) {
      const oldest = preparedTitles.keys().next().value;
      if (oldest !== undefined) preparedTitles.delete(oldest);
    }
    preparedTitles.set(title, prepared);
  }
  return prepared;
}

export function graphLabelBounds(
  node: Pick<GraphNode, "x" | "y">,
  label: GraphLabel,
): Box {
  return {
    left: node.x + label.x - label.width / 2 - 4 * label.fontScale,
    right: node.x + label.x + label.width / 2 + 4 * label.fontScale,
    top: node.y + label.y - 14 * label.fontScale,
    bottom: node.y + label.y + label.height - 8 * label.fontScale,
  };
}

// One global threshold in projected pixels per graph unit, shared by both renderers.
export const GRAPH_LABEL_MIN_SCALE = 2;
export function graphLabelOpacity(scale: number): 0 | 1 {
  return scale >= GRAPH_LABEL_MIN_SCALE ? 1 : 0;
}
export function graphLabelFont(scale: number): string {
  return GRAPH_LABEL_FONT.replace("11px", `${11 / scale}px`);
}

/** Every note has a caption above the threshold. No priority, occupancy or
 * hover-based filtering. Text stays a constant screen size as nodes spread. */
export function layoutGraphLabels(
  nodes: GraphNode[],
  degree: Map<string, number>,
  size: number,
  scale: number,
  measure: MeasureText = measureGraphText,
): Map<string, GraphLabel> {
  const result = new Map<string, GraphLabel>();
  if (!graphLabelOpacity(scale)) return result;
  const fontScale = 1 / scale;
  for (const node of nodes) {
    const prepared = prepareTitle(node.title || node.path, measure);
    const r = graphNodeRadius(node.path, degree, size);
    result.set(node.path, {
      lines: prepared.lines,
      x: 0,
      y: Math.max(18 * size, r + 4) + 12 * fontScale,
      width: prepared.width * fontScale,
      height: prepared.height * fontScale,
      fontScale,
    });
  }
  return result;
}
