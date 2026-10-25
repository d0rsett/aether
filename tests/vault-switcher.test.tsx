import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { VaultSwitcher } from "../src/components/VaultSwitcher";
afterEach(cleanup);
it("switches only to a registered entry, marks the current vault and offers create/open", async () => {
  const first = { id: "one", name: "Личное", path: "C:/Личное" },
    second = { id: "two", name: "Работа", path: "C:/Работа" };
  const app = {
    vault: first,
    knownVaults: [first, second],
    busy: false,
    choose: vi.fn(),
    switchVault: vi.fn(),
    createVault: vi.fn(),
  };
  render(<VaultSwitcher app={app} />);
  const trigger = screen.getByRole("button", { name: "Хранилище: Личное" });
  await userEvent.click(trigger);
  expect(
    (
      screen.getByRole("button", {
        name: "Переключиться на Личное",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  await userEvent.click(
    screen.getByRole("button", { name: "Переключиться на Работа" }),
  );
  expect(app.switchVault).toHaveBeenCalledWith("two");
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  await userEvent.click(trigger);
  await userEvent.click(
    screen.getByRole("button", { name: "Создать хранилище…" }),
  );
  expect(app.createVault).toHaveBeenCalledOnce();
  await userEvent.click(trigger);
  await userEvent.click(
    screen.getByRole("button", { name: "Открыть хранилище…" }),
  );
  expect(app.choose).toHaveBeenCalledOnce();
});
