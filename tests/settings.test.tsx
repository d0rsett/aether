import {
  cleanup,
  render,
  screen,
  fireEvent,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { SettingsDialog } from "../src/components/SettingsDialog";
import { shortcutLabel } from "../src/workspace/shortcuts";
import {
  preferencesKey,
  readPreferences,
  resolveCodeAppearance,
} from "../src/workspace/preferences";
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.removeItem(preferencesKey);
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
  const setLanguage = vi.fn();
  const onClose = vi.fn();
  const setTypography = vi.fn();
  const setTheme = vi.fn();
  const setPaletteColor = vi.fn();
  const onShortcuts = vi.fn();
  const preferences = readPreferences();
  const onPreferences = vi.fn();
  render(
    <SettingsDialog
      setTypography={setTypography}
      shortcuts={{ save: "Shift+KeyS" }}
      onShortcuts={onShortcuts}
      preferences={preferences}
      onPreferences={onPreferences}
      theme="dark"
      setTheme={setTheme}
      setPaletteColor={setPaletteColor}
      locale="ru"
      setLanguage={setLanguage}
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
  const language = screen.getByRole("button", { name: /Язык интерфейса/ });
  await userEvent.click(language);
  const list = screen.getByRole("listbox");
  fireEvent.keyDown(list, { key: "End" });
  fireEvent.keyDown(list, { key: "Enter" });
  expect(setLanguage).toHaveBeenCalledWith("en");
  expect(screen.queryByRole("listbox")).toBeNull();
  expect(document.activeElement).toBe(language);
  await userEvent.click(language);
  fireEvent.keyDown(screen.getByRole("listbox"), { key: "Escape" });
  expect(onClose).not.toHaveBeenCalled();
  expect(screen.queryByRole("listbox")).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "Редактор" }));
  await userEvent.click(screen.getByRole("switch", { name: /Номера строк/ }));
  expect(setLineNumbers).toHaveBeenCalledWith(true);
  await userEvent.click(screen.getByRole("switch", { name: /Подсветка кода/ }));
  expect(onPreferences).toHaveBeenLastCalledWith({
    ...preferences,
    codeHighlighting: false,
  });
  expect(
    screen
      .getByLabelText("Пример подсветки кода")
      .querySelector(".syntax-keyword")?.textContent,
  ).toBe("def");
  const palette = screen.getByRole("button", { name: /Палитра кода/ });
  await userEvent.click(palette);
  expect(
    screen.getAllByRole("option").map((option) => option.textContent),
  ).toEqual([
    "Как в оформлении",
    "Aether",
    "Океан",
    "Закат",
    "Dracula",
    "Nord",
    "Gruvbox",
    "Solarized",
    "Atom One",
    "Catppuccin",
    "Tokyo Night",
    "Monokai",
    "Графит",
    "Шалфей",
    "Синий",
    "Лаванда",
    "Песочный",
    "Розовый",
    "Бирюзовый",
    "Терракота",
  ]);
  await userEvent.click(screen.getByRole("option", { name: "Monokai" }));
  expect(onPreferences).toHaveBeenLastCalledWith({
    ...preferences,
    codePalette: "monokai",
  });
  expect(
    screen.queryByRole("switch", { name: /Синхронизировать цвета кода/ }),
  ).toBeNull();
  await userEvent.click(
    screen.getByRole("button", { name: /Тема блока кода/ }),
  );
  await userEvent.click(
    screen.getByRole("option", { name: "Под палитру кода" }),
  );
  expect(onPreferences).toHaveBeenLastCalledWith({
    ...preferences,
    codeBackground: "syntax",
  });
  await userEvent.click(
    screen.getByRole("button", { name: /Тема блока кода/ }),
  );
  await userEvent.click(screen.getByRole("option", { name: "Dracula" }));
  expect(onPreferences).toHaveBeenLastCalledWith({
    ...preferences,
    codeBackground: "dracula",
    codePalette: "dracula",
  });
  await userEvent.click(
    screen.getByRole("switch", { name: /Автоотступ по синтаксису/ }),
  );
  expect(onPreferences).toHaveBeenLastCalledWith({
    ...preferences,
    codeAutoIndent: false,
  });
  await userEvent.click(screen.getByRole("button", { name: /Шаг отступа/ }));
  fireEvent.keyDown(screen.getByRole("listbox"), { key: "ArrowDown" });
  fireEvent.keyDown(screen.getByRole("listbox"), { key: "Enter" });
  expect(onPreferences).toHaveBeenLastCalledWith({
    ...preferences,
    indentWidth: "4",
  });
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
  const appearancePalettes = within(
    screen.getByRole("group", { name: "Цветовая гамма" }),
  );
  expect(appearancePalettes.getAllByRole("radio")).toHaveLength(19);
  expect(
    appearancePalettes.getByRole("radio", { name: "Графит", checked: true }),
  ).toBeTruthy();
  expect(
    document.querySelector<HTMLInputElement>('input[type="color"]')?.value,
  ).toBe("#454752");
  await userEvent.click(
    appearancePalettes.getByRole("radio", { name: "Dracula" }),
  );
  expect(setPaletteColor).toHaveBeenLastCalledWith("#9771c9");
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
it("restores code preferences and uses safe defaults for older profiles", () => {
  localStorage.setItem(preferencesKey, JSON.stringify({ mode: "reading" }));
  expect(readPreferences()).toMatchObject({
    mode: "reading",
    codeHighlighting: true,
    codePalette: "appearance",
    codeBackground: "appearance",
    codeAutoIndent: true,
    indentWidth: "2",
  });
  localStorage.setItem(
    preferencesKey,
    JSON.stringify({
      codeHighlighting: false,
      codePalette: "tokyo-night",
      codeBackground: "lavender",
      syncCodeColors: false,
      codeAutoIndent: false,
      indentWidth: "8",
    }),
  );
  expect(readPreferences()).toMatchObject({
    codeHighlighting: false,
    codePalette: "tokyo-night",
    codeBackground: "lavender",
    codeAutoIndent: false,
    indentWidth: "8",
  });
  localStorage.setItem(
    preferencesKey,
    JSON.stringify({
      indentWidth: "100",
      codePalette: "unknown",
      codeBackground: "unknown",
    }),
  );
  expect(readPreferences()).toMatchObject({
    indentWidth: "2",
    codePalette: "appearance",
    codeBackground: "appearance",
  });
});
it("matches code colors and backgrounds independently to the selected presets", () => {
  expect(resolveCodeAppearance("appearance", "syntax", null)).toEqual({
    palette: "graphite",
    tint: "#454752",
  });
  expect(resolveCodeAppearance("appearance", "appearance", "#808080")).toEqual({
    palette: "graphite",
    tint: undefined,
  });
  expect(resolveCodeAppearance("appearance", "syntax", "#9771c9")).toEqual({
    palette: "dracula",
    tint: "#9771c9",
  });
  expect(resolveCodeAppearance("appearance", "syntax", "#a48cdb")).toEqual({
    palette: "lavender",
    tint: "#a48cdb",
  });
  expect(resolveCodeAppearance("dracula", "sand", "#a48cdb")).toEqual({
    palette: "dracula",
    tint: "#c5a471",
  });
  expect(resolveCodeAppearance("appearance", "appearance", "#123456")).toEqual({
    palette: "aether",
    tint: undefined,
  });
});
