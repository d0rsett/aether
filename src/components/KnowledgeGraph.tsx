import type { MouseEvent as ReactMouseEvent } from "react";
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Search,
  RotateCcw,
  ChevronRight,
  Waypoints,
  Settings2,
  X,
  Maximize,
  Plus,
  Minus,
} from "lucide-react";
import { useContextMenu } from "./ContextMenu";
import { readGraphView, writeGraphView } from "../workspace/graphStorage";
import { api, errorMessage } from "../services/api";
import { t, useLocale } from "../i18n";
import {
  defaultForces,
  mergeGraphNodes,
  graphNodeRadius,
  fitGraphCamera,
  initialGraphLayout,
  filterGraph,
  type GraphNode,
  type GraphEdge,
} from "../graph/model";
import "../styles/graph.css";
import {
  layoutGraphLabels,
  graphLabelBounds,
  graphLabelOpacity,
  GRAPH_LABEL_LINE_HEIGHT,
  type GraphLabel,
} from "../graph/labels";
import { layoutEdges } from "../graph/communities";
import { GraphSimulation } from "../graph/simulation";
import { paintGraph } from "../graph/canvas";

export function KnowledgeGraph({
  vaultId,
  revision,
  active,
  onOpen,
  onClose,
  onOpenBackground,
  visible: isVisible = true,
  indexRunning = false,
}: {
  vaultId: string;
  revision: number;
  active?: string;
  onOpen: (path: string) => void;
  onClose: () => void;
  onOpenBackground?: (path: string) => void;
  visible?: boolean;
  indexRunning?: boolean;
}) {
  useLocale();
  const [initial] = useState(() => readGraphView(vaultId));
  const [persistenceError, setPersistenceError] = useState("");
  const context = useContextMenu(setPersistenceError);
  const nodesRef = useRef<GraphNode[]>([]);
  const loaded = useRef(false);
  const [data, setData] = useState<{
    nodes: GraphNode[];
    edges: GraphEdge[];
  } | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState(initial.query);
  const [local, setLocal] = useState(initial.local);
  const [depth, setDepth] = useState(initial.depth);
  const [orphans, setOrphans] = useState(initial.orphans);
  const [labels, setLabels] = useState(initial.labels);
  const [size, setSize] = useState(initial.size);
  const [thickness, setThickness] = useState(initial.thickness);
  const [forces, setForces] = useState(initial.forces);
  const [settings, setSettings] = useState(initial.settings);
  const [camera, setCamera] = useState(initial.camera);
  const [root, setRoot] = useState(initial.root);
  const [hover, setHover] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [, redraw] = useState(0);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [viewportScale, setViewportScale] = useState(1);
  const svg = useRef<SVGSVGElement>(null);
  const zoomingUntil = useRef(0);
  const drag = useRef<{
    id: number;
    path?: string;
    x: number;
    y: number;
    moved: boolean;
  } | null>(null);
  useLayoutEffect(() => {
    const element = svg.current;
    if (!element) return;
    const measure = () => {
      const rect = element.getBoundingClientRect();
      if (rect.width && rect.height)
        setViewportScale(Math.min(rect.width / 1000, rect.height / 700));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const opener = document.activeElement;
    svg.current?.focus();
    return () => {
      if (opener instanceof HTMLElement && opener.isConnected)
        opener.focus({ preventScroll: true });
    };
  }, []);
  const simulationRef = useRef<GraphSimulation | null>(null);
  const needsLayout = useRef(false);
  const scheduleLayout = useRef<(() => void) | null>(null);
  const wake = () => {
    simulationRef.current?.reheat();
    scheduleLayout.current?.();
  };
  useEffect(() => {
    if (indexRunning) return;
    let cancelled = false;
    setError("");
    void api
      .graph(vaultId)
      .then(async (snapshot) => {
        if (cancelled) return;
        const edges = layoutEdges(snapshot.nodes, snapshot.edges);
        const nodes = mergeGraphNodes(
          snapshot.nodes,
          nodesRef.current,
          edges,
          initial.positions,
        );
        const first = !loaded.current;
        if (first && !initial.positions.length) {
          const warmup = new GraphSimulation(
            nodes,
            edges,
            initial.forces,
            initial.size,
          );
          try {
            warmup.reheat(1);
            for (let i = 0; i < 80; i++) {
              if (cancelled) return;
              warmup.tick();
              if (i % 2 === 1 && i < 79)
                await new Promise<void>((resolve) =>
                  window.setTimeout(resolve, 0),
                );
            }
          } finally {
            warmup.dispose();
          }
        }

        if (cancelled) return;
        needsLayout.current = !first || !initial.positions.length;
        nodesRef.current = nodes;
        if (first && !initial.positions.length && !initial.local)
          setCamera(fitGraphCamera(nodes));
        loaded.current = true;
        setData({ nodes, edges });
      })
      .catch((e) => {
        if (!cancelled) setError(errorMessage(e));
      });
    return () => {
      cancelled = true;
    };
  }, [vaultId, revision, retry, initial, indexRunning]);
  const stateRef = useRef({
    query,
    local,
    root,
    depth,
    orphans,
    labels,
    size,
    thickness,
    forces,
    settings,
    camera,
  });
  stateRef.current = {
    query,
    local,
    root,
    depth,
    orphans,
    labels,
    size,
    thickness,
    forces,
    settings,
    camera,
  };
  const dirty = useRef(false);
  useEffect(() => {
    dirty.current = true;
  }, [
    query,
    local,
    root,
    depth,
    orphans,
    labels,
    size,
    thickness,
    forces,
    settings,
    camera,
    data,
  ]);
  useEffect(() => {
    const save = () => {
      if (!loaded.current || !dirty.current) return;
      try {
        writeGraphView(vaultId, {
          ...stateRef.current,
          positions: nodesRef.current.map((n) => [
            n.path,
            n.x,
            n.y,
            n.pinned === true,
          ]),
        });
        dirty.current = false;
        setPersistenceError("");
      } catch {
        setPersistenceError(
          t(
            "Не удалось сохранить настройки графа. Освободите место в локальном хранилище.",
          ),
        );
      }
    };
    const timer = window.setInterval(save, 1000);
    const leave = () => save();
    window.addEventListener("pagehide", leave);
    window.addEventListener("beforeunload", leave);
    document.addEventListener("visibilitychange", leave);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("pagehide", leave);
      window.removeEventListener("beforeunload", leave);
      document.removeEventListener("visibilitychange", leave);
      save();
    };
  }, [vaultId]);
  const visible = useMemo(
    () =>
      filterGraph(
        data?.nodes ?? [],
        data?.edges ?? [],
        query,
        local ? (root ?? active) : undefined,
        depth,
        orphans,
      ),
    [data, query, local, root, active, depth, orphans],
  );
  const canvasMode = visible.nodes.length > 800;
  const isVisibleRef = useRef(isVisible);
  isVisibleRef.current = isVisible;
  const canvasStateRef = useRef({
    visible,
    positions: new Map<string, GraphNode>(),
    degree: new Map<string, number>(),
    camera,
    active: active ?? null,
    hover,
    labels,
    size,
    thickness,
    canvasMode,
  });
  const positions = useMemo(
    () => new Map(visible.nodes.map((n) => [n.path, n])),
    [visible],
  );
  const degree = useMemo(() => {
    const result = new Map<string, number>();
    for (const [a, b] of visible.edges) {
      result.set(a, (result.get(a) ?? 0) + 1);
      result.set(b, (result.get(b) ?? 0) + 1);
    }
    return result;
  }, [visible]);
  const highlighted = new Set(hover ? [hover] : []);
  for (const [a, b] of visible.edges) {
    if (a === hover) highlighted.add(b);
    if (b === hover) highlighted.add(a);
  }
  const shownLabels =
    canvasMode || !labels
      ? new Map<string, GraphLabel>()
      : layoutGraphLabels(
          visible.nodes,
          degree,
          size,
          viewportScale * camera.zoom,
        );
  const inView = (n: GraphNode) =>
    Math.abs(n.x * camera.zoom + camera.x) < 600 &&
    Math.abs(n.y * camera.zoom + camera.y) < 400;
  const rendered = visible.nodes.filter((node) => {
    if (inView(node)) return true;
    const label = shownLabels.get(node.path);
    if (!label) return false;
    const box = graphLabelBounds(node, label);
    return (
      box.right * camera.zoom + camera.x >= -500 &&
      box.left * camera.zoom + camera.x <= 500 &&
      box.bottom * camera.zoom + camera.y >= -350 &&
      box.top * camera.zoom + camera.y <= 350
    );
  });
  const radius = (path: string) => graphNodeRadius(path, degree, size);
  canvasStateRef.current = {
    visible,
    positions,
    degree,
    camera,
    active: active ?? null,
    hover,
    labels,
    size,
    thickness,
    canvasMode,
  };
  const drawCanvas = useCallback(() => {
    if (
      !canvasStateRef.current.canvasMode ||
      !isVisibleRef.current ||
      !canvas.current
    )
      return;
    paintGraph(canvas.current, canvasStateRef.current);
  }, []);
  useEffect(() => {
    const engine = new GraphSimulation(
      visible.nodes,
      visible.edges,
      stateRef.current.forces,
      stateRef.current.size,
    );
    simulationRef.current = engine;
    if (needsLayout.current) {
      engine.reheat();
      needsLayout.current = false;
    }
    return () => {
      engine.dispose();
      simulationRef.current = null;
      drag.current = null;
    };
  }, [visible]);
  const lastParameters = useRef({ forces, size });
  useEffect(() => {
    const engine = simulationRef.current;
    if (!engine) return;
    engine.configure(forces, size);
    if (
      lastParameters.current.forces !== forces ||
      lastParameters.current.size !== size
    )
      engine.reheat();
    lastParameters.current = { forces, size };
    if (!isVisible) return;
    let frame = 0,
      last = 0;
    const tick = (time: number) => {
      if (time - last >= (canvasMode ? 32 : 16)) {
        last = time;
        engine.tick();
        dirty.current = true;
        if (canvasMode) drawCanvas();
        else redraw((n) => n + 1);
      }
      frame = engine.running ? requestAnimationFrame(tick) : 0;
    };
    scheduleLayout.current = () => {
      if (!frame && engine.running) frame = requestAnimationFrame(tick);
    };
    scheduleLayout.current();
    return () => {
      scheduleLayout.current = null;
      cancelAnimationFrame(frame);
      // Hiding a graph or changing its filters must release temporary drag locks.
      engine.endDrag();
      drag.current = null;
    };
  }, [visible, forces, size, isVisible, canvasMode, drawCanvas]);
  useLayoutEffect(() => {
    const element = canvas.current;
    if (!canvasMode || !isVisible || !element) return;
    const resize = new ResizeObserver(drawCanvas);
    resize.observe(element);
    const theme = new MutationObserver(drawCanvas);
    theme.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", "class", "style"],
    });
    return () => {
      resize.disconnect();
      theme.disconnect();
    };
  }, [canvasMode, isVisible, drawCanvas]);
  const focusNode = useCallback((node: GraphNode) => {
    setHover(node.path);
    setCamera((c) => ({ ...c, x: -node.x * c.zoom, y: -node.y * c.zoom }));
  }, []);
  const hit = (x: number, y: number) => {
    const wx = (x - camera.x) / camera.zoom,
      wy = (y - camera.y) / camera.zoom;
    let best: GraphNode | undefined,
      distance = Infinity;
    for (const n of visible.nodes) {
      const d = Math.hypot(n.x - wx, n.y - wy),
        r = radius(n.path) + 4 / camera.zoom;
      if (d < r && d < distance) {
        best = n;
        distance = d;
      }
    }
    return best;
  };
  const showNodeMenu = (event: ReactMouseEvent<Element>, n: GraphNode) =>
    context.show(event, t("Действия с заметкой"), [
      { label: t("Открыть заметку"), run: () => onOpen(n.path) },
      {
        label: t("Открыть в новой вкладке"),
        run: () => onOpenBackground?.(n.path),
        disabled: !onOpenBackground,
      },
      {
        label: t("Локальный граф этой заметки"),
        run: () => {
          setRoot(n.path);
          setLocal(true);
          setQuery("");
        },
      },
      {
        label: t("Открыть в проводнике"),
        run: () => api.reveal(vaultId, n.path),
      },
      {
        label: t(n.pinned ? "Освободить узел" : "Закрепить узел"),
        run: () => {
          simulationRef.current?.setPinned(n.path, !n.pinned);
          dirty.current = true;
          redraw((value) => value + 1);
          wake();
        },
      },
    ]);
  useLayoutEffect(() => {
    drawCanvas();
  });
  const point = (x: number, y: number) => {
    const matrix = svg.current?.getScreenCTM();
    if (!matrix) return { x: 0, y: 0 };
    return new DOMPoint(x, y).matrixTransform(matrix.inverse());
  };
  const zoomAt = (factor: number, x = 0, y = 0) =>
    setCamera((c) => {
      const zoom = Math.max(0.02, Math.min(5, c.zoom * factor));
      return {
        x: x - ((x - c.x) * zoom) / c.zoom,
        y: y - ((y - c.y) * zoom) / c.zoom,
        zoom,
      };
    });
  useEffect(() => {
    const node = svg.current;
    if (!node) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      zoomingUntil.current = performance.now() + 180;
      setHover(null);
      const p = point(event.clientX, event.clientY);
      zoomAt(Math.exp(-event.deltaY * 0.0015), p.x, p.y);
    };
    node.addEventListener("wheel", wheel, { passive: false });
    return () => node.removeEventListener("wheel", wheel);
  }, []);
  const fit = () => {
    if (visible.nodes.length) setCamera(fitGraphCamera(visible.nodes));
  };
  const focusedLocalPath = useRef<string | null>(null);
  useEffect(() => {
    const focusPath = local ? (root ?? active) : null;
    if (!focusPath) {
      focusedLocalPath.current = null;
      return;
    }
    if (focusedLocalPath.current === focusPath) return;
    const node = nodesRef.current.find((n) => n.path === focusPath);
    if (!node) return;
    focusedLocalPath.current = focusPath;
    setCamera((c) => ({ ...c, x: -node.x * c.zoom, y: -node.y * c.zoom }));
  }, [local, root, active, data]);
  const rebuildLayout = () => {
    if (!data) return;
    const layout = initialGraphLayout(data.nodes, data.edges),
      nodes = data.nodes.map((node) => {
        const position = layout.get(node.path);
        return {
          ...node,
          x: position?.x ?? node.x,
          y: position?.y ?? node.y,
          vx: 0,
          vy: 0,
          pinned: false,
        };
      });
    needsLayout.current = true;
    nodesRef.current = nodes;
    setData({ nodes, edges: data.edges });
    dirty.current = true;
    setCamera(fitGraphCamera(nodes));
  };
  const resetSettings = () => {
    focusedLocalPath.current = null;
    setLocal(false);
    setRoot(null);
    setForces(defaultForces);
    setSize(1);
    setThickness(1);
    setLabels(true);
    setOrphans(true);
    setQuery("");
    setDepth(1);
    rebuildLayout();
  };
  return (
    <section className="knowledge-graph" aria-label={t("Граф связей")}>
      <header className="graph-header">
        <Waypoints size={16} />
        <strong>{t(local ? "Локальный граф" : "Граф связей")}</strong>
        <span>
          {visible.nodes.length} · {visible.edges.length}
        </span>
        <div className="graph-header-actions">
          <button
            className="icon-button"
            aria-label={t("Настройки графа")}
            aria-expanded={settings}
            onClick={() => setSettings((s) => !s)}
          >
            <Settings2 size={17} />
          </button>
          <button
            className="icon-button"
            aria-label={t("Закрыть граф")}
            onClick={onClose}
          >
            <X size={17} />
          </button>
        </div>
      </header>
      <div className="graph-stage">
        {canvasMode && (
          <canvas ref={canvas} className="graph-canvas" aria-hidden="true" />
        )}
        <svg
          ref={svg}
          viewBox="-500 -350 1000 700"
          tabIndex={0}
          aria-label={t("Полотно графа")}
          onKeyDown={(e) => {
            if (e.target !== e.currentTarget) return;
            if (e.key === "+" || e.key === "=") {
              e.preventDefault();
              zoomAt(1.2);
            } else if (e.key === "-") {
              e.preventDefault();
              zoomAt(1 / 1.2);
            } else if (e.key.startsWith("Arrow")) {
              e.preventDefault();
              const delta = e.shiftKey ? 100 : 30;
              setCamera((c) => ({
                ...c,
                x:
                  c.x +
                  (e.key === "ArrowLeft"
                    ? delta
                    : e.key === "ArrowRight"
                      ? -delta
                      : 0),
                y:
                  c.y +
                  (e.key === "ArrowUp"
                    ? delta
                    : e.key === "ArrowDown"
                      ? -delta
                      : 0),
              }));
            }
          }}
          onContextMenu={(event) => {
            const path =
              event.target instanceof Element
                ? event.target.closest("[data-node]")?.getAttribute("data-node")
                : null;
            const p = point(event.clientX, event.clientY);
            const n = path ? positions.get(path) : hit(p.x, p.y);
            if (n) showNodeMenu(event, n);
          }}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            const p = point(e.clientX, e.clientY);
            let target =
              e.target instanceof Element
                ? (e.target.closest("[data-node]")?.getAttribute("data-node") ??
                  undefined)
                : undefined;
            if (!target && canvasMode) target = hit(p.x, p.y)?.path;
            drag.current = {
              id: e.pointerId,
              path: target,
              x: p.x,
              y: p.y,
              moved: false,
            };
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            const d = drag.current;
            if (!d || d.id !== e.pointerId) {
              if (performance.now() < zoomingUntil.current) return;
              if (canvasMode) {
                const p = point(e.clientX, e.clientY);
                setHover(hit(p.x, p.y)?.path ?? null);
              } else {
                setHover(
                  e.target instanceof Element
                    ? (e.target
                        .closest("[data-node]")
                        ?.getAttribute("data-node") ?? null)
                    : null,
                );
              }
              return;
            }
            const p = point(e.clientX, e.clientY),
              dx = p.x - d.x,
              dy = p.y - d.y;
            if (!d.moved && Math.hypot(dx, dy) < 3) return;
            if (!d.moved && d.path) simulationRef.current?.beginDrag(d.path);
            d.moved = true;
            if (d.path) {
              const n = positions.get(d.path);
              if (n) {
                simulationRef.current?.moveDrag(
                  n.x + dx / camera.zoom,
                  n.y + dy / camera.zoom,
                );
                dirty.current = true;
                if (canvasMode) drawCanvas();
                else redraw((v) => v + 1);
                wake();
              }
            } else setCamera((c) => ({ ...c, x: c.x + dx, y: c.y + dy }));
            d.x = p.x;
            d.y = p.y;
          }}
          onPointerUp={(e) => {
            const d = drag.current;
            simulationRef.current?.endDrag();
            drag.current = null;
            if (e.currentTarget.hasPointerCapture(e.pointerId))
              e.currentTarget.releasePointerCapture(e.pointerId);
            if (d?.path && !d.moved) onOpen(d.path);
            if (canvasMode) drawCanvas();
            else redraw((v) => v + 1);
            if (d?.path && d.moved) wake();
          }}
          onPointerCancel={() => {
            simulationRef.current?.endDrag();
            drag.current = null;
            wake();
          }}
          onLostPointerCapture={() => {
            simulationRef.current?.endDrag();
            drag.current = null;
          }}
        >
          <g
            transform={`translate(${camera.x},${camera.y}) scale(${camera.zoom})`}
          >
            {!canvasMode &&
              visible.edges.map(([a, b]) => {
                const x = positions.get(a),
                  y = positions.get(b);
                if (
                  !x ||
                  !y ||
                  (!inView(x) &&
                    !inView(y) &&
                    (Math.min(x.x, y.x) * camera.zoom + camera.x > 600 ||
                      Math.max(x.x, y.x) * camera.zoom + camera.x < -600 ||
                      Math.min(x.y, y.y) * camera.zoom + camera.y > 400 ||
                      Math.max(x.y, y.y) * camera.zoom + camera.y < -400))
                )
                  return null;
                return (
                  <line
                    key={JSON.stringify([a, b])}
                    className={
                      hover && (a === hover || b === hover)
                        ? "is-highlighted"
                        : hover
                          ? "is-dimmed"
                          : ""
                    }
                    strokeWidth={0.7 * thickness}
                    vectorEffect="non-scaling-stroke"
                    x1={x.x}
                    y1={x.y}
                    x2={y.x}
                    y2={y.y}
                  />
                );
              })}
            {canvasMode ? (
              <GraphAccessibleNodes
                nodes={visible.nodes}
                onOpen={onOpen}
                onFocusNode={focusNode}
              />
            ) : (
              rendered.map((n) => (
                <g
                  key={n.path}
                  data-node={n.path}
                  data-pinned={n.pinned ? "true" : undefined}
                  role="button"
                  tabIndex={0}
                  aria-label={n.path}
                  className={`graph-node ${n.path === active ? "is-active" : ""} ${hover && !highlighted.has(n.path) ? "is-dimmed" : ""}`}
                  transform={`translate(${n.x},${n.y})`}
                  onPointerEnter={() => {
                    if (
                      !drag.current &&
                      performance.now() >= zoomingUntil.current
                    )
                      setHover(n.path);
                  }}
                  onPointerLeave={() => setHover(null)}
                  onContextMenu={(event) => showNodeMenu(event, n)}
                  onFocus={() => setHover(n.path)}
                  onBlur={() => setHover(null)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onOpen(n.path);
                    }
                  }}
                >
                  {shownLabels.has(n.path) && <title>{n.path}</title>}
                  <circle r={radius(n.path)} />
                  {labels && shownLabels.has(n.path) && (
                    <text
                      x={shownLabels.get(n.path)?.x}
                      y={shownLabels.get(n.path)?.y}
                      textAnchor="middle"
                      style={{
                        opacity: graphLabelOpacity(viewportScale * camera.zoom),
                        fontSize: `${11 / (viewportScale * camera.zoom)}px`,
                        strokeWidth: 3 / (viewportScale * camera.zoom),
                      }}
                    >
                      {shownLabels
                        .get(n.path)
                        ?.lines.map((line: string, index: number) => (
                          <tspan
                            key={index}
                            x={shownLabels.get(n.path)?.x}
                            dy={
                              index
                                ? GRAPH_LABEL_LINE_HEIGHT /
                                  (viewportScale * camera.zoom)
                                : 0
                            }
                          >
                            {line}
                          </tspan>
                        ))}
                    </text>
                  )}
                </g>
              ))
            )}
          </g>
        </svg>
        {(error || !data || !visible.nodes.length) && (
          <div className="graph-message" role={error ? "alert" : "status"}>
            {error || t(!data ? "Загрузка графа…" : "Нет заметок")}
            {error && (
              <button onClick={() => setRetry((n) => n + 1)}>
                {t("Повторить")}
              </button>
            )}
          </div>
        )}
        {settings && (
          <aside className="graph-settings" aria-label={t("Настройки графа")}>
            <div className="graph-settings-heading">
              <Settings2 size={15} />
              <span>{t("Настройки графа")}</span>
              <button
                className="icon-button"
                aria-label={t("Сбросить настройки и раскладку")}
                data-tooltip={t("Сбросить настройки и раскладку")}
                onClick={resetSettings}
              >
                <RotateCcw size={15} />
              </button>
              <button
                className="icon-button"
                aria-label={t("Скрыть настройки графа")}
                data-tooltip={t("Скрыть настройки графа")}
                onClick={() => {
                  setSettings(false);
                  document
                    .querySelector<HTMLButtonElement>(
                      ".graph-header-actions button",
                    )
                    ?.focus();
                }}
              >
                <X size={15} />
              </button>
            </div>
            <details open>
              <summary>
                <ChevronRight size={14} />
                {t("Фильтры")}
              </summary>
              <div className="note-search-field graph-search-field">
                <Search size={15} />
                <input
                  aria-label={t("Поиск заметок")}
                  placeholder={t("Поиск заметок")}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                {query && (
                  <button
                    className="icon-button"
                    aria-label={t("Очистить поиск")}
                    onClick={() => setQuery("")}
                  >
                    <X size={13} />
                  </button>
                )}
              </div>
              <label>
                {t("Локальный граф")}
                <input
                  type="checkbox"
                  checked={local}
                  disabled={!active && !root}
                  onChange={(e) => {
                    setLocal(e.target.checked);
                    if (e.target.checked && !root) setRoot(active ?? null);
                  }}
                />
              </label>
              {local && (
                <p className="graph-local-root" title={root ?? active}>
                  {root ?? active}
                </p>
              )}
              {local && (
                <label>
                  {t("Глубина")}
                  <input
                    aria-label={t("Глубина")}
                    type="range"
                    min={1}
                    max={5}
                    value={depth}
                    onChange={(e) => setDepth(Number(e.target.value))}
                  />
                  <output>{depth}</output>
                </label>
              )}
              <label>
                {t("Заметки без связей")}
                <input
                  type="checkbox"
                  checked={orphans}
                  onChange={(e) => setOrphans(e.target.checked)}
                />
              </label>
            </details>
            <details open>
              <summary>
                <ChevronRight size={14} />
                {t("Отображение")}
              </summary>
              <label>
                {t("Названия заметок")}
                <input
                  type="checkbox"
                  checked={labels}
                  onChange={(e) => setLabels(e.target.checked)}
                />
              </label>
              {[
                { label: "Размер узлов", value: size, set: setSize },
                {
                  label: "Толщина связей",
                  value: thickness,
                  set: setThickness,
                },
              ].map((item) => (
                <label key={item.label}>
                  {t(item.label)}
                  <input
                    aria-label={t(item.label)}
                    type="range"
                    min={0.5}
                    max={3}
                    step={0.1}
                    value={item.value}
                    onChange={(e) => item.set(Number(e.target.value))}
                  />
                  <output>{item.value.toFixed(1)}</output>
                </label>
              ))}
            </details>
            <details>
              <summary>
                <ChevronRight size={14} />
                {t("Силы")}
              </summary>
              {(
                [
                  {
                    key: "center",
                    label: "Сила центра",
                    min: 0,
                    max: 2,
                    step: 0.05,
                  },
                  {
                    key: "repel",
                    label: "Отталкивание",
                    min: 0,
                    max: 3,
                    step: 0.05,
                  },
                  {
                    key: "strength",
                    label: "Притяжение связей",
                    min: 0,
                    max: 2,
                    step: 0.05,
                  },
                  {
                    key: "distance",
                    label: "Длина связей",
                    min: 30,
                    max: 250,
                    step: 5,
                  },
                ] as const
              ).map((item) => (
                <label key={item.key}>
                  {t(item.label)}
                  <input
                    aria-label={t(item.label)}
                    type="range"
                    min={item.min}
                    max={item.max}
                    step={item.step}
                    value={forces[item.key]}
                    onChange={(e) =>
                      setForces((f) => ({
                        ...f,
                        [item.key]: Number(e.target.value),
                      }))
                    }
                  />
                  <output>
                    {item.key === "distance"
                      ? forces[item.key]
                      : forces[item.key].toFixed(2)}
                  </output>
                </label>
              ))}
            </details>
          </aside>
        )}
        <div className="graph-navigation">
          <button
            className="icon-button"
            aria-label={t("Приблизить")}
            onClick={() => zoomAt(1.2)}
          >
            <Plus size={16} />
          </button>
          <button
            className="icon-button"
            aria-label={t("Отдалить")}
            onClick={() => zoomAt(1 / 1.2)}
          >
            <Minus size={16} />
          </button>
          <button
            className="icon-button"
            aria-label={t("Вписать граф")}
            onClick={fit}
          >
            <Maximize size={16} />
          </button>
        </div>
        <p className="graph-hint">
          {t("Перетаскивайте полотно и узлы · Колесо — масштаб")}
        </p>
      </div>
      {context.menu}
      <footer
        className="graph-footer"
        role={persistenceError ? "alert" : undefined}
      >
        {persistenceError || t("Связи сохранённых заметок")}
      </footer>
    </section>
  );
}

const GraphAccessibleNodes = memo(function GraphAccessibleNodes({
  nodes,
  onOpen,
  onFocusNode,
}: {
  nodes: GraphNode[];
  onOpen: (path: string) => void;
  onFocusNode: (node: GraphNode) => void;
}) {
  return (
    <>
      {nodes.map((n) => (
        <g
          key={n.path}
          data-node={n.path}
          role="button"
          aria-label={n.path}
          tabIndex={0}
          onFocus={() => onFocusNode(n)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onOpen(n.path);
            }
          }}
        />
      ))}
    </>
  );
});
