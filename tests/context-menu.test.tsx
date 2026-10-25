import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { useContextMenu } from "../src/components/ContextMenu";
import { Popover } from "../src/components/Popover";
afterEach(cleanup);
function Fixture({
  run = () => {},
  error = () => {},
}: {
  run?: () => void | Promise<void>;
  error?: (text: string) => void;
}) {
  const context = useContextMenu(error);
  return (
    <>
      <button
        onContextMenu={(event) =>
          context.show(event, "Файл", [
            { label: "Недоступно", disabled: true, run },
            { label: "Открыть", run },
            { label: "Закрыть", run },
          ])
        }
      >
        Заметка
      </button>
      <button>Снаружи</button>
      <Popover label="Другое меню" icon="⋯">
        <button>Пункт</button>
      </Popover>
      {context.menu}
    </>
  );
}
it("supports right click, disabled items, keyboard navigation and left click actions", async () => {
  const run = vi.fn();
  render(<Fixture run={run} />);
  fireEvent.contextMenu(screen.getByRole("button", { name: "Заметка" }), {
    clientX: 100,
    clientY: 100,
  });
  expect(document.activeElement).toBe(
    screen.getByRole("menuitem", { name: "Открыть" }),
  );
  await userEvent.keyboard("{ArrowDown}");
  expect(document.activeElement).toBe(
    screen.getByRole("menuitem", { name: "Закрыть" }),
  );
  await userEvent.click(screen.getByRole("menuitem", { name: "Открыть" }));
  expect(run).toHaveBeenCalledOnce();
  expect(screen.queryByRole("menu")).toBeNull();
});
it("restores focus on Escape and closes other popup menus", async () => {
  render(<Fixture />);
  const file = screen.getByRole("button", { name: "Заметка" });
  fireEvent.contextMenu(file);
  await userEvent.keyboard("{Escape}");
  expect(document.activeElement).toBe(file);
  expect(screen.queryByRole("menu")).toBeNull();
  fireEvent.contextMenu(file);
  await userEvent.click(screen.getByRole("button", { name: "Другое меню" }));
  expect(screen.queryByRole("menu")).toBeNull();
  expect(screen.getByRole("group", { name: "Другое меню" })).toBeTruthy();
  fireEvent.contextMenu(file);
  expect(screen.queryByRole("group", { name: "Другое меню" })).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "Снаружи" }));
  expect(screen.queryByRole("menu")).toBeNull();
});
it("reports failed actions and dismisses the menu", async () => {
  const error = vi.fn();
  render(
    <Fixture
      error={error}
      run={async () => {
        throw new Error("Нет доступа");
      }}
    />,
  );
  fireEvent.contextMenu(screen.getByRole("button", { name: "Заметка" }));
  await userEvent.click(screen.getByRole("menuitem", { name: "Открыть" }));
  expect(error).toHaveBeenCalledWith("Нет доступа");
  expect(screen.queryByRole("menu")).toBeNull();
});
