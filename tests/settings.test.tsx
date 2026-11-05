import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { SettingsDialog } from "../src/components/SettingsDialog";
import { shortcutLabel } from "../src/workspace/shortcuts";
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it("switches sections and applies editor preferences through the shared dialog", async () => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.removeAttribute("open");
    },
  });
  const setLineNumbers = vi.fn();
  const onClose = vi.fn();
  const setTypography = vi.fn();
  const setTheme = vi.fn();
  const onShortcuts = vi.fn();
  render(
    <SettingsDialog
      setTypography={setTypography}
      shortcuts={{ save: "Shift+KeyS" }}
      onShortcuts={onShortcuts}
      theme="dark"
      setTheme={setTheme}
      locale="ru"
      setLanguage={vi.fn()}
      formatting={false}
      setFormatting={vi.fn()}
      lineNumbers={false}
      setLineNumbers={setLineNumbers}
      lineWrapping={true}
      setLineWrapping={vi.fn()}
      onClose={onClose}
    />,
  );
  expect(screen.getByRole("dialog", { name: "Настройки" })).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "Редактор" }));
  await userEvent.click(screen.getByRole("switch", { name: /Номера строк/ }));
  expect(setLineNumbers).toHaveBeenCalledWith(true);
  fireEvent.change(screen.getByRole("slider", { name: "Размер шрифта" }), {
    target: { value: "20" },
  });
  expect(setTypography).toHaveBeenCalledWith({
    fontSize: 20,
    lineHeight: 1.85,
    textWidth: 788,
  });
  await userEvent.click(screen.getByRole("button", { name: "Оформление" }));
  expect(screen.queryByRole("switch")).toBeNull();
  expect(
    screen.getByRole("radio", { name: "Тёмная", checked: true }),
  ).toBeTruthy();
  await userEvent.click(screen.getByText("Светлая"));
  expect(setTheme).toHaveBeenCalledWith("light");
  await userEvent.click(
    screen.getByRole("button", { name: "Горячие клавиши" }),
  );
  await userEvent.type(screen.getByRole("searchbox"), "Shift S");
  expect(screen.getByText("Сохранить")).toBeTruthy();
  expect(screen.queryByText("Палитра команд")).toBeNull();
  await userEvent.clear(screen.getByRole("searchbox"));
  await userEvent.type(screen.getByRole("searchbox"), "несуществующая команда");
  expect(screen.getByText("Команды не найдены")).toBeTruthy();
  await userEvent.clear(screen.getByRole("searchbox"));
  const edit = screen.getByRole("button", {
    name: "Изменить сочетание: Сохранить",
  });
  await userEvent.click(edit);
  await userEvent.click(
    screen.getByRole("button", { name: "Отменить запись сочетания" }),
  );
  expect(edit.textContent).toBe(shortcutLabel("Shift+KeyS"));
  expect(document.activeElement).toBe(edit);
  expect(onShortcuts).not.toHaveBeenCalled();
  await userEvent.click(
    screen.getByRole("button", { name: "Вернуть все сочетания по умолчанию" }),
  );
  expect(onShortcuts).toHaveBeenCalledWith({});
  await userEvent.click(screen.getByRole("button", { name: "Закрыть диалог" }));
  expect(onClose).toHaveBeenCalledOnce();
});
