import { invoke, isTauri } from "@tauri-apps/api/core";

export interface VaultInfo {
  id: string;
  name: string;
  path: string;
}
export interface FileEntry {
  path: string;
  name: string;
  isDirectory: boolean;
}
export interface Note {
  path: string;
  content: string;
  revision: string;
}
export interface AppError {
  code: string;
  message?: string;
}
export interface AnchorLocation {
  from: number;
  to: number;
  line: number;
}
export interface RenderNode {
  from: number;
  to: number;
  kind: string;
  text: string;
  target: string;
  level: number;
  line: number;
  endLine: number;
  children: RenderNode[];
}
export interface RenderDocument {
  nodes: RenderNode[];
  warning: string | null;
}
export interface RenameChange {
  path: string;
  line: number;
  before: string;
  after: string;
}
export interface RenamePreview {
  token: string;
  from: string;
  to: string;
  files: number;
  links: number;
  unresolved: number;
  changes: RenameChange[];
  hasMore: boolean;
  affectedOpenPaths: string[];
}
export interface RenameState {
  id: string;
  from: string;
  to: string;
  pending: boolean;
  affectedOpenPaths: string[];
}
export interface RenameApplied {
  from: string;
  note: Note;
  directory?: boolean;
}

export const desktop = isTauri();
export interface IndexStatus {
  running: boolean;
  indexed: number;
  errors: number;
  revision: number;
  message: string | null;
}
export interface SearchQuery {
  text: string;
  path: string;
  tag: string;
  property: string;
  value: string;
  offset: number;
}
export interface SearchHit {
  path: string;
  title: string;
  snippet: string;
}
export interface SearchPage {
  hits: SearchHit[];
  hasMore: boolean;
}
export interface Resolution {
  status: "resolved" | "missing" | "ambiguous";
  path: string | null;
  candidates: string[];
  createPath: string | null;
}
export interface WikiLink {
  target: string;
  alias: string | null;
  anchor: string | null;
  embedded: boolean;
  line: number;
}
export interface Inspection {
  metadata: {
    title: string;
    tags: string[];
    properties: Record<string, unknown>;
    warning: string | null;
    headings: { title: string; level: number; line: number }[];
  };
  backlinks: { path: string; title: string; line: number }[];
  outgoing: (WikiLink & { resolution: Resolution })[];
}
export const api = {
  renameDirectory: (vaultId: string, path: string, name: string) =>
    invoke<RenameApplied>("rename_directory", { vaultId, path, name }),
  trashDirectory: (vaultId: string, path: string) =>
    invoke<{ trash: string }>("trash_directory", { vaultId, path }),
  reveal: (vaultId: string, path = "") =>
    invoke<void>("reveal_in_explorer", { vaultId, path }),
  anchorOptions: (vaultId: string, path: string, content: string) =>
    invoke<string[]>("anchor_options", { vaultId, path, content }),
  renderMarkdown: (vaultId: string, path: string, content: string) =>
    invoke<RenderDocument>("render_markdown", { vaultId, path, content }),
  readImage: (vaultId: string, source: string, target: string, wiki: boolean) =>
    invoke<string>("read_image", { vaultId, source, target, wiki }),
  documentLink: (vaultId: string, source: string, target: string) =>
    invoke<string>("document_link", { vaultId, source, target }),
  openExternal: (url: string) => invoke<void>("open_external", { url }),
  restore: () => invoke<VaultInfo | null>("restore_vault"),
  choose: () => invoke<VaultInfo | null>("choose_vault"),
  vaults: () => invoke<VaultInfo[]>("list_vaults"),
  switchVault: (vaultId: string) =>
    invoke<VaultInfo>("switch_vault", { vaultId }),
  createVault: (name: string) =>
    invoke<VaultInfo | null>("create_vault", { name }),
  list: (vaultId: string, path: string) =>
    invoke<FileEntry[]>("list_directory", { vaultId, path }),
  read: (vaultId: string, path: string) =>
    invoke<Note>("read_note", { vaultId, path }),
  save: (vaultId: string, path: string, content: string, revision: string) =>
    invoke<string>("save_note", { vaultId, path, content, revision }),
  create: (vaultId: string, path: string, content = "") =>
    invoke<Note>("create_note", { vaultId, path, content }),
  mkdir: (vaultId: string, path: string) =>
    invoke<void>("create_directory", { vaultId, path }),
  previewRename: (
    vaultId: string,
    path: string,
    newPath: string,
    revision: string,
    openPaths: string[],
  ) =>
    invoke<RenamePreview>("preview_rename", {
      vaultId,
      path,
      newPath,
      revision,
      openPaths,
    }),
  renamePage: (
    vaultId: string,
    token: string,
    offset: number,
    openPaths: string[],
  ) =>
    invoke<RenamePreview>("rename_preview_page", {
      vaultId,
      token,
      offset,
      openPaths,
    }),
  applyRename: (vaultId: string, token: string) =>
    invoke<RenameApplied>("apply_rename", { vaultId, token }),
  renameState: (vaultId: string, openPaths: string[]) =>
    invoke<RenameState | null>("rename_state", { vaultId, openPaths }),
  undoRename: (vaultId: string, id: string, recover: boolean) =>
    invoke<RenameApplied>("undo_rename", { vaultId, id, recover }),
  locateAnchor: (
    vaultId: string,
    path: string,
    content: string,
    anchor: string,
  ) =>
    invoke<AnchorLocation>("locate_anchor", { vaultId, path, content, anchor }),
  trash: (vaultId: string, path: string, revision: string) =>
    invoke<string>("trash_note", { vaultId, path, revision }),
  indexStatus: (vaultId: string) =>
    invoke<IndexStatus>("index_status", { vaultId }),
  inspect: (vaultId: string, path: string) =>
    invoke<Inspection>("inspect_note", { vaultId, path }),
  search: (vaultId: string, query: SearchQuery) =>
    invoke<SearchPage>("search_notes", { vaultId, query }),
  resolve: (vaultId: string, source: string, target: string) =>
    invoke<Resolution>("resolve_link", { vaultId, source, target }),
};

export function errorMessage(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error) {
    const detail = error as AppError;
    if (detail.code === "Conflict")
      return "Файл изменился на диске. Ваш текст сохранён в редакторе. Сохраните копию или перечитайте файл.";
    if (detail.code === "AlreadyExists")
      return "Файл или папка с таким именем уже существует.";
    if (detail.code === "NoVault") return "Откройте хранилище заново.";
    return detail.message ?? detail.code;
  }
  return error instanceof Error ? error.message : String(error);
}
