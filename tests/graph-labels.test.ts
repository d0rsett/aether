import { expect, it } from "vitest";
import {
  layoutGraphLabels,
  graphLabelOpacity,
  GRAPH_LABEL_MIN_SCALE,
  GRAPH_LABEL_FULL_SCALE,
} from "../src/graph/labels";
import { graphNodeRadius, type GraphNode } from "../src/graph/model";
const node = (path: string, x = 0, y = 0, title = path): GraphNode => ({
  path,
  title,
  x,
  y,
  vx: 0,
  vy: 0,
});
const measure = (text: string) => text.length * 7;
it("shows no captions below one threshold and a caption for EVERY note above it", () => {
  const nodes = Array.from({ length: 1000 }, (_, i) => node(`N${i}`, 0, 0));
  expect(
    layoutGraphLabels(
      nodes,
      new Map(),
      1,
      GRAPH_LABEL_MIN_SCALE - 0.001,
      measure,
    ).size,
  ).toBe(0);
  const above = layoutGraphLabels(
    nodes,
    new Map(),
    1,
    GRAPH_LABEL_MIN_SCALE + 0.001,
    measure,
  );
  expect(above.size).toBe(nodes.length);
  expect(nodes.every((n) => above.has(n.path))).toBe(true);
  expect(graphLabelOpacity(GRAPH_LABEL_MIN_SCALE - 0.001)).toBe(0);
  expect(graphLabelOpacity(GRAPH_LABEL_MIN_SCALE)).toBe(0);
  expect(
    graphLabelOpacity((GRAPH_LABEL_MIN_SCALE + GRAPH_LABEL_FULL_SCALE) / 2),
  ).toBeCloseTo(0.5);
  expect(graphLabelOpacity(GRAPH_LABEL_FULL_SCALE)).toBe(1);
});
it("wraps all captions below their own node and keeps text a constant projected size", () => {
  const nodes = [
    node(
      "A",
      0,
      0,
      "Очень длинное название заметки для проверки одинакового текста",
    ),
    node("B", 0, 0, "W".repeat(100)),
  ];
  const first = layoutGraphLabels(nodes, new Map(), 1, 2, measure);
  const second = layoutGraphLabels(nodes, new Map(), 1, 4, measure);
  for (const n of nodes) {
    const a = first.get(n.path)!,
      b = second.get(n.path)!;
    expect(a.lines.length).toBeGreaterThan(1);
    expect(a.lines.length).toBeLessThanOrEqual(3);
    expect(a.lines).toEqual(b.lines);
    expect(a.x).toBe(0);
    expect(a.y).toBeGreaterThan(0);
    expect(a.width * 2).toBeCloseTo(b.width * 4);
    expect(a.height * 2).toBeCloseTo(b.height * 4);
    const radius = graphNodeRadius(n.path, new Map(), 1);
    expect((a.y - radius) * 2).toBeCloseTo((b.y - radius) * 4);
    expect((a.y - radius) * 2).toBeCloseTo(14);
    expect(a.lines.every((line) => measure(line) <= 120)).toBe(true);
  }
});
it("never drops a caption because its title is blank or another caption occupies the same place", () => {
  const nodes = [node("A"), node("B", 0, 0, ""), node("C")];
  const labels = layoutGraphLabels(nodes, new Map(), 1, 2, measure);
  expect(labels.size).toBe(3);
  expect(labels.get("B")?.lines).toEqual(["B"]);
});
