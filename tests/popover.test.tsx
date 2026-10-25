import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { Popover } from "../src/components/Popover";
afterEach(cleanup);
it("opens with the keyboard, invokes an action and closes without blocking the action", async () => {
  const action = vi.fn();
  render(
    <Popover label="Действия" icon={<span>⋯</span>}>
      <button onClick={action}>Переименовать</button>
    </Popover>,
  );
  const trigger = screen.getByRole("button", { name: "Действия" });
  trigger.focus();
  await userEvent.keyboard("{Enter}{Tab}{Enter}");
  expect(action).toHaveBeenCalledOnce();
  expect(screen.queryByRole("group", { name: "Действия" })).toBeNull();
});
it("Escape restores the trigger focus and outside clicks dismiss the popup", async () => {
  render(
    <>
      <Popover label="Режим" icon={<span>⌄</span>}>
        <button>Чтение</button>
      </Popover>
      <button>Снаружи</button>
    </>,
  );
  const trigger = screen.getByRole("button", { name: "Режим" });
  await userEvent.click(trigger);
  await userEvent.keyboard("{Tab}{Escape}");
  expect(document.activeElement).toBe(trigger);
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  await userEvent.click(trigger);
  await userEvent.click(screen.getByRole("button", { name: "Снаружи" }));
  expect(screen.queryByRole("group", { name: "Режим" })).toBeNull();
});
