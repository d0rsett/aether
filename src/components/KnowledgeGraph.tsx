import { useEffect, useMemo, useRef, useState } from "react";
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
import { api, errorMessage } from "../services/api";
import { t, useLocale } from "../i18n";
import {
  defaultForces,
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
}: {
  vaultId: string;
  revision: number;
  active?: string;
  onOpen: (path: string) => void;
  onClose: () => void;
}) {
  useLocale();
  const [data, setData] = useState<{
    nodes: GraphNode[];
    edges: GraphEdge[];
  } | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [local, setLocal] = useState(false);
  const [depth, setDepth] = useState(1);
  const [orphans, setOrphans] = useState(true);
  const [labels, setLabels] = useState(true);
  const [size, setSize] = useState(1);
  const [thickness, setThickness] = useState(1);
  const [forces, setForces] = useState(defaultForces);
  const [settings, setSettings] = useState(true);
  const [camera, setCamera] = useState({ x: 0, y: 0, zoom: 1 });
  const [hover, setHover] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [, redraw] = useState(0);
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
    let cancelled = false;
    setError("");
    setData(null);
    void (async () => {
      const hits: { path: string; title: string }[] = [];
      let more = true;
      while (more) {
        const page = await api.search(vaultId, {
          text: "",
          path: "",
          tag: "",
          property: "",
          value: "",
          offset: hits.length,
        });
        if (cancelled) return;
        hits.push(...page.hits);
        more = page.hasMore && page.hits.length > 0;
      }
      const paths = new Set(hits.map((n) => n.path));
      const edges = new Map<string, [string, string]>();
      // Bound concurrent IPC work while retaining the shared alias/link resolver.
      let cursor = 0;
      await Promise.all(
        Array.from({ length: Math.min(4, hits.length) }, async () => {
          while (cursor < hits.length && !cancelled) {
            const note = hits[cursor++];
            const inspection = await api.inspect(vaultId, note.path);
            for (const link of inspection.outgoing) {
              const target = link.resolution.path;
              if (
                link.resolution.status !== "resolved" ||
                !target ||
                !paths.has(target) ||
                target === note.path
              )
                continue;
              const pair: [string, string] =
                note.path < target ? [note.path, target] : [target, note.path];
              edges.set(JSON.stringify(pair), pair);
            }
          }
        }),
      );
      if (cancelled) return;
      const nodes = hits.map((n, i) => ({
        ...n,
        x: 220 * Math.cos(i * 2.39996) * Math.sqrt((i + 1) / hits.length),
        y: 220 * Math.sin(i * 2.39996) * Math.sqrt((i + 1) / hits.length),
        vx: 0,
        vy: 0,
      }));
      setData({ nodes, edges: [...edges.values()] });
    })().catch((e) => {
      if (!cancelled) setError(errorMessage(e));
    });
    return () => {
      cancelled = true;
    };
  }, [vaultId, revision, retry]);
  const visible = useMemo(
    () =>
      filterGraph(
        data?.nodes ?? [],
        data?.edges ?? [],
        query,
        local ? active : undefined,
        depth,
        orphans,
      ),
    [data, query, local, active, depth, orphans],
  );
  useEffect(() => {
    wake();
    let frame = 0;
    const tick = () => {
      if (frames.current > 0 || drag.current?.path) {
        stepLayout(visible.nodes, visible.edges, forces, drag.current?.path);
        frames.current--;
        redraw((n) => n + 1);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [visible, forces]);
  const positions = new Map(visible.nodes.map((n) => [n.path, n]));
  const degree = new Map<string, number>();
  const highlighted = new Set(hover ? [hover] : []);
  for (const [a, b] of visible.edges) {
    degree.set(a, (degree.get(a) ?? 0) + 1);
    degree.set(b, (degree.get(b) ?? 0) + 1);
    if (a === hover) highlighted.add(b);
    if (b === hover) highlighted.add(a);
  }
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
    const extent = Math.max(
      160,
      ...visible.nodes.map((n) => Math.max(Math.abs(n.x), Math.abs(n.y))),
    );
    setCamera({ x: 0, y: 0, zoom: Math.min(2, 280 / extent) });
  };
  const resetSettings = () => {
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
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            const p = point(e.clientX, e.clientY);
            const target =
              e.target instanceof Element
                ? (e.target.closest("[data-node]")?.getAttribute("data-node") ??
                  undefined)
                : undefined;
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
            if (!d || d.id !== e.pointerId) return;
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
            {visible.edges.map(([a, b]) => {
              const x = positions.get(a),
                y = positions.get(b);
              if (!x || !y) return null;
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
            {visible.nodes.map((n) => (
              <g
                key={n.path}
                data-node={n.path}
                role="button"
                tabIndex={0}
                aria-label={n.path}
                className={`graph-node ${n.path === active ? "is-active" : ""} ${hover && !highlighted.has(n.path) ? "is-dimmed" : ""}`}
                transform={`translate(${n.x},${n.y})`}
                onPointerEnter={() => {
                  if (!drag.current) setHover(n.path);
                }}
                onPointerLeave={() => setHover(null)}
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
                {labels && (
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
            ))}
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
                  disabled={!active}
                  onChange={(e) => setLocal(e.target.checked)}
                />
              </label>
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
      <footer className="graph-footer">{t("Связи сохранённых заметок")}</footer>
    </section>
  );
}
