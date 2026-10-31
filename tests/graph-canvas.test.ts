import { afterEach, expect, it, vi } from "vitest";
import { paintGraph, type GraphCanvasState } from "../src/graph/canvas";

// Model the implicit line inserted by arc when a previous subpath is open.
class CheckedPath {
  hasCurrentPoint = false;
  separateStart = false;
  joins = 0;
  arcs = 0;
  moveTo() {
    this.hasCurrentPoint = true;
    this.separateStart = true;
  }
  lineTo() {
    this.hasCurrentPoint = true;
  }
  arc() {
    if (this.hasCurrentPoint && !this.separateStart) this.joins++;
    this.hasCurrentPoint = true;
    this.separateStart = false;
    this.arcs++;
  }
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it("draws separate circles and reads moved nodes on the next canvas frame", () => {
  vi.stubGlobal("Path2D", CheckedPath);
  const canvas = document.createElement("canvas");
  vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, 0, 1000, 700),
  );
  const fill = vi.fn<(path: CheckedPath) => void>();
  const context = {
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    stroke: vi.fn(),
    fill,
  };
  // Only the Canvas API used by this test is needed in jsdom.
  vi.spyOn(canvas, "getContext").mockReturnValue(
    context as unknown as CanvasRenderingContext2D,
  );
  const nodes = [0, 1, 2].map((i) => ({
    path: `${i}`,
    title: `${i}`,
    x: i * 40,
    y: i * 30,
    vx: 0,
    vy: 0,
  }));
  const state: GraphCanvasState = {
    visible: { nodes, edges: [] },
    positions: new Map(nodes.map((n) => [n.path, n])),
    degree: new Map(),
    camera: { x: 0, y: 0, zoom: 1 },
    active: null,
    hover: null,
    labels: false,
    size: 1,
    thickness: 1,
    canvasMode: true,
  };
  paintGraph(canvas, state);
  const paths: CheckedPath[] = fill.mock.calls.map(
    ([path]: [CheckedPath]) => path,
  );
  expect(paths.reduce((sum, p) => sum + p.arcs, 0)).toBe(3);
  expect(paths.every((p) => p.joins === 0)).toBe(true);
  nodes[0].x = 100000;
  fill.mockClear();
  paintGraph(canvas, state);
  expect(
    fill.mock.calls.reduce((sum, [p]: [CheckedPath]) => sum + p.arcs, 0),
  ).toBe(2);
});

it("shows zero Canvas captions before the threshold and wrapped captions after it", () => {
  vi.stubGlobal("Path2D", CheckedPath);
  const canvas = document.createElement("canvas");
  vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, 0, 1000, 700),
  );
  const fillText = vi.fn<(text: string, x: number, y: number) => void>();
  const strokeText = vi.fn<(text: string, x: number, y: number) => void>();
  const ctx = {
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn(),
    fillText,
    strokeText,
  };
  vi.spyOn(canvas, "getContext").mockReturnValue(
    ctx as unknown as CanvasRenderingContext2D,
  );
  const node = {
    path: "A",
    title: "Длинное название заметки для проверки одинакового переноса текста",
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
  };
  const state: GraphCanvasState = {
    visible: { nodes: [node], edges: [] },
    positions: new Map([["A", node]]),
    degree: new Map(),
    camera: { x: 0, y: 0, zoom: 1.999 },
    active: null,
    hover: null,
    labels: true,
    size: 3,
    thickness: 1,
    canvasMode: true,
  };
  paintGraph(canvas, state);
  expect(fillText).not.toHaveBeenCalled();
  state.camera.zoom = 2.001;
  paintGraph(canvas, state);
  const first = structuredClone(fillText.mock.calls);
  expect(first.length).toBeGreaterThan(1);
  expect(strokeText.mock.calls).toEqual(first);
  fillText.mockClear();
  state.camera.zoom = 3;
  paintGraph(canvas, state);
  expect(fillText.mock.calls.map((call) => call[0])).toEqual(
    first.map((call) => call[0]),
  );
});
