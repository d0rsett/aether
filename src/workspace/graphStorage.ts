import { defaultForces, type Forces } from "../graph/model";
export interface GraphViewState {
  query: string;
  local: boolean;
  root: string | null;
  depth: number;
  orphans: boolean;
  labels: boolean;
  size: number;
  thickness: number;
  forces: Forces;
  settings: boolean;
  camera: { x: number; y: number; zoom: number };
  positions: [string, number, number, boolean][];
}
export const defaultGraphView = (): GraphViewState => ({
  query: "",
  local: false,
  root: null,
  depth: 1,
  orphans: true,
  labels: true,
  size: 1,
  thickness: 1,
  forces: { ...defaultForces },
  settings: true,
  camera: { x: 0, y: 0, zoom: 1 },
  positions: [],
});
const key = (id: string) => `aether.graph.v1:${id}`;
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const number = (value: unknown, fallback: number, min: number, max: number) =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.max(min, Math.min(max, value))
    : fallback;
export function readGraphView(id: string): GraphViewState {
  const initial = defaultGraphView();
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(key(id)) ?? "null"),
      value = record(raw);
    const camera = record(value.camera),
      forces = record(value.forces);
    for (const field of ["local", "orphans", "labels", "settings"] as const)
      if (typeof value[field] === "boolean") initial[field] = value[field];
    initial.query =
      typeof value.query === "string" ? value.query.slice(0, 2000) : "";
    initial.root = typeof value.root === "string" ? value.root : null;
    initial.depth = Math.round(number(value.depth, 1, 1, 5));
    initial.size = number(value.size, 1, 0.5, 3);
    initial.thickness = number(value.thickness, 1, 0.5, 3);
    initial.camera = {
      x: number(camera.x, 0, -1e7, 1e7),
      y: number(camera.y, 0, -1e7, 1e7),
      zoom: number(camera.zoom, 1, 0.15, 5),
    };
    initial.forces = {
      center: number(forces.center, 0.5, 0, 2),
      repel: number(forces.repel, 1, 0, 3),
      strength: number(forces.strength, 0.5, 0, 2),
      distance: number(forces.distance, 100, 30, 250),
    };
    if (Array.isArray(value.positions))
      for (const item of value.positions.slice(0, 50000)) {
        if (
          Array.isArray(item) &&
          typeof item[0] === "string" &&
          typeof item[1] === "number" &&
          Number.isFinite(item[1]) &&
          Math.abs(item[1]) <= 1e7 &&
          typeof item[2] === "number" &&
          Number.isFinite(item[2]) &&
          Math.abs(item[2]) <= 1e7
        )
          initial.positions.push([item[0], item[1], item[2], item[3] === true]);
      }
  } catch {
    /* A corrupt view never affects note contents. */
  }
  return initial;
}
export function writeGraphView(id: string, state: GraphViewState): void {
  localStorage.setItem(key(id), JSON.stringify(state));
}
export function readGraphTab(id: string): { open: boolean; active: boolean } {
  try {
    const value = record(
      JSON.parse(localStorage.getItem(`aether.graph-tab.v1:${id}`) ?? "null"),
    );
    return {
      open: value.open === true,
      active: value.open === true && value.active === true,
    };
  } catch {
    return { open: false, active: false };
  }
}
export function writeGraphTab(
  id: string,
  open: boolean,
  active: boolean,
): void {
  localStorage.setItem(
    `aether.graph-tab.v1:${id}`,
    JSON.stringify({ open, active: open && active }),
  );
}
