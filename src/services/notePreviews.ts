import type { Tab } from "../workspace/model";

interface PreviewSnapshot {
  vaultId: string | undefined;
  notes: ReadonlyMap<string, string>;
  diskRevision: number;
}

// Shared by Reading and the independent React roots mounted in CodeMirror.
// Open buffers take precedence over disk; this store never writes note files.
export class NotePreviews {
  private snapshot: PreviewSnapshot = {
    vaultId: undefined,
    notes: new Map(),
    diskRevision: 0,
  };
  private listeners = new Set<() => void>();
  private active = 0;
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  update(
    vaultId: string | undefined,
    tabs: readonly Tab[],
    diskRevision: number,
  ) {
    const notes = new Map(
      tabs
        .filter((tab) => tab.kind !== "image")
        .map((tab) => [tab.path, tab.content]),
    );
    const previous = this.snapshot;
    if (
      previous.vaultId === vaultId &&
      previous.diskRevision === diskRevision &&
      previous.notes.size === notes.size &&
      [...notes].every(
        ([path, content]) => previous.notes.get(path) === content,
      )
    )
      return;
    this.snapshot = { vaultId, notes, diskRevision };
    this.listeners.forEach((listener) => listener());
  }
  acquire() {
    if (this.active >= 48) return null;
    this.active++;
    return () => {
      this.active--;
    };
  }
}
