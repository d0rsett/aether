import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { PointerEvent } from "react";
import {
  FilePlus2,
  Link2,
  Settings2,
  Group,
  Maximize,
  Minus,
  Plus,
  Redo2,
  StickyNote,
  Trash2,
  Undo2,
} from "lucide-react";
import { t } from "../i18n";
import { CanvasGroupBackground } from "./CanvasGroupBackground";
import { imageExtension } from "../services/images";
import { CanvasFileCard, type CanvasFiles } from "./CanvasFileCard";
import { Modal } from "./Modal";
import { FileTree } from "../explorer/FileTree";
import {
  canvasFileDragType,
  canvasFilePath,
  isCanvasAttachment,
  markdownFile,
  readCanvasFileDrag,
} from "../services/canvasFiles";
import { api, errorMessage } from "../services/api";
import { clipboardType, httpUrl, snapAxis } from "../canvas/interaction";
import { useCanvasHistory } from "../canvas/history";
import {
  binding,
  shortcutFromEvent,
  type Shortcuts,
} from "../workspace/shortcuts";
import "../styles/canvas.css";

type RecordValue = Record<string, unknown>;
type Card = RecordValue & {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

function isRecord(value: unknown): value is RecordValue {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isCard(value: unknown): value is Card {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.type === "string" &&
    [value.x, value.y, value.width, value.height].every(
      (n) =>
        typeof n === "number" &&
        Number.isSafeInteger(n) &&
        Math.abs(n) <= 1_000_000,
    ) &&
    Number(value.width) > 0 &&
    Number(value.height) > 0
  );
}

function parse(content: string) {
  try {
    const data: unknown = JSON.parse(content.replace(/^\uFEFF/, ""));
    if (!isRecord(data)) return null;
    const nodes = data.nodes === undefined ? [] : data.nodes;
    const edges = data.edges === undefined ? [] : data.edges;
    if (!Array.isArray(nodes) || !Array.isArray(edges)) return null;
    const cards = nodes.filter(isCard);
    if (new Set(cards.map((card) => card.id)).size !== cards.length)
      return null;
    return { data, nodes, cards, edges };
  } catch {
    return null;
  }
}

type Point = { x: number; y: number };
type Camera = Point & { zoom: number };
type Drag = {
  pointer: number;
  start: Point;
  target:
    | { kind: "move"; ids: ReadonlySet<string>; anchor: string }
    | { kind: "select" }
    | { kind: "resize"; id: string; corner: Corner }
    | { kind: "pan"; camera: Camera }
    | {
        kind: "connection";
        source: Port;
        replace?: { index: number; end: "from" | "to" };
      };
};
type Selection =
  | { kind: "card"; id: string; others?: string[] }
  | { kind: "edge"; index: number };
type Corner = "nw" | "ne" | "sw" | "se";
const corners: Corner[] = ["nw", "ne", "sw", "se"];
const colors: Record<string, string> = {
  "1": "#df6666",
  "2": "#d98c53",
  "3": "#ccac47",
  "4": "#75b77b",
  "5": "#56b2ba",
  "6": "#a082ce",
};
function canvasColor(color: unknown) {
  if (typeof color !== "string") return undefined;
  if (/^#[\da-f]{6}$/i.test(color)) return color;
  return Object.hasOwn(colors, color) ? colors[color] : undefined;
}

function enclosing(cards: readonly Card[]) {
  return cards.reduce(
    (box, card) => ({
      left: Math.min(box.left, card.x),
      top: Math.min(box.top, card.y),
      right: Math.max(box.right, card.x + card.width),
      bottom: Math.max(box.bottom, card.y + card.height),
    }),
    { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity },
  );
}

function contains(group: Card, card: Card) {
  return (
    card.x >= group.x &&
    card.y >= group.y &&
    card.x + card.width <= group.x + group.width &&
    card.y + card.height <= group.y + group.height
  );
}

function resized(card: Card, corner: Corner, offset: Point): Card {
  const west = corner.endsWith("w");
  const north = corner.startsWith("n");
  const width = Math.max(48, card.width + (west ? -offset.x : offset.x));
  const height = Math.max(48, card.height + (north ? -offset.y : offset.y));
  return {
    ...card,
    width,
    height,
    x: west ? card.x + card.width - width : card.x,
    y: north ? card.y + card.height - height : card.y,
  };
}

type Side = "left" | "right" | "top" | "bottom";

type Port = { id: string; side: Side };

const sides: Side[] = ["left", "right", "top", "bottom"];

function endpoint(card: Card, side: unknown, other: Point) {
  const center = {
    x: card.x + card.width / 2,
    y: card.y + card.height / 2,
  };
  const dx = other.x - center.x;
  const dy = other.y - center.y;
  const direction =
    side === "left" || side === "right" || side === "top" || side === "bottom"
      ? side
      : Math.abs(dx / card.width) >= Math.abs(dy / card.height)
        ? dx < 0
          ? "left"
          : "right"
        : dy < 0
          ? "top"
          : "bottom";
  return {
    x:
      center.x +
      (direction === "left"
        ? -card.width / 2
        : direction === "right"
          ? card.width / 2
          : 0),
    y:
      center.y +
      (direction === "top"
        ? -card.height / 2
        : direction === "bottom"
          ? card.height / 2
          : 0),
  };
}

function zoomAt(camera: Camera, point: Point, factor: number): Camera {
  const zoom = Math.max(0.1, Math.min(3, camera.zoom * factor));
  const ratio = zoom / camera.zoom;
  return {
    x: point.x - (point.x - camera.x) * ratio,
    y: point.y - (point.y - camera.y) * ratio,
    zoom,
  };
}

export function CanvasBoard({
  content,
  onChange,
  files,
  refresh = 0,
  shortcuts = {},
}: {
  content: string;
  onChange: (content: string) => void;
  files?: CanvasFiles;
  refresh?: number;
  shortcuts?: Shortcuts;
}) {
  const history = useCanvasHistory(content, onChange);
  const board = useMemo(() => parse(content), [content]);
  const [chooseFile, setChooseFile] = useState<
    "card" | { group: string } | null
  >(null);
  const [marquee, setMarquee] = useState<{ start: Point; end: Point } | null>(
    null,
  );
  const [gridSnap, setGridSnap] = useState(false);
  const [objectSnap, setObjectSnap] = useState(false);
  const [settings, setSettings] = useState(false);
  const space = useRef(false);
  const alive = useRef(true);
  const latestContent = useRef(content);
  latestContent.current = content;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const viewport = useRef<HTMLDivElement>(null);
  const gesture = useRef<Drag | null>(null);
  const [offset, setOffset] = useState<Point | null>(null);
  const [wire, setWire] = useState<{ source: Port; point: Point } | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [connection, setConnection] = useState<{
    id: string;
    side: Side;
  } | null>(null);
  const arrow = useId();
  const [camera, setCamera] = useState<Camera>(() => {
    const origin = board?.cards.reduce(
      (point, card) => ({
        x: Math.min(point.x, card.x),
        y: Math.min(point.y, card.y),
      }),
      { x: 0, y: 0 },
    );
    return { x: 48 - (origin?.x ?? 0), y: 48 - (origin?.y ?? 0), zoom: 1 };
  });

  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      if (
        event.target instanceof Element &&
        event.target.closest("textarea, input, [data-canvas-note-editor]")
      )
        return;
      const preview =
        event.target instanceof Element
          ? event.target.closest<HTMLElement>(".canvas-file-preview")
          : null;
      if (
        !event.ctrlKey &&
        !event.metaKey &&
        preview &&
        preview.scrollHeight > preview.clientHeight
      )
        return;
      event.preventDefault();
      if (gesture.current) return;
      const rect = element.getBoundingClientRect();
      const point = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      };
      const unit =
        event.deltaMode === 1
          ? 16
          : event.deltaMode === 2
            ? element.clientHeight
            : 1;
      setCamera((current) => {
        if (event.ctrlKey || event.metaKey)
          return zoomAt(current, point, Math.exp(-event.deltaY * unit * 0.002));
        return {
          ...current,
          x:
            current.x -
            (event.deltaX || (event.shiftKey ? event.deltaY : 0)) * unit,
          y: current.y - (event.shiftKey ? 0 : event.deltaY) * unit,
        };
      });
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, [board !== null]);

  const addImported = useRef<(paths: string[], point: Point) => void>(
    () => undefined,
  );
  const replaceLatest = useRef<
    (id: string, text: string, path: string) => void
  >(() => undefined);
  if (!board) return <p role="alert">{t("Некорректный файл доски.")}</p>;
  const commit = (
    patch: { nodes?: unknown[]; edges?: unknown[] },
    edit?: string,
  ) =>
    history.commit(
      (content.startsWith("\uFEFF") ? "\uFEFF" : "") +
        JSON.stringify({ ...board.data, ...patch }, null, 2) +
        "\n",
      edit,
    );
  const replaceCard = (card: Card, next: Card, edit?: string) =>
    commit(
      { nodes: board.nodes.map((node) => (node === card ? next : node)) },
      edit,
    );
  const byId = new Map(board.cards.map((card) => [card.id, card]));
  const selectedIds =
    selection?.kind === "card"
      ? [selection.id, ...(selection.others ?? [])]
      : [];
  const movement = (ids: readonly string[]) => {
    const result = new Set(ids);
    for (const id of ids) {
      const group = byId.get(id);
      if (group?.type === "group") {
        for (const card of board.cards)
          if (contains(group, card)) result.add(card.id);
      }
    }
    return result;
  };
  const move = (ids: ReadonlySet<string>, dx: number, dy: number) => {
    if (!dx && !dy) return;
    const next = board.cards
      .filter((card) => ids.has(card.id))
      .map((card) => ({
        ...card,
        x: card.x + dx,
        y: card.y + dy,
      }));
    if (next.some((card) => !isCard(card))) return;
    const moved = new Map(next.map((card) => [card.id, card]));
    commit({
      nodes: board.nodes.map((node) =>
        isCard(node) ? (moved.get(node.id) ?? node) : node,
      ),
    });
  };
  const position = (card: Card) => {
    const target = gesture.current?.target;
    if (offset && target?.kind === "move" && target.ids.has(card.id))
      return { ...card, x: card.x + offset.x, y: card.y + offset.y };
    if (offset && target?.kind === "resize" && target.id === card.id)
      return resized(card, target.corner, offset);
    return card;
  };
  const resize = (card: Card, corner: Corner, change: Point) => {
    if (!change.x && !change.y) return;
    const next = resized(card, corner, change);
    if (isCard(next)) replaceCard(card, next);
  };
  const stepHistory = (redo: boolean) => {
    if (gesture.current || !history.step(redo)) return;
    setSelection(null);
    setEditing(null);
    setConnection(null);
    viewport.current?.focus({ preventScroll: true });
  };
  const center = () => ({
    x: (viewport.current?.clientWidth ?? 0) / 2,
    y: (viewport.current?.clientHeight ?? 0) / 2,
  });
  const world = (point: Point) => ({
    x: (point.x - camera.x) / camera.zoom,
    y: (point.y - camera.y) / camera.zoom,
  });
  const addCard = (point: Point, file?: string) => {
    if (
      file !== undefined &&
      (!canvasFilePath(file) || !isCanvasAttachment(file))
    )
      return;
    const at = world(point);
    const card = {
      id: crypto.randomUUID(),
      ...(file === undefined
        ? { type: "text", text: "" }
        : { type: "file", file }),
      x: Math.round(at.x),
      y: Math.round(at.y),
      width: file === undefined ? 240 : 320,
      height: file === undefined ? 140 : 220,
    };
    if (!isCard(card)) return;
    commit({ nodes: [...board.nodes, card] });
    setConnection(null);
    setSelection({ kind: "card", id: card.id });
    setEditing(file === undefined ? card.id : null);
  };
  addImported.current = (paths, at) => {
    const cards = paths
      .filter(canvasFilePath)
      .map((file, index) => ({
        id: crypto.randomUUID(),
        type: "file",
        file,
        x: Math.round(at.x + index * 24),
        y: Math.round(at.y + index * 24),
        width: 320,
        height: 220,
      }))
      .filter(isCard);
    if (cards.length) commit({ nodes: [...board.nodes, ...cards] });
  };
  replaceLatest.current = (id, text, path) => {
    const card = byId.get(id);
    if (!card || card.type !== "text" || card.text !== text) return;
    const { text: _text, ...rest } = card;
    replaceCard(card, { ...rest, type: "file", file: path });
  };
  const addUrl = async (card?: Card) => {
    const value = await files?.requestUrl?.(
      typeof card?.url === "string" ? card.url : undefined,
    );
    if (value == null || !alive.current) return;
    if (latestContent.current !== content) {
      files?.context.onError(t("Доска изменилась. Повторите действие."));
      return;
    }
    const url = httpUrl(value);
    if (!url) {
      files?.context.onError(t("Введите адрес HTTP или HTTPS."));
      return;
    }
    if (card) replaceCard(card, { ...card, url });
    else {
      const at = world(center());
      const node = {
        id: crypto.randomUUID(),
        type: "link",
        url,
        x: Math.round(at.x),
        y: Math.round(at.y),
        width: 300,
        height: 112,
      };
      if (isCard(node)) commit({ nodes: [...board.nodes, node] });
    }
  };
  const copySelection = (data: DataTransfer) => {
    const ids = movement(selectedIds);
    if (!ids.size) return false;
    const nodes = board.cards.filter((card) => ids.has(card.id));
    const edges = board.edges.filter(
      (edge) =>
        isRecord(edge) &&
        typeof edge.fromNode === "string" &&
        typeof edge.toNode === "string" &&
        ids.has(edge.fromNode) &&
        ids.has(edge.toNode),
    );
    const payload = JSON.stringify({
      nodes,
      edges,
      vault: files?.context.vaultId ?? "",
    });
    data.setData(clipboardType, payload);
    return true;
  };
  const pasteCards = (raw: string) => {
    if (!raw || raw.length > 8 * 1024 * 1024) return false;
    const copied = parse(raw);
    if (
      !copied ||
      copied.data.vault !== (files?.context.vaultId ?? "") ||
      !copied.cards.length
    )
      return false;
    const bounds = enclosing(copied.cards);
    const at = world(center());
    const ids = new Map(
      copied.cards.map((card) => [card.id, crypto.randomUUID()]),
    );
    const nodes = copied.cards.map((card) => ({
      ...card,
      id: ids.get(card.id)!,
      x: Math.round(at.x + card.x - bounds.left),
      y: Math.round(at.y + card.y - bounds.top),
    }));
    if (!nodes.every(isCard)) return false;
    const edges = copied.edges.flatMap((edge: unknown) => {
      if (
        !isRecord(edge) ||
        typeof edge.fromNode !== "string" ||
        typeof edge.toNode !== "string"
      )
        return [];
      const fromNode = ids.get(edge.fromNode),
        toNode = ids.get(edge.toNode);
      return fromNode && toNode
        ? [{ ...edge, id: crypto.randomUUID(), fromNode, toNode }]
        : [];
    });
    commit({
      nodes: [...board.nodes, ...nodes],
      edges: [...board.edges, ...edges],
    });
    setSelection({
      kind: "card",
      id: nodes[0].id,
      others: nodes.slice(1).map((card) => card.id),
    });
    return true;
  };
  const addGroup = () => {
    const cards = board.cards.filter((card) => selectedIds.includes(card.id));
    const point = world(center());
    const bounds = cards.length ? enclosing(cards) : null;
    const group = {
      id: crypto.randomUUID(),
      type: "group",
      label: t("Новая группа"),
      x: bounds ? bounds.left - 24 : Math.round(point.x),
      y: bounds ? bounds.top - 42 : Math.round(point.y),
      width: bounds ? bounds.right - bounds.left + 48 : 360,
      height: bounds ? bounds.bottom - bounds.top + 66 : 260,
    };
    if (!isCard(group)) return;
    commit({ nodes: [group, ...board.nodes] });
    setConnection(null);
    setSelection({ kind: "card", id: group.id });
    setEditing(group.id);
  };
  const connect = (id: string, source = connection) => {
    if (!source || source.id === id || !byId.has(source.id) || !byId.has(id))
      return;
    const edge = {
      id: crypto.randomUUID(),
      fromNode: source.id,
      fromSide: source.side,
      toNode: id,
    };
    commit({ edges: [...board.edges, edge] });
    setSelection({ kind: "edge", index: board.edges.length });
    setConnection(null);
  };
  const fit = () => {
    if (!board.cards.length) {
      setCamera({ x: 48, y: 48, zoom: 1 });
      return;
    }
    const bounds = enclosing(board.cards);
    const point = center();
    const zoom = Math.max(
      0.1,
      Math.min(
        1,
        (2 * point.x - 64) / (bounds.right - bounds.left),
        (2 * point.y - 64) / (bounds.bottom - bounds.top),
      ),
    );
    setCamera({
      x: point.x - ((bounds.left + bounds.right) * zoom) / 2,
      y: point.y - ((bounds.top + bounds.bottom) * zoom) / 2,
      zoom,
    });
  };
  const startDrag = (event: PointerEvent<Element>, target: Drag["target"]) => {
    if (gesture.current) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    gesture.current = {
      pointer: event.pointerId,
      start: { x: event.clientX, y: event.clientY },
      target,
    };
  };
  const delta = (event: PointerEvent, drag: Drag) => ({
    x: event.clientX - drag.start.x,
    y: event.clientY - drag.start.y,
  });
  const moveOffset = (drag: Drag, change: Point) => {
    let x = change.x / camera.zoom,
      y = change.y / camera.zoom;
    if (drag.target.kind !== "move") return { x, y };
    const anchor = byId.get(drag.target.anchor);
    if (!anchor) return { x, y };
    if (gridSnap) {
      x = Math.round((anchor.x + x) / 24) * 24 - anchor.x;
      y = Math.round((anchor.y + y) / 24) * 24 - anchor.y;
    }
    if (objectSnap) {
      const ids = drag.target.ids;
      const targets = board.cards.filter((card) => !ids.has(card.id));
      x =
        snapAxis(
          anchor.x + x,
          anchor.width,
          targets.flatMap((card) => [
            card.x,
            card.x + card.width / 2,
            card.x + card.width,
          ]),
          8 / camera.zoom,
        ) - anchor.x;
      y =
        snapAxis(
          anchor.y + y,
          anchor.height,
          targets.flatMap((card) => [
            card.y,
            card.y + card.height / 2,
            card.y + card.height,
          ]),
          8 / camera.zoom,
        ) - anchor.y;
    }
    return { x, y };
  };
  const selectionBox = (drag: Drag, event: PointerEvent) => {
    const rect = viewport.current?.getBoundingClientRect();
    return rect
      ? {
          start: { x: drag.start.x - rect.left, y: drag.start.y - rect.top },
          end: { x: event.clientX - rect.left, y: event.clientY - rect.top },
        }
      : null;
  };
  const updateDrag = (event: PointerEvent) => {
    const drag = gesture.current;
    if (drag?.pointer !== event.pointerId) return;
    const change = delta(event, drag);
    if (drag.target.kind === "pan") {
      const start = drag.target.camera;
      setCamera({ ...start, x: start.x + change.x, y: start.y + change.y });
    } else if (drag.target.kind === "select") {
      setMarquee(selectionBox(drag, event));
    } else if (drag.target.kind === "connection") {
      const rect = viewport.current?.getBoundingClientRect();
      if (rect)
        setWire({
          source: drag.target.source,
          point: world({
            x: event.clientX - rect.left,
            y: event.clientY - rect.top,
          }),
        });
    } else {
      setOffset(moveOffset(drag, change));
    }
  };
  const cancelDrag = (event: PointerEvent) => {
    if (gesture.current?.pointer !== event.pointerId) return;
    gesture.current = null;
    setOffset(null);
    setWire(null);
    setMarquee(null);
  };
  const finishDrag = (event: PointerEvent) => {
    const drag = gesture.current;
    if (drag?.pointer !== event.pointerId) return;
    const change = delta(event, drag);
    cancelDrag(event);
    if (drag.target.kind === "select") {
      const rect = selectionBox(drag, event);
      if (!rect) return;
      const a = world(rect.start),
        b = world(rect.end);
      const ids = board.cards
        .filter(
          (card) =>
            card.x >= Math.min(a.x, b.x) &&
            card.y >= Math.min(a.y, b.y) &&
            card.x + card.width <= Math.max(a.x, b.x) &&
            card.y + card.height <= Math.max(a.y, b.y),
        )
        .map((card) => card.id);
      setSelection(
        ids.length ? { kind: "card", id: ids[0], others: ids.slice(1) } : null,
      );
      return;
    }
    if (drag.target.kind === "connection") {
      if (Math.hypot(change.x, change.y) < 4) {
        if (!drag.target.replace) togglePort(drag.target.source);
        return;
      }
      const target = document
        .elementFromPoint(event.clientX, event.clientY)
        ?.closest<HTMLElement>("[data-canvas-node]");
      const id = target?.dataset.canvasNode;
      if (
        id &&
        target &&
        viewport.current?.contains(target) &&
        id !== drag.target.source.id
      ) {
        const replacement = drag.target.replace;
        if (replacement) {
          const edge: unknown = board.edges[replacement.index];
          if (isRecord(edge)) {
            const { fromSide, toSide, ...rest } = edge;
            const next =
              replacement.end === "from"
                ? { ...rest, fromNode: id, toSide }
                : { ...rest, toNode: id, fromSide };
            commit({
              edges: board.edges.map((value, i) =>
                i === replacement.index ? next : value,
              ),
            });
          }
        } else connect(id, drag.target.source);
      }
      return;
    }
    const snapped = moveOffset(drag, change);
    const dx = Math.round(snapped.x);
    const dy = Math.round(snapped.y);
    if (drag.target.kind === "move") move(drag.target.ids, dx, dy);
    else if (drag.target.kind === "resize") {
      const card = byId.get(drag.target.id);
      if (card) resize(card, drag.target.corner, { x: dx, y: dy });
    }
  };
  const togglePort = (source: Port) =>
    setConnection((current) =>
      current?.id === source.id && current.side === source.side ? null : source,
    );
  const wireCard = wire && byId.get(wire.source.id);
  const wireStart =
    wireCard && wire
      ? endpoint(position(wireCard), wire.source.side, wire.point)
      : null;
  const edgeIndex = selection?.kind === "edge" ? selection.index : -1;
  const edge: unknown = board.edges[edgeIndex];
  const updateEdge = (patch: RecordValue, edit?: string) => {
    if (isRecord(edge))
      commit(
        {
          edges: board.edges.map((value, i) =>
            i === edgeIndex ? { ...edge, ...patch } : value,
          ),
        },
        edit,
      );
  };
  const removeEdge = () => {
    commit({ edges: board.edges.filter((_, i) => i !== edgeIndex) });
    setSelection(null);
  };

  const selectedGroup =
    selectedIds.length === 1 ? byId.get(selectedIds[0]) : undefined;
  const groupOptions =
    selectedGroup?.type === "group" ? selectedGroup : undefined;
  const removeSelection = () => {
    if (isRecord(edge)) {
      removeEdge();
      return;
    }
    if (!selectedIds.length) return;
    commit({
      nodes: board.nodes.filter(
        (node) => !isCard(node) || !selectedIds.includes(node.id),
      ),
      edges: board.edges.filter(
        (value) =>
          !isRecord(value) ||
          !selectedIds.some(
            (id) => id === value.fromNode || id === value.toNode,
          ),
      ),
    });
    setSelection(null);
    setConnection(null);
  };

  return (
    <>
      <div
        ref={viewport}
        tabIndex={0}
        className="canvas-scroll"
        aria-label={t("Полотно доски")}
        onPointerDown={(event) => {
          if (
            event.target instanceof Element &&
            event.target.closest(".canvas-controls, .canvas-edge")
          )
            return;
          if (event.button !== 0 && event.button !== 1) return;
          setSelection(null);
          setEditing(null);
          setConnection(null);
          startDrag(
            event,
            event.button === 1 || space.current
              ? { kind: "pan", camera }
              : { kind: "select" },
          );
        }}
        onDragOver={(event) => {
          if (
            !files ||
            (!event.dataTransfer.types.includes(canvasFileDragType) &&
              !(
                files.importFiles && event.dataTransfer.types.includes("Files")
              ))
          )
            return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
        }}
        onDrop={(event) => {
          if (
            !files ||
            (!event.dataTransfer.types.includes(canvasFileDragType) &&
              !(
                files.importFiles && event.dataTransfer.types.includes("Files")
              ))
          )
            return;
          event.preventDefault();
          event.stopPropagation();
          const rect = event.currentTarget.getBoundingClientRect();
          const point = {
            x: event.clientX - rect.left,
            y: event.clientY - rect.top,
          };
          const dropped = Array.from(event.dataTransfer.files ?? []);
          if (dropped.length && files.importFiles) {
            const at = world(point);
            void files.importFiles(dropped).then((paths) => {
              if (alive.current) addImported.current(paths, at);
            });
            return;
          }
          const path = readCanvasFileDrag(
            event.dataTransfer.getData(canvasFileDragType),
            files.context.vaultId,
          );
          if (!path) {
            files.context.onError(
              t("Перетащите заметку или вложение из текущего хранилища."),
            );
            return;
          }
          addCard(point, path);
        }}
        onPointerMove={updateDrag}
        onPointerUp={finishDrag}
        onPointerCancel={cancelDrag}
        onLostPointerCapture={cancelDrag}
        onDoubleClick={(event) => {
          if (event.target !== event.currentTarget) return;
          const rect = event.currentTarget.getBoundingClientRect();
          addCard({
            x: event.clientX - rect.left,
            y: event.clientY - rect.top,
          });
        }}
        onCopy={(event) => {
          if (
            event.target instanceof Element &&
            event.target.closest(
              "textarea, input, [contenteditable], [data-canvas-note-editor]",
            )
          )
            return;
          if (copySelection(event.clipboardData)) event.preventDefault();
        }}
        onPaste={(event) => {
          if (
            event.target instanceof Element &&
            event.target.closest(
              "textarea, input, [contenteditable], [data-canvas-note-editor]",
            )
          )
            return;
          if (pasteCards(event.clipboardData.getData(clipboardType)))
            event.preventDefault();
        }}
        onKeyUp={(event) => {
          if (event.code === "Space") space.current = false;
        }}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget))
            space.current = false;
        }}
        onKeyDown={(event) => {
          if (
            event.code === "Space" &&
            !(
              event.target instanceof Element &&
              event.target.closest(
                "textarea, input, select, button, [contenteditable]",
              )
            )
          ) {
            space.current = true;
            event.preventDefault();
            return;
          }
          if (
            gesture.current ||
            event.nativeEvent.isComposing ||
            (event.target instanceof Element &&
              event.target.closest(
                "textarea, input, select, [contenteditable]",
              ))
          )
            return;
          const key = shortcutFromEvent(event);
          if (
            key === binding(shortcuts, "undo") ||
            key === binding(shortcuts, "redo")
          ) {
            event.preventDefault();
            stepHistory(key === binding(shortcuts, "redo"));
            return;
          }
          if (
            (event.key === "Delete" || event.key === "Backspace") &&
            selection
          ) {
            event.preventDefault();
            removeSelection();
            return;
          }
          if (event.key === "Escape" && connection) {
            event.stopPropagation();
            setConnection(null);
          }
        }}
      >
        <div
          className="canvas-surface"
          style={{
            transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})`,
          }}
        >
          <svg className="canvas-edges">
            <defs>
              <marker
                id={arrow}
                markerWidth="8"
                markerHeight="8"
                refX="7"
                refY="4"
                orient="auto-start-reverse"
              >
                <path d="M0 0 L8 4 L0 8 Z" fill="currentColor" />
              </marker>
            </defs>
            {board.edges.map((value: unknown, index) => {
              if (
                !isRecord(value) ||
                typeof value.fromNode !== "string" ||
                typeof value.toNode !== "string"
              )
                return null;
              const from = byId.get(value.fromNode);
              const to = byId.get(value.toNode);
              if (!from || !to) return null;
              const start = position(from);
              const end = position(to);
              const a = endpoint(start, value.fromSide, {
                x: end.x + end.width / 2,
                y: end.y + end.height / 2,
              });
              const b = endpoint(end, value.toSide, {
                x: start.x + start.width / 2,
                y: start.y + start.height / 2,
              });
              const line = { x1: a.x, y1: a.y, x2: b.x, y2: b.y };
              return (
                <g
                  key={index}
                  className="canvas-edge"
                  data-selected={edgeIndex === index}
                  role="button"
                  tabIndex={0}
                  aria-label={
                    typeof value.label === "string" && value.label
                      ? value.label
                      : t("Связь")
                  }
                  aria-pressed={edgeIndex === index}
                  onClick={() => {
                    setConnection(null);
                    setSelection({ kind: "edge", index });
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" && event.key !== " ") return;
                    event.preventDefault();
                    setConnection(null);
                    setSelection({ kind: "edge", index });
                  }}
                >
                  <line {...line} className="canvas-edge-hit" />
                  <line
                    {...line}
                    className="canvas-edge-line"
                    markerStart={
                      value.fromEnd === "arrow" ? `url(#${arrow})` : undefined
                    }
                    markerEnd={
                      value.toEnd !== "none" ? `url(#${arrow})` : undefined
                    }
                  />
                  {typeof value.label === "string" && (
                    <text
                      x={(a.x + b.x) / 2}
                      y={(a.y + b.y) / 2 - 5}
                      textAnchor="middle"
                    >
                      {value.label}
                    </text>
                  )}
                  {edgeIndex === index &&
                    (
                      [
                        ["from", a, to, value.toSide],
                        ["to", b, from, value.fromSide],
                      ] as const
                    ).map(([end, at, opposite, side]) => (
                      <circle
                        key={end}
                        className="canvas-edge-handle"
                        cx={at.x}
                        cy={at.y}
                        r={6}
                        onPointerDown={(event) => {
                          if (event.button !== 0) return;
                          event.stopPropagation();
                          const fixedSide =
                            sides.find((candidate) => candidate === side) ??
                            "right";
                          startDrag(event, {
                            kind: "connection",
                            source: { id: opposite.id, side: fixedSide },
                            replace: { index, end },
                          });
                        }}
                      />
                    ))}
                </g>
              );
            })}
            {wire && wireStart && (
              <line
                className="canvas-edge-line"
                x1={wireStart.x}
                y1={wireStart.y}
                x2={wire.point.x}
                y2={wire.point.y}
              />
            )}
          </svg>
          {board.cards.map((card) => {
            const { x, y, width, height } = position(card);
            const selected = selectedIds.includes(card.id);
            const group = card.type === "group";
            const url = typeof card.url === "string" ? httpUrl(card.url) : null;
            const color = canvasColor(card.color);
            const handles =
              selected && selectedIds.length === 1 && editing !== card.id;
            const label =
              card.type === "text"
                ? card.text
                : card.type === "file"
                  ? card.file
                  : card.type === "group"
                    ? card.label
                    : card.url;
            const editCard = () => {
              if (
                card.type === "file" &&
                canvasFilePath(card.file) &&
                markdownFile.test(card.file) &&
                files?.edit
              ) {
                const path = card.file;
                void files.edit(path).then((ok) => {
                  if (ok && alive.current) setEditing(card.id);
                });
                return;
              }
              if (card.type === "link") {
                void addUrl(card);
                return;
              }
              if (card.type !== "text" && !group) return;
              setSelection({ kind: "card", id: card.id });
              setEditing(card.id);
            };
            return (
              <div
                className={group ? "canvas-card canvas-group" : "canvas-card"}
                data-selected={selected}
                data-canvas-node={card.id}
                onFocus={(event) => {
                  if (
                    event.target === event.currentTarget &&
                    !connection &&
                    !selected
                  )
                    setSelection({ kind: "card", id: card.id });
                }}
                key={card.id}
                tabIndex={0}
                style={{
                  left: x,
                  top: y,
                  width,
                  height,
                  borderColor: color,
                  backgroundColor:
                    group && color
                      ? `color-mix(in srgb, ${color} 12%, var(--base))`
                      : undefined,
                }}
                onPointerDown={(event) => {
                  if (event.button === 1 || space.current) return;
                  event.stopPropagation();
                  if (
                    event.button !== 0 ||
                    (event.target instanceof Element &&
                      event.target.closest(
                        "textarea, button, a, input, select, video, audio, [data-canvas-note-editor]",
                      ))
                  )
                    return;
                  if (connection) return;
                  if (event.shiftKey) {
                    event.preventDefault();
                    viewport.current?.focus({ preventScroll: true });
                    const ids = selected
                      ? selectedIds.filter((id) => id !== card.id)
                      : [card.id, ...selectedIds];
                    setSelection(
                      ids.length
                        ? { kind: "card", id: ids[0], others: ids.slice(1) }
                        : null,
                    );
                    return;
                  }
                  const ids = selected ? selectedIds : [card.id];
                  if (!selected) setSelection({ kind: "card", id: card.id });
                  setEditing(null);
                  startDrag(event, {
                    kind: "move",
                    ids: movement(ids),
                    anchor: card.id,
                  });
                }}
                onClick={(event) => {
                  if (
                    connection &&
                    !(
                      event.target instanceof Element &&
                      event.target.closest(
                        "textarea, button, a, input, select, video, audio, [data-canvas-note-editor]",
                      )
                    )
                  )
                    connect(card.id);
                }}
                onDoubleClick={editCard}
                onKeyDown={(event) => {
                  if (event.target !== event.currentTarget) return;
                  if (event.key === "Enter") {
                    if (connection) connect(card.id);
                    else editCard();
                    return;
                  }
                  const dx =
                    event.key === "ArrowLeft"
                      ? -1
                      : event.key === "ArrowRight"
                        ? 1
                        : 0;
                  const dy =
                    event.key === "ArrowUp"
                      ? -1
                      : event.key === "ArrowDown"
                        ? 1
                        : 0;
                  if (!dx && !dy) return;
                  event.preventDefault();
                  const step = event.shiftKey ? 10 : 1;
                  move(
                    movement(selected ? selectedIds : [card.id]),
                    dx * step,
                    dy * step,
                  );
                }}
              >
                {group &&
                  files &&
                  canvasFilePath(card.background) &&
                  imageExtension(card.background) && (
                    <CanvasGroupBackground
                      key={card.background}
                      vaultId={files.context.vaultId}
                      path={card.background}
                      mode={
                        card.backgroundStyle === "ratio" ||
                        card.backgroundStyle === "repeat"
                          ? card.backgroundStyle
                          : "cover"
                      }
                    />
                  )}
                {editing === card.id &&
                card.type === "file" &&
                typeof card.file === "string" &&
                files?.editor ? (
                  <>
                    <div className="canvas-note-actions">
                      {files.saveNote && (
                        <button
                          type="button"
                          onClick={() => {
                            if (typeof card.file === "string")
                              files.saveNote?.(card.file);
                          }}
                        >
                          {t("Сохранить заметку")}
                        </button>
                      )}
                      <button type="button" onClick={() => setEditing(null)}>
                        {t("Готово")}
                      </button>
                    </div>
                    {files.editor(card.file)}
                  </>
                ) : card.type === "link" && typeof card.url === "string" ? (
                  <div className="canvas-card-content canvas-link-card">
                    <span>{card.url}</span>
                    {url && (
                      <button
                        type="button"
                        onClick={() =>
                          void api
                            .openExternal(url)
                            .catch((error) =>
                              files?.context.onError(errorMessage(error)),
                            )
                        }
                      >
                        {t("Открыть в браузере")}
                      </button>
                    )}
                  </div>
                ) : editing === card.id && group ? (
                  <input
                    autoFocus
                    className="canvas-group-label"
                    aria-label={t("Название группы")}
                    value={typeof card.label === "string" ? card.label : ""}
                    onChange={(event) =>
                      replaceCard(
                        card,
                        { ...card, label: event.currentTarget.value },
                        card.id,
                      )
                    }
                    onBlur={() => {
                      history.finishEdit();
                      setEditing(null);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === "Escape") {
                        event.preventDefault();
                        event.stopPropagation();
                        event.currentTarget.parentElement?.focus();
                      }
                    }}
                  />
                ) : editing === card.id && card.type === "text" ? (
                  <textarea
                    autoFocus
                    aria-label={t("Текст карточки")}
                    value={typeof card.text === "string" ? card.text : ""}
                    onChange={(event) =>
                      replaceCard(
                        card,
                        {
                          ...card,
                          text: event.currentTarget.value,
                        },
                        card.id,
                      )
                    }
                    onBlur={() => {
                      history.finishEdit();
                      setEditing(null);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") {
                        event.stopPropagation();
                        event.currentTarget.parentElement?.focus();
                      }
                    }}
                  />
                ) : files &&
                  card.type === "file" &&
                  typeof card.file === "string" ? (
                  <CanvasFileCard
                    key={card.file}
                    file={card.file}
                    subpath={
                      typeof card.subpath === "string" &&
                      card.subpath.startsWith("#")
                        ? card.subpath
                        : undefined
                    }
                    files={files}
                  />
                ) : (
                  <div
                    className={
                      group ? "canvas-group-label" : "canvas-card-content"
                    }
                  >
                    {typeof label === "string" && label ? label : t("Карточка")}
                  </div>
                )}
                {handles &&
                  corners.map((corner) => (
                    <button
                      type="button"
                      key={corner}
                      className={`canvas-resize canvas-resize-${corner}`}
                      aria-label={
                        t("Изменить размер") + " · " + t(cornerLabels[corner])
                      }
                      onPointerDown={(event) => {
                        if (event.button !== 0) return;
                        event.stopPropagation();
                        startDrag(event, {
                          kind: "resize",
                          id: card.id,
                          corner,
                        });
                      }}
                      onKeyDown={(event) => {
                        const dx =
                          event.key === "ArrowLeft"
                            ? -1
                            : event.key === "ArrowRight"
                              ? 1
                              : 0;
                        const dy =
                          event.key === "ArrowUp"
                            ? -1
                            : event.key === "ArrowDown"
                              ? 1
                              : 0;
                        if (!dx && !dy) return;
                        event.preventDefault();
                        event.stopPropagation();
                        const step = event.shiftKey ? 10 : 1;
                        resize(card, corner, { x: dx * step, y: dy * step });
                      }}
                    />
                  ))}
                {handles &&
                  sides.map((side) => (
                    <button
                      key={side}
                      type="button"
                      className={`canvas-port canvas-port-${side}`}
                      aria-label={
                        t("Начать связь") + " · " + t(sideLabels[side])
                      }
                      aria-pressed={
                        connection?.id === card.id && connection.side === side
                      }
                      onPointerDown={(event) => {
                        if (event.button !== 0) return;
                        event.stopPropagation();
                        startDrag(event, {
                          kind: "connection",
                          source: { id: card.id, side },
                        });
                      }}
                      onClick={(event) => {
                        event.stopPropagation();
                        if (event.detail === 0)
                          togglePort({ id: card.id, side });
                      }}
                    />
                  ))}
              </div>
            );
          })}
        </div>
        {marquee && (
          <div
            className="canvas-marquee"
            style={{
              left: Math.min(marquee.start.x, marquee.end.x),
              top: Math.min(marquee.start.y, marquee.end.y),
              width: Math.abs(marquee.start.x - marquee.end.x),
              height: Math.abs(marquee.start.y - marquee.end.y),
            }}
          />
        )}
        <div
          className="canvas-controls canvas-add"
          role="group"
          aria-label={t("Добавить на доску")}
        >
          <button
            type="button"
            className="icon-button"
            aria-label={t("Добавить карточку")}
            data-tooltip={t("Добавить карточку")}
            onClick={() => addCard(center())}
          >
            <StickyNote size={17} />
          </button>
          {files && (
            <button
              type="button"
              className="icon-button"
              aria-label={t("Добавить файл")}
              data-tooltip={t("Добавить файл")}
              onClick={() => setChooseFile("card")}
            >
              <FilePlus2 size={17} />
            </button>
          )}
          {files?.requestUrl && (
            <button
              type="button"
              className="icon-button"
              aria-label={t("Добавить веб-страницу")}
              data-tooltip={t("Добавить веб-страницу")}
              onClick={() => void addUrl()}
            >
              <Link2 size={17} />
            </button>
          )}
          <button
            type="button"
            className="icon-button"
            aria-label={t("Создать группу")}
            data-tooltip={t("Создать группу")}
            onClick={addGroup}
          >
            <Group size={17} />
          </button>
        </div>
        {settings && (
          <div className="canvas-controls canvas-settings">
            <label>
              <input
                type="checkbox"
                checked={gridSnap}
                onChange={(event) => setGridSnap(event.currentTarget.checked)}
              />
              {t("Привязка к сетке")}
            </label>
            <label>
              <input
                type="checkbox"
                checked={objectSnap}
                onChange={(event) => setObjectSnap(event.currentTarget.checked)}
              />
              {t("Привязка к карточкам")}
            </label>
          </div>
        )}
        <div className="canvas-controls canvas-zoom">
          <button
            type="button"
            aria-label={t("Настройки доски")}
            aria-expanded={settings}
            onClick={() => setSettings((value) => !value)}
          >
            <Settings2 size={16} />
          </button>
          <button
            type="button"
            aria-label={t("Отменить")}
            disabled={!history.canUndo}
            onClick={() => stepHistory(false)}
          >
            <Undo2 size={16} />
          </button>
          <button
            type="button"
            aria-label={t("Повторить")}
            disabled={!history.canRedo}
            onClick={() => stepHistory(true)}
          >
            <Redo2 size={16} />
          </button>
          <button
            type="button"
            aria-label={t("Приблизить")}
            onClick={() => setCamera(zoomAt(camera, center(), 1.25))}
          >
            <Plus size={16} />
          </button>
          <button
            type="button"
            aria-label={t("Отдалить")}
            onClick={() => setCamera(zoomAt(camera, center(), 0.8))}
          >
            <Minus size={16} />
          </button>
          <button
            type="button"
            aria-label={t("Показать всю доску")}
            onClick={fit}
          >
            <Maximize size={16} />
          </button>
        </div>
        {selectedIds.length > 0 && !editing && !connection && (
          <div className="canvas-controls canvas-selection">
            {selectedIds.length === 1 &&
              files?.convert &&
              byId.get(selectedIds[0])?.type === "text" && (
                <button
                  type="button"
                  onClick={() => {
                    const card = byId.get(selectedIds[0]);
                    if (!card || typeof card.text !== "string") return;
                    const text = card.text;
                    void files.convert?.(text).then((path) => {
                      if (path && alive.current)
                        replaceLatest.current(card.id, text, path);
                    });
                  }}
                >
                  {t("Преобразовать в заметку")}
                </button>
              )}
            {groupOptions && (
              <>
                <select
                  aria-label={t("Цвет группы")}
                  value={
                    typeof groupOptions.color === "string"
                      ? groupOptions.color
                      : ""
                  }
                  onChange={(event) => {
                    const { color: _color, ...rest } = groupOptions;
                    const color = event.currentTarget.value;
                    replaceCard(
                      groupOptions,
                      color ? { ...rest, color } : rest,
                    );
                  }}
                >
                  <option value="">{t("Цвет по умолчанию")}</option>
                  {Object.entries(colors).map(([id, color]) => (
                    <option key={id} value={id}>
                      {color}
                    </option>
                  ))}
                  {typeof groupOptions.color === "string" &&
                    !Object.hasOwn(colors, groupOptions.color) && (
                      <option value={groupOptions.color}>
                        {groupOptions.color}
                      </option>
                    )}
                </select>
                {files && (
                  <button
                    type="button"
                    onClick={() => setChooseFile({ group: groupOptions.id })}
                  >
                    {t("Фон группы")}
                  </button>
                )}
                {files && typeof groupOptions.background === "string" && (
                  <>
                    <select
                      aria-label={t("Масштаб фона")}
                      value={
                        groupOptions.backgroundStyle === "ratio" ||
                        groupOptions.backgroundStyle === "repeat"
                          ? groupOptions.backgroundStyle
                          : "cover"
                      }
                      onChange={(event) =>
                        replaceCard(groupOptions, {
                          ...groupOptions,
                          backgroundStyle: event.currentTarget.value,
                        })
                      }
                    >
                      <option value="cover">{t("Заполнить")}</option>
                      <option value="ratio">{t("Вписать")}</option>
                      <option value="repeat">{t("Повторять")}</option>
                    </select>
                    <button
                      type="button"
                      onClick={() => {
                        const {
                          background: _background,
                          backgroundStyle: _style,
                          ...rest
                        } = groupOptions;
                        replaceCard(groupOptions, rest);
                      }}
                    >
                      {t("Убрать фон")}
                    </button>
                  </>
                )}
              </>
            )}
            <button
              type="button"
              aria-label={t("Удалить выбранное")}
              onClick={removeSelection}
            >
              <Trash2 size={16} />
            </button>
          </div>
        )}
        {connection && (
          <div className="canvas-controls canvas-selection" role="status">
            {t("Выберите карточку для связи")}
          </div>
        )}
        {isRecord(edge) && (
          <div className="canvas-controls canvas-selection">
            <input
              aria-label={t("Подпись связи")}
              placeholder={t("Подпись связи")}
              value={typeof edge.label === "string" ? edge.label : ""}
              onChange={(event) =>
                updateEdge(
                  { label: event.currentTarget.value },
                  `edge-${edgeIndex}`,
                )
              }
            />
            <select
              aria-label={t("Направление связи")}
              value={
                edge.fromEnd === "arrow"
                  ? edge.toEnd === "none"
                    ? "backward"
                    : "both"
                  : edge.toEnd === "none"
                    ? "none"
                    : "forward"
              }
              onChange={(event) => {
                const direction = event.currentTarget.value;
                updateEdge({
                  fromEnd:
                    direction === "backward" || direction === "both"
                      ? "arrow"
                      : "none",
                  toEnd:
                    direction === "forward" || direction === "both"
                      ? "arrow"
                      : "none",
                });
              }}
            >
              <option value="none">{t("Без стрелок")}</option>
              <option value="forward">→</option>
              <option value="backward">←</option>
              <option value="both">↔</option>
            </select>
            <button
              type="button"
              aria-label={t("Удалить связь")}
              onClick={removeEdge}
            >
              <Trash2 size={16} />
            </button>
          </div>
        )}
      </div>
      {files && chooseFile && (
        <Modal
          title={t(
            chooseFile === "card"
              ? "Добавить файл на доску"
              : "Выбрать фон группы",
          )}
          className="canvas-file-picker"
          onClose={() => setChooseFile(null)}
        >
          <FileTree
            vaultId={files.context.vaultId}
            refresh={refresh}
            active={null}
            includeFile={
              chooseFile === "card"
                ? isCanvasAttachment
                : (path) => !!imageExtension(path)
            }
            onFolder={() => undefined}
            onOpen={(path) => {
              if (chooseFile === "card") addCard(center(), path);
              else {
                const group = byId.get(chooseFile.group);
                if (
                  group?.type === "group" &&
                  canvasFilePath(path) &&
                  imageExtension(path)
                )
                  replaceCard(group, { ...group, background: path });
              }
              setChooseFile(null);
            }}
          />
        </Modal>
      )}
    </>
  );
}

const sideLabels: Record<Side, string> = {
  left: "Слева",
  right: "Справа",
  top: "Сверху",
  bottom: "Снизу",
};

const cornerLabels: Record<Corner, string> = {
  nw: "Сверху слева",
  ne: "Сверху справа",
  sw: "Снизу слева",
  se: "Снизу справа",
};
