import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { GraphSimulation } from "../src/graph/simulation";
import { KnowledgeGraph } from "../src/components/KnowledgeGraph";
import {
  defaultGraphView,
  writeGraphView,
} from "../src/workspace/graphStorage";

const mocks = vi.hoisted(() => ({ graph: vi.fn(), paint: vi.fn() }));
vi.mock("../src/services/api", () => ({
  api: { graph: mocks.graph },
  errorMessage: String,
}));
vi.mock("../src/graph/canvas", () => ({ paintGraph: mocks.paint }));
const frames = new Map<number, FrameRequestCallback>();
let nextFrame = 0;
const props = {
  vaultId: "graph-test",
  revision: 1,
  active: "A.md",
  onOpen: vi.fn(),
  onClose: vi.fn(),
};
beforeEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.theme;
  vi.clearAllMocks();
  frames.clear();
  nextFrame = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  writeGraphView(props.vaultId, {
    ...defaultGraphView(),
    positions: [["A.md", 120, 60, false]],
  });
  mocks.graph.mockResolvedValue({
    nodes: [{ path: "A.md", title: "A" }],
    edges: [],
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("centers the root again after leaving local mode and panning", async () => {
  const { container } = render(<KnowledgeGraph {...props} />);
  await waitFor(() =>
    expect(container.querySelector('[data-node="A.md"]')).toBeTruthy(),
  );
  const local = screen.getByRole("checkbox", { name: "Локальный граф" });
  fireEvent.click(local);
  const transform = () =>
    container.querySelector("svg > g")?.getAttribute("transform");
  expect(transform()).toContain("translate(-120,-60)");
  fireEvent.click(local);
  fireEvent.keyDown(screen.getByLabelText("Полотно графа"), {
    key: "ArrowRight",
  });
  expect(transform()).not.toContain("translate(-120,-60)");
  fireEvent.click(local);
  expect(transform()).toContain("translate(-120,-60)");
});

it("schedules layout only while moving and cancels pending work when hidden", async () => {
  const { container, rerender } = render(<KnowledgeGraph {...props} />);
  await waitFor(() =>
    expect(container.querySelector('[data-node="A.md"]')).toBeTruthy(),
  );
  expect(frames.size).toBe(0);
  fireEvent.change(screen.getByRole("slider", { name: "Сила центра" }), {
    target: { value: "1" },
  });
  expect(frames.size).toBe(1);
  rerender(<KnowledgeGraph {...props} visible={false} />);
  expect(frames.size).toBe(0);
  rerender(<KnowledgeGraph {...props} />);
  expect(frames.size).toBe(1);
  for (let i = 1; i <= 400 && frames.size; i++) {
    await act(async () => {
      const pending = [...frames.values()];
      frames.clear();
      pending.forEach((callback) => callback(i * 40));
    });
  }
  expect(frames.size).toBe(0);
});

it("repaints a settled canvas when the theme changes", async () => {
  mocks.graph.mockResolvedValue({
    nodes: Array.from({ length: 801 }, (_, i) => ({
      path: `N${i}.md`,
      title: `${i}`,
    })),
    edges: [],
  });
  render(<KnowledgeGraph {...props} />);
  await waitFor(() => expect(mocks.paint).toHaveBeenCalled());
  mocks.paint.mockClear();
  await act(async () => {
    document.documentElement.dataset.theme = "light";
  });
  await waitFor(() => expect(mocks.paint).toHaveBeenCalled());
  delete document.documentElement.dataset.theme;
});

it("does not publish a stale warmup after the graph revision changes", async () => {
  localStorage.clear();
  mocks.graph.mockResolvedValueOnce({
    nodes: Array.from({ length: 1000 }, (_, i) => ({
      path: `old${i}.md`,
      title: `Old ${i}`,
    })),
    edges: [],
  });
  const { rerender } = render(<KnowledgeGraph {...props} />);
  await waitFor(() => expect(mocks.graph).toHaveBeenCalledOnce());
  mocks.graph.mockResolvedValue({
    nodes: [{ path: "new.md", title: "New" }],
    edges: [],
  });
  rerender(<KnowledgeGraph {...props} revision={2} />);
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "new.md" })).toBeTruthy(),
  );
  expect(screen.queryByRole("button", { name: "old0.md" })).toBeNull();
});

it("does not persist a pin on drag and releases temporary locks when the pointer is cancelled", async () => {
  const { container } = render(<KnowledgeGraph {...props} />);
  const node = await screen.findByRole("button", { name: "A.md" });
  const svg = container.querySelector('svg[aria-label="Полотно графа"]')!;
  vi.stubGlobal("PointerEvent", MouseEvent);
  vi.stubGlobal(
    "DOMPoint",
    class {
      constructor(
        public x: number,
        public y: number,
      ) {}
      matrixTransform() {
        return { x: this.x, y: this.y };
      }
    },
  );
  Object.defineProperties(svg, {
    getScreenCTM: { value: () => ({ inverse: () => ({}) }) },
    setPointerCapture: { value: vi.fn() },
    hasPointerCapture: { value: () => false },
  });
  const reheat = vi.spyOn(GraphSimulation.prototype, "reheat");
  fireEvent.pointerDown(node, { button: 0, clientX: 120, clientY: 60 });
  fireEvent.pointerMove(svg, { clientX: 300, clientY: 120 });
  expect(node.getAttribute("data-pinned")).toBeNull();
  expect(node.getAttribute("transform")).toBe("translate(300,120)");
  fireEvent.pointerMove(svg, { clientX: 310, clientY: 125 });
  fireEvent.pointerCancel(svg);
  expect(reheat).toHaveBeenCalledTimes(1);
  reheat.mockRestore();
  for (let i = 1; i <= 400 && frames.size; i++)
    await act(async () => {
      const pending = [...frames.values()];
      frames.clear();
      pending.forEach((callback) => callback(i * 40));
    });
  expect(frames.size).toBe(0);
  expect(node.getAttribute("data-pinned")).toBeNull();
  expect(node.getAttribute("transform")).not.toBe("translate(300,120)");
});

it("fades SVG captions in with zoom and keeps them hidden below the threshold", async () => {
  mocks.graph.mockResolvedValue({
    nodes: ["A.md", "B.md", "C.md"].map((path) => ({ path, title: path })),
    edges: [],
  });
  writeGraphView(props.vaultId, {
    ...defaultGraphView(),
    camera: { x: 0, y: 0, zoom: 1.1 },
    positions: [
      ["A.md", -60, 0, false],
      ["B.md", 0, 0, false],
      ["C.md", 60, 0, false],
    ],
  });
  const { container } = render(<KnowledgeGraph {...props} />);
  await screen.findByRole("button", { name: "A.md" });
  expect(container.querySelectorAll(".graph-node text")).toHaveLength(0);
  expect(container.querySelectorAll(".graph-node title")).toHaveLength(0);
  fireEvent.pointerEnter(screen.getByRole("button", { name: "A.md" }));
  expect(container.querySelectorAll(".graph-node text")).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "Приблизить" }));
  expect(container.querySelectorAll(".graph-node text")).toHaveLength(3);
  const opacity = Number(
    container.querySelector<SVGTextElement>(".graph-node text")?.style.opacity,
  );
  expect(opacity).toBeGreaterThan(0);
  expect(opacity).toBeLessThan(1);
  for (let i = 0; i < 6; i++)
    fireEvent.click(screen.getByRole("button", { name: "Приблизить" }));
  expect(container.querySelectorAll(".graph-node text")).toHaveLength(3);
  for (let i = 0; i < 10; i++)
    fireEvent.click(screen.getByRole("button", { name: "Отдалить" }));
  expect(container.querySelectorAll(".graph-node text")).toHaveLength(0);
});

it("does not reselect hovered labels as nodes pass under the pointer during wheel zoom", async () => {
  mocks.graph.mockResolvedValue({
    nodes: [
      { path: "A.md", title: "A" },
      { path: "B.md", title: "B" },
    ],
    edges: [],
  });
  writeGraphView(props.vaultId, {
    ...defaultGraphView(),
    positions: [
      ["A.md", 0, 0, false],
      ["B.md", 100, 0, false],
    ],
  });
  const { container } = render(<KnowledgeGraph {...props} />);
  await screen.findByRole("button", { name: "A.md" });
  const svg = container.querySelector('svg[aria-label="Полотно графа"]')!;
  Object.defineProperty(svg, "getScreenCTM", { value: () => null });
  const clock = vi.spyOn(performance, "now").mockReturnValue(100);
  try {
    fireEvent.wheel(svg, { deltaY: -10 });
    clock.mockReturnValue(110);
    fireEvent.pointerEnter(screen.getByRole("button", { name: "A.md" }));
    expect(container.querySelectorAll(".graph-node.is-dimmed").length).toBe(0);
    clock.mockReturnValue(500);
    fireEvent.pointerEnter(screen.getByRole("button", { name: "A.md" }));
    expect(container.querySelectorAll(".graph-node.is-dimmed").length).toBe(1);
  } finally {
    clock.mockRestore();
  }
});

it("does not focus the canvas when restoring a graph at startup", async () => {
  document.body.focus();
  render(<KnowledgeGraph {...props} />);
  await screen.findByRole("button", { name: "A.md" });
  expect(document.activeElement).not.toBe(
    screen.getByLabelText("Полотно графа"),
  );
});
