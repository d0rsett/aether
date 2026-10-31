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
  graphLabels,
  filterGraph,
  stepLayout,
  type GraphNode,
  type GraphEdge,
} from "../graph/model";
import "../styles/graph.css";

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
  const animate = useRef(false);
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
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{
    id: number;
    path?: string;
    x: number;
    y: number;
    moved: boolean;
  } | null>(null);
  useEffect(() => {
    const opener = document.activeElement;
    svg.current?.focus();
    return () => {
      if (opener instanceof HTMLElement && opener.isConnected)
        opener.focus({ preventScroll: true });
    };
  }, []);
  const frames = useRef(0);
  const wake = () => {
    frames.current = 240;
  };
  useEffect(() => {
    if (indexRunning) return;
    let cancelled = false;
    setError("");
    void api
      .graph(vaultId)
      .then((snapshot) => {
        if (cancelled) return;
        const nodes = mergeGraphNodes(
          snapshot.nodes,
          nodesRef.current,
          snapshot.edges,
          initial.positions,
        );
        const first = !loaded.current;
        nodesRef.current = nodes;
        animate.current = first && !initial.positions.length;
        loaded.current = true;
        setData({ nodes, edges: snapshot.edges });
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
  const lastForces = useRef(forces);
  useEffect(() => {
    if (!isVisible) return;
    if (animate.current || lastForces.current !== forces) wake();
    animate.current = false;
    lastForces.current = forces;
    let frame = 0,
      last = 0;
    const tick = (time: number) => {
      if (
        (frames.current > 0 || drag.current?.path) &&
        time - last >= (visible.nodes.length > 1500 ? 32 : 16)
      ) {
        last = time;
        dirty.current = true;
        stepLayout(visible.nodes, visible.edges, forces, drag.current?.path);
        frames.current--;
        redraw((n) => n + 1);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [visible, forces, isVisible]);
  const positions = new Map(visible.nodes.map((n) => [n.path, n]));
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
  const shownLabels = graphLabels(visible.nodes, camera.zoom, hover);
  const inView = (n: GraphNode) =>
    Math.abs(n.x * camera.zoom + camera.x) < 600 &&
    Math.abs(n.y * camera.zoom + camera.y) < 400;
  const rendered = visible.nodes.filter(inView);
  const canvasMode = visible.nodes.length > 1500;
  const focusNode = useCallback((node: GraphNode) => {
    setHover(node.path);
    setCamera((c) => ({ ...c, x: -node.x * c.zoom, y: -node.y * c.zoom }));
  }, []);
  const hit = (x: number, y: number) => {
    const wx = (x - camera.x) / camera.zoom,
      wy = (y - camera.y) / camera.zoom;
    let best: GraphNode | undefined,
      distance = Infinity;
    for (const n of rendered) {
      const d = Math.hypot(n.x - wx, n.y - wy),
        r =
          (4 + Math.min(9, Math.sqrt(degree.get(n.path) ?? 0) * 1.5)) * size +
          4 / camera.zoom;
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
        label: t("Освободить узел"),
        disabled: !n.pinned,
        run: () => {
          n.pinned = false;
          wake();
        },
      },
    ]);
  useLayoutEffect(() => {
    if (!canvasMode || !isVisible || !canvas.current) return;
    const element = canvas.current,
      rect = element.getBoundingClientRect(),
      ratio = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.round(rect.width * ratio),
      height = Math.round(rect.height * ratio);
    if (element.width !== width || element.height !== height) {
      element.width = width;
      element.height = height;
    }
    const ctx = element.getContext("2d");
    if (!ctx) return;
    const theme = getComputedStyle(document.documentElement),
      color = (name: string) => theme.getPropertyValue(name).trim();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const scale = Math.min(rect.width / 1000, rect.height / 700) * ratio;
    ctx.setTransform(
      scale * camera.zoom,
      0,
      0,
      scale * camera.zoom,
      width / 2 + camera.x * scale,
      height / 2 + camera.y * scale,
    );
    ctx.lineWidth = thickness;
    for (const [a, b] of visible.edges) {
      const x = positions.get(a),
        y = positions.get(b);
      if (!x || !y) continue;
      const connected = a === hover || b === hover;
      ctx.globalAlpha = hover ? (connected ? 0.95 : 0.08) : 0.45;
      ctx.strokeStyle = color(connected ? "--accent" : "--subtle");
      ctx.beginPath();
      ctx.moveTo(x.x, x.y);
      ctx.lineTo(y.x, y.y);
      ctx.stroke();
    }
    for (const n of rendered) {
      ctx.globalAlpha = hover && !highlighted.has(n.path) ? 0.12 : 1;
      ctx.fillStyle = color(
        n.path === active || n.path === hover ? "--accent" : "--muted",
      );
      ctx.beginPath();
      ctx.arc(
        n.x,
        n.y,
        (4 + Math.min(9, Math.sqrt(degree.get(n.path) ?? 0) * 1.5)) * size,
        0,
        Math.PI * 2,
      );
      ctx.fill();
      if (labels && shownLabels.has(n.path)) {
        ctx.fillStyle = color("--text");
        ctx.font = '11px "Segoe UI", sans-serif';
        ctx.textAlign = "center";
        ctx.globalAlpha *=
          n.path === hover ? 1 : Math.min(1, camera.zoom * 0.7);
        ctx.fillText(n.title, n.x, n.y + 20 * size);
      }
    }
    ctx.globalAlpha = 1;
  });
  const point = (x: number, y: number) => {
    const matrix = svg.current?.getScreenCTM();
    if (!matrix) return { x: 0, y: 0 };
    return new DOMPoint(x, y).matrixTransform(matrix.inverse());
  };
  const zoomAt = (factor: number, x = 0, y = 0) =>
    setCamera((c) => {
      const zoom = Math.max(0.15, Math.min(5, c.zoom * factor));
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
      const p = point(event.clientX, event.clientY);
      zoomAt(Math.exp(-event.deltaY * 0.0015), p.x, p.y);
    };
    node.addEventListener("wheel", wheel, { passive: false });
    return () => node.removeEventListener("wheel", wheel);
  }, []);
  const fit = () => {
    const extent = visible.nodes.reduce(
      (extent, n) => Math.max(extent, Math.abs(n.x), Math.abs(n.y)),
      160,
    );
    setCamera({ x: 0, y: 0, zoom: Math.min(2, 280 / extent) });
  };
  const resetSettings = () => {
    setLocal(false);
    setRoot(null);
    setForces(defaultForces);
    setSize(1);
    setThickness(1);
    setLabels(true);
    setOrphans(true);
    setQuery("");
    setDepth(1);
    setCamera({ x: 0, y: 0, zoom: 1 });
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
              if (canvasMode) {
                const p = point(e.clientX, e.clientY);
                setHover(hit(p.x, p.y)?.path ?? null);
              }
              return;
            }
            const p = point(e.clientX, e.clientY),
              dx = p.x - d.x,
              dy = p.y - d.y;
            if (!d.moved && Math.hypot(dx, dy) < 3) return;
            d.moved = true;
            if (d.path) {
              const n = positions.get(d.path);
              if (n) {
                n.x += dx / camera.zoom;
                n.y += dy / camera.zoom;
                n.pinned = true;
                dirty.current = true;
                redraw((v) => v + 1);
                wake();
              }
            } else setCamera((c) => ({ ...c, x: c.x + dx, y: c.y + dy }));
            d.x = p.x;
            d.y = p.y;
          }}
          onPointerUp={(e) => {
            const d = drag.current;
            drag.current = null;
            if (e.currentTarget.hasPointerCapture(e.pointerId))
              e.currentTarget.releasePointerCapture(e.pointerId);
            if (d?.path && !d.moved) onOpen(d.path);
            redraw((v) => v + 1);
            wake();
          }}
          onPointerCancel={() => {
            drag.current = null;
          }}
          onLostPointerCapture={() => {
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
                    strokeWidth={thickness}
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
                    if (!drag.current) setHover(n.path);
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
                  <title>{n.path}</title>
                  <circle
                    r={
                      (4 +
                        Math.min(9, Math.sqrt(degree.get(n.path) ?? 0) * 1.5)) *
                      size
                    }
                  />
                  {labels && shownLabels.has(n.path) && (
                    <text
                      y={20 * size}
                      textAnchor="middle"
                      style={{
                        opacity:
                          hover === n.path ? 1 : Math.min(1, camera.zoom * 0.7),
                      }}
                    >
                      {n.title}
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
                aria-label={t("Сбросить настройки")}
                data-tooltip={t("Сбросить настройки")}
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
