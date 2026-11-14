import { useLayoutEffect, useRef } from "react";
import type { GroupId } from "../workspace/groups";
import type { Tab, Workspace } from "../workspace/model";

interface Placement {
  group?: GroupId;
  slot: number;
}

// Keep the existing editor mounted when a tab is moved. When two views
// collapse into one, keep the surviving group's selection and scroll position.
export function useEditorPanels(
  vault: string | undefined,
  workspace: Workspace,
) {
  const previous = useRef<{
    vault?: string;
    placements: Map<string, Placement[]>;
  }>({
    placements: new Map(),
  });
  const placements = new Map<string, Placement[]>();
  const panels = workspace.tabs.flatMap((tab) => {
    const groups = workspace.groups;
    const owners = groups
      ? (["primary", "secondary"] as const).filter((group) =>
          groups[group].tabs.includes(tab.path),
        )
      : [undefined];
    const old =
      previous.current.vault === vault
        ? (previous.current.placements.get(tab.path) ?? [])
        : [];
    const slots = new Set<number>();
    const entries = owners.map((group) => {
      const existing = old.find(
        (entry) => entry.group === (group ?? workspace.lastGroup),
      );
      const slot = existing?.slot;
      if (slot !== undefined) slots.add(slot);
      return { group, slot };
    });
    const assigned = entries.map(({ group, slot }) => {
      const id =
        slot ??
        old.find((entry) => !slots.has(entry.slot))?.slot ??
        (slots.has(0) ? 1 : 0);
      slots.add(id);
      return { group, slot: id };
    });
    placements.set(tab.path, assigned);
    return assigned.map(
      (placement): Placement & { tab: Tab; visible: boolean } => ({
        ...placement,
        tab,
        visible:
          tab.path ===
          (placement.group && groups
            ? groups[placement.group].active
            : workspace.active),
      }),
    );
  });
  useLayoutEffect(() => {
    previous.current = { vault, placements };
  });
  return panels;
}
