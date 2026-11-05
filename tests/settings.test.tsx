import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { SettingsDialog } from "../src/components/SettingsDialog";
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
  render(
    <SettingsDialog
      setTypography={setTypography}
      commands={[{ title: "Сохранить заметку", shortcut: "Ctrl S" }]}
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
  await userEvent.type(screen.getByRole("searchbox"), "Ctrl S");
  expect(screen.getByText("Сохранить заметку")).toBeTruthy();
  expect(screen.queryByText("Палитра команд")).toBeNull();
  await userEvent.clear(screen.getByRole("searchbox"));
  await userEvent.type(screen.getByRole("searchbox"), "несуществующая команда");
  expect(screen.getByText("Команды не найдены")).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "Закрыть диалог" }));
  expect(onClose).toHaveBeenCalledOnce();
});
