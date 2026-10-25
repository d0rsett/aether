import type { Workspace } from "./model";
import { dirty } from "./model";

export interface Draft {
  content: string;
  revision: string;
}
interface StoredWorkspace {
  paths: string[];
  active: string | null;
  drafts: Record<string, Draft>;
}
const key = (id: string) => `aether.workspace.v1:${id}`;

export function readWorkspace(id: string): StoredWorkspace {
  const empty: StoredWorkspace = { paths: [], active: null, drafts: {} };
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(key(id)) ?? "null");
    if (
      !parsed ||
      typeof parsed !== "object" ||
      !("paths" in parsed) ||
      !Array.isArray(parsed.paths)
    )
      return empty;
    const record = parsed as Record<string, unknown>;
    const drafts: Record<string, Draft> = {};
    if (record.drafts && typeof record.drafts === "object") {
      for (const [path, draft] of Object.entries(record.drafts)) {
        if (
          draft &&
          typeof draft === "object" &&
          "content" in draft &&
          "revision" in draft &&
          typeof draft.content === "string" &&
          typeof draft.revision === "string"
        )
          drafts[path] = { content: draft.content, revision: draft.revision };
      }
    }
    return {
      paths: parsed.paths.filter((p): p is string => typeof p === "string"),
      active: typeof record.active === "string" ? record.active : null,
      drafts,
    };
  } catch {
    return empty;
  }
}

export function writeWorkspace(id: string, state: Workspace): void {
  const drafts = Object.fromEntries(
    state.tabs
      .filter(dirty)
      .map((t) => [t.path, { content: t.content, revision: t.revision }]),
  );
  localStorage.setItem(
    key(id),
    JSON.stringify({
      paths: state.tabs.map((t) => t.path),
      active: state.active,
      drafts,
    }),
  );
}
