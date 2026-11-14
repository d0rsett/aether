import { useReducer, useState } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { WorkspaceTabs } from "../src/components/WorkspaceChrome";
import { initialWorkspace, workspaceReducer } from "../src/workspace/model";

function Harness() {
  const initial = ["A.md", "B.md", "C.md"].reduce(
    (state, path) =>
      workspaceReducer(state, {
        type: "open",
        note: { path, content: "draft " + path, revision: "r" },
      }),
    initialWorkspace,
  );
  const [state, dispatch] = useReducer(
    workspaceReducer,
    workspaceReducer(initial, {
      type: "moveToGroup",
      path: "B.md",
      group: "secondary",
    }),
  );
  const [drag, setDrag] = useState<{
    path: string;
    vault: string | undefined;
  } | null>(null);
  return (
    <>
      {state.groups &&
        (["primary", "secondary"] as const).map((id) => (
          <WorkspaceTabs
            key={id}
            groupLabel={id}
            sharedDrag={drag}
            onDragTab={(path) => setDrag(path ? { path, vault: "v" } : null)}
            onActivateTab={(path) =>
              dispatch({ type: "activateGroupTab", path, group: id })
            }
            onMoveTab={(path, target, after) =>
              dispatch({ type: "moveToGroup", path, target, after, group: id })
            }
            app={{
              workspace: {
                tabs: state.tabs.filter((tab) =>
                  state.groups?.[id].tabs.includes(tab.path),
                ),
                active: state.groups?.[id].active ?? null,
              },
              vault: { id: "v", path: "/test", name: "test" },
              busy: false,
              dispatch,
              close: vi.fn(async () => true),
              create: vi.fn(async () => true),
              createQuick: vi.fn(async () => true),
              setError: vi.fn(),
              rename: vi.fn(async () => true),
              editTitle: vi.fn(async () => true),
            }}
          />
        ))}
      <output>{JSON.stringify(state.groups)}</output>
    </>
  );
}
const transfer = () => ({
  setData: vi.fn(),
  setDragImage: vi.fn(),
  effectAllowed: "",
  dropEffect: "",
});
afterEach(cleanup);

it("moves a dragged tab between strips at the requested insertion point", () => {
  render(<Harness />);
  const left = screen.getByRole("tablist", { name: "primary" });
  const right = screen.getByRole("tablist", { name: "secondary" });
  const source = within(left).getByRole("tab", { name: "C" });
  const target = within(right).getByRole("tab", { name: "B" });
  const dataTransfer = transfer();
  fireEvent.dragStart(source, { dataTransfer });
  fireEvent.dragOver(target, { dataTransfer, clientX: -1 });
  fireEvent.drop(target, { dataTransfer, clientX: -1 });
  expect(within(left).queryByRole("tab", { name: "C" })).toBeNull();
  expect(
    within(right)
      .getAllByRole("tab")
      .map((tab) => tab.textContent),
  ).toEqual(["C", "B"]);
  expect(
    within(right).getByRole("tab", { name: "C" }).getAttribute("aria-selected"),
  ).toBe("true");
  // Moving the source DOM node can suppress its dragend event in WebKit.
  // An external drop afterwards must not reuse that completed tab drag.
  fireEvent.drop(within(left).getByRole("tab", { name: "A" }), {
    dataTransfer,
    clientX: -1,
  });
  expect(within(left).queryByRole("tab", { name: "C" })).toBeNull();
});

it("ignores drag payloads without a matching live workspace drag", () => {
  render(<Harness />);
  const target = screen.getByRole("tab", { name: "B" });
  fireEvent.drop(target, {
    dataTransfer: { ...transfer(), getData: () => "A.md" },
    clientX: -1,
  });
  expect(screen.getByRole("tablist", { name: "primary" }).textContent).toBe(
    "AC",
  );
  expect(screen.getByRole("tablist", { name: "secondary" }).textContent).toBe(
    "B",
  );
});
