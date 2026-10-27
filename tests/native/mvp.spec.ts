import {
  chromium,
  expect,
  test,
  type Browser,
  type Page,
  type Locator,
} from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";

const root = resolve(import.meta.dirname, "../..");
const executable = resolve(root, "src-tauri/target/e2e/release/aether.exe");

test("note properties: typed edits, drafts, undo, preservation and explicit save", async () => {
  const run = await mkdtemp(join(root, ".build-cache/native-properties-"));
  const vault = join(run, "Native-MVP"),
    data = join(run, "data");
  await mkdir(vault);
  await mkdir(data);
  const source =
    "\uFEFF---\r\n# Keep comment\r\ntitle: 'Old' # title note\r\ncount: 1\r\ndone: false\r\ndue: 2026-10-27\r\ntags: [old]\r\naliases: [Old Alias]\r\nplugin:\r\n  nested: {keep: true}\r\n---\r\n# Body 😀\r\nOriginal text\r\n";
  await writeFile(join(vault, "Main.md"), source);
  await writeFile(join(vault, "Other.md"), "Plain body");
  await writeFile(join(vault, "Broken.md"), "---\nbad: [oops\n---\nBody");
  await writeFile(
    join(data, "settings.json"),
    JSON.stringify({ lastVault: vault }),
  );
  let app: RunningApp | undefined;
  try {
    app = await launch(data, join(run, "profile"), false);
    const page = app.page;
    await page.getByRole("button", { name: "Main", exact: true }).click();
    await setMode(page, "Исходник");
    const editor = page.getByRole("textbox", { name: "Markdown-редактор" });
    await editor.press("Control+End");
    await editor.pressSequentially("Unsaved body");
    await page
      .getByRole("button", { name: "Переключить правую панель", exact: true })
      .click();
    const properties = page.getByRole("region", { name: "Свойства заметки" });
    const row = (key: string) =>
      properties.getByRole("button", {
        name: `Изменить свойство ${key}`,
        exact: true,
      });
    const dialog = page.getByRole("dialog");
    const change = async (key: string, value: string) => {
      await row(key).click();
      await dialog.getByLabel("Значение", { exact: true }).fill(value);
      await dialog
        .getByRole("button", { name: "Применить", exact: true })
        .click();
      await expect(dialog).toBeHidden();
    };
    await change("title", "Draft title");
    await expect(row("title")).toContainText("Draft title");
    expect(await readFile(join(vault, "Main.md"), "utf8")).toBe(source);
    await editor.press("Control+z");
    await expect(row("title")).toContainText("Old");
    await expect(editor).toContainText("Unsaved body");
    await editor.press("Control+y");
    await expect(row("title")).toContainText("Draft title");
    await setMode(page, "Чтение");
    await change("count", "2.5");
    await row("done").click();
    await dialog.getByRole("checkbox", { name: "Значение включено" }).check();
    await dialog
      .getByRole("button", { name: "Применить", exact: true })
      .click();
    await expect(row("done")).toContainText("Да");
    await change("due", "2028-02-29");
    await row("aliases").click();
    await expect(dialog.getByLabel("Тип свойства")).toBeDisabled();
    await dialog
      .getByLabel("Значение", { exact: true })
      .fill("ИИ\nFirst, Last");
    await dialog
      .getByRole("button", { name: "Применить", exact: true })
      .click();
    await change("tags", "#работа\nproject/test");
    await row("count").click();
    await dialog.getByLabel("Значение", { exact: true }).fill("1+2");
    await dialog
      .getByRole("button", { name: "Применить", exact: true })
      .click();
    await expect(dialog.getByRole("alert")).toContainText("Введите число");
    await dialog.getByRole("button", { name: "Отмена", exact: true }).click();
    await row("due").click();
    await dialog
      .getByRole("button", { name: "Удалить свойство", exact: true })
      .click();
    await expect(row("due")).toHaveCount(0);
    await properties
      .getByRole("button", { name: "Добавить свойство", exact: true })
      .click();
    await dialog.getByLabel("Имя свойства").fill("custom: key");
    await dialog.getByLabel("Значение", { exact: true }).fill("true");
    await dialog
      .getByRole("button", { name: "Применить", exact: true })
      .click();
    await expect(row("custom: key")).toContainText("true");
    await expect(
      page.getByRole("region", { name: "Просмотр заметки" }),
    ).toContainText("Unsaved body");
    await page.mouse.move(10, 10);
    await page.screenshot({
      path: test.info().outputPath("properties-dark.png"),
    });
    await page
      .getByRole("button", { name: "Переключить тему", exact: true })
      .click();
    await page.setViewportSize({ width: 900, height: 650 });
    await row("title").click();
    await page.screenshot({
      path: test.info().outputPath("properties-form-light-narrow.png"),
    });
    await dialog.getByRole("button", { name: "Отмена", exact: true }).click();
    await row("plugin").click();
    await expect(editor.locator(".cm-line").first()).toBeVisible();
    await expect(editor).toContainText("plugin:");
    await expect(editor).toContainText("nested: {keep: true}");
    await expect(editor).toContainText("# Keep comment");
    expect(await readFile(join(vault, "Main.md"), "utf8")).toBe(source);
    await editor.press("Control+s");
    await expect
      .poll(async () => await readFile(join(vault, "Main.md"), "utf8"))
      .toContain('title: "Draft title" # title note');
    const saved = await readFile(join(vault, "Main.md"), "utf8");
    expect(saved.startsWith("\uFEFF---\r\n")).toBe(true);
    expect(saved.replace(/\r\n/g, "")).not.toContain("\n");
    expect(saved).toContain("plugin:\r\n  nested: {keep: true}\r\n");
    expect(saved).toContain("Unsaved body");
    expect(saved).toContain('aliases: ["ИИ","First, Last"]');
    expect(saved).toContain("count: 2.5");
    expect(saved).toContain("done: true");
    expect(saved).not.toContain("due:");
    await page.getByRole("button", { name: "Other", exact: true }).click();
    await properties
      .getByRole("button", { name: "Добавить свойство", exact: true })
      .click();
    await dialog.getByLabel("Имя свойства").fill("due");
    await dialog.getByLabel("Тип свойства").selectOption("date");
    await dialog.getByLabel("Значение", { exact: true }).fill("2028-02-29");
    await dialog
      .getByRole("button", { name: "Применить", exact: true })
      .click();
    await expect(row("due")).toContainText("2028-02-29");
    expect(await readFile(join(vault, "Other.md"), "utf8")).toBe("Plain body");
    await page.getByRole("button", { name: "Broken", exact: true }).click();
    await expect(properties.getByRole("alert")).toContainText("исходнике");
    await expect(
      properties.getByRole("button", {
        name: "Добавить свойство",
        exact: true,
      }),
    ).toHaveCount(0);
  } finally {
    await stop(app);
  }
});

test("YAML aliases: navigation, embeds, duplicate suggestions and portable insertion", async () => {
  const run = await mkdtemp(join(root, ".build-cache/native-aliases-"));
  const vault = join(run, "Native-MVP"),
    data = join(run, "data");
  await mkdir(join(vault, "Notes"), { recursive: true });
  await mkdir(data);
  const source =
    "\uFEFF---\r\naliases: [ИИ, Общий]\r\n---\r\n# Topic\r\n\r\n## Раздел\r\nТекст назначения ^block\r\n";
  const main =
    "# Main\n\n[[ИИ#Раздел|Открыть раздел]]\n\n![[ИИ#^block|Фрагмент]]\n";
  await writeFile(join(vault, "Notes", "Topic.md"), source);
  await writeFile(join(vault, "Other.md"), "---\naliases: [Общий]\n---\nOther");
  await writeFile(join(vault, "Main.md"), main);
  await writeFile(
    join(data, "settings.json"),
    JSON.stringify({ lastVault: vault }),
  );
  let app: RunningApp | undefined;
  try {
    app = await launch(data, join(run, "profile"), false);
    const page = app.page;
    await page.getByRole("button", { name: "Main", exact: true }).click();
    await setMode(page, "Чтение");
    await expect(
      page.getByRole("region", {
        name: "Встроенная заметка: Фрагмент",
        exact: true,
      }),
    ).toContainText("Текст назначения");
    await page
      .getByRole("link", { name: "Открыть раздел", exact: true })
      .click();
    await expect(
      page.getByRole("tab", { name: "Topic", exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    await page.getByRole("tab", { name: "Main", exact: true }).click();
    await setMode(page, "Исходник");
    const editor = page.getByRole("textbox", { name: "Markdown-редактор" });
    await editor.press("Control+End");
    await editor.press("Enter");
    await editor.pressSequentially("[[Общ");
    const popup = page.locator(".cm-tooltip-autocomplete");
    await expect(popup.getByRole("option")).toHaveCount(2);
    await expect(popup).toContainText("→ Notes/Topic.md");
    await expect(popup).toContainText("→ Other.md");
    await page.mouse.move(10, 10);
    await page.screenshot({ path: test.info().outputPath("aliases-dark.png") });
    await page
      .getByRole("button", { name: "Переключить тему", exact: true })
      .click();
    await expect(popup).toBeHidden();
    await editor.press("Control+Space");
    await expect(popup.getByRole("option")).toHaveCount(2);
    await page.screenshot({
      path: test.info().outputPath("aliases-light.png"),
    });
    await popup
      .getByRole("option")
      .filter({ hasText: "→ Notes/Topic.md" })
      .click();
    await expect(editor.locator(".cm-line").last()).toHaveText(
      "[[Notes/Topic|Общий]]",
    );
    await editor.press("Control+z");
    await expect(editor.locator(".cm-line").last()).toHaveText("[[Общ]]");
    expect(await readFile(join(vault, "Main.md"), "utf8")).toBe(main);
    expect(await readFile(join(vault, "Notes", "Topic.md"), "utf8")).toBe(
      source,
    );
    await writeFile(
      join(vault, "Notes", "Topic.md"),
      source.replace("ИИ, Общий", "ИИ, Общий, Новый псевдоним"),
    );
    await editor.press("Escape");
    await editor.press("End");
    await editor.press("Enter");
    await editor.pressSequentially("[[Новый");
    await expect(async () => {
      await editor.press("Control+Space");
      await expect(popup).toContainText("Новый псевдоним");
    }).toPass();
  } finally {
    await stop(app);
  }
});

test("note embeds: fragments, live buffers, source links, relative assets and cycles", async () => {
  const run = await mkdtemp(join(root, ".build-cache/native-note-embeds-"));
  const vault = join(run, "Native-MVP"),
    data = join(run, "data");
  await mkdir(join(vault, "Notes", "Assets"), { recursive: true });
  await mkdir(data);
  const source =
    "\uFEFF# Источник\r\nПредисловие\r\n\r\n## Раздел\r\nВыбранный текст\r\n\r\n### Дочерний\r\nДетали\r\n\r\n## Следующий\r\nДругой раздел\r\n\r\nАбзац блока ^block\r\n\r\n[К соседней](./Sibling.md)\r\n\r\n![Схема](Assets/Pic.png)\r\n\r\n![[../Main]]\r\n";
  const main =
    "# Главное\r\n\r\n![[Notes/Source#Раздел|Выдержка]]\r\n\r\n![[Notes/Source#^block|Блок]]\r\n\r\n![[Notes/Source|Полная заметка]]\r\n\r\n![Markdown](Notes/Source.md#Раздел)\r\n\r\n![[Missing]]\r\n";
  await writeFile(join(vault, "Notes", "Source.md"), source);
  await writeFile(
    join(vault, "Notes", "Sibling.md"),
    "Правильная соседняя заметка",
  );
  await writeFile(join(vault, "Main.md"), main);
  await writeFile(
    join(vault, "Notes", "Assets", "Pic.png"),
    await readFile(join(root, "src-tauri/icons/icon.png")),
  );
  await writeFile(
    join(data, "settings.json"),
    JSON.stringify({ lastVault: vault }),
  );
  let app: RunningApp | undefined;
  try {
    app = await launch(data, join(run, "profile"), false);
    const page = app.page;
    await page.getByRole("button", { name: "Main", exact: true }).click();
    await setMode(page, "Чтение");
    const excerpt = page.getByRole("region", {
      name: "Встроенная заметка: Выдержка",
      exact: true,
    });
    const block = page.getByRole("region", {
      name: "Встроенная заметка: Блок",
      exact: true,
    });
    const full = page.getByRole("region", {
      name: "Встроенная заметка: Полная заметка",
      exact: true,
    });
    await expect(excerpt).toContainText("Выбранный текст");
    await expect(excerpt).toContainText("Детали");
    await expect(excerpt).not.toContainText("Другой раздел");
    await expect(block).toContainText("Абзац блока");
    await expect(block).not.toContainText("^block");
    await expect(
      page.getByRole("region", {
        name: "Встроенная заметка: Markdown",
        exact: true,
      }),
    ).toContainText("Выбранный текст");
    await expect(full).toContainText("Предисловие");
    await expect(full).toContainText("Циклическое встраивание");
    await full.locator(".reading-image").scrollIntoViewIfNeeded();
    await expect(full.locator("img")).toBeVisible();
    await expect(page.getByText(/Заметка не найдена/)).toBeVisible();
    await full.getByRole("link", { name: "К соседней", exact: true }).click();
    await expect(
      page.getByRole("region", { name: "Просмотр заметки" }),
    ).toContainText("Правильная соседняя заметка");
    await page.getByRole("tab", { name: "Main", exact: true }).click();
    await excerpt
      .getByRole("button", { name: "Открыть оригинал: Выдержка", exact: true })
      .click();
    await setMode(page, "Исходник");
    const editor = page.getByRole("textbox", { name: "Markdown-редактор" });
    // Append through ordinary editor input, leaving the original file untouched.
    await editor.press("Control+End");
    await editor.press("Enter");
    await editor.pressSequentially("Несохранённый текст");
    await page.getByRole("tab", { name: "Main", exact: true }).click();
    await setMode(page, "Чтение");
    await expect(full).toContainText("Несохранённый текст");
    expect(await readFile(join(vault, "Notes", "Source.md"), "utf8")).toBe(
      source,
    );
    await setMode(page, "Live Preview");
    await expect(
      page
        .locator(".live-block-preview .note-transclusion")
        .filter({ hasText: "Несохранённый текст" }),
    ).toBeVisible();
    await expect(
      editor
        .locator(".cm-line")
        .filter({ hasText: "![[Notes/Source#Раздел|Выдержка]]" }),
    ).toBeVisible();
    await page.mouse.move(10, 10);
    await page.screenshot({
      path: test.info().outputPath("note-embeds-live.png"),
    });
    await setMode(page, "Исходник");
    await expect(editor).toContainText("![[Notes/Source#Раздел|Выдержка]]");
    expect(await readFile(join(vault, "Main.md"), "utf8")).toBe(main);
  } finally {
    await stop(app);
  }
});

test("Obsidian syntax: comments, highlights, callouts and undoable tasks", async () => {
  const run = await mkdtemp(join(root, ".build-cache/native-obsidian-syntax-"));
  const vault = join(run, "Native-MVP"),
    data = join(run, "data");
  await mkdir(vault);
  await mkdir(data);
  const content =
    "# Совместимость 😀\r\n\r\n==Важный **текст**==\r\n\r\n%%Секрет [[Скрытая]] #hidden%%\r\n\r\n> [!warning]- **Внимание**\r\n> Содержимое выноски\r\n\r\n- [ ] Проверить\r\n";
  const note = join(vault, "Заметка.md");
  await writeFile(note, content);
  await writeFile(
    join(data, "settings.json"),
    JSON.stringify({ lastVault: vault }),
  );
  let app: RunningApp | undefined;
  try {
    app = await launch(data, join(run, "profile"), false);
    const page = app.page;
    await page.getByRole("button", { name: "Заметка", exact: true }).click();
    await setMode(page, "Чтение");
    const reading = page.getByRole("region", { name: "Просмотр заметки" });
    await expect(reading.locator("mark")).toHaveText("Важный текст");
    await expect(reading.locator("mark strong")).toHaveText("текст");
    await expect(reading).not.toContainText("Секрет");
    const callout = reading.locator("details.reading-callout");
    await expect(callout).not.toHaveAttribute("open");
    await callout.locator("summary").click();
    await expect(callout).toContainText("Содержимое выноски");
    await reading.getByRole("checkbox").check();
    await expect(reading.getByRole("checkbox")).toBeChecked();
    expect(await readFile(note, "utf8")).toBe(content);
    await setMode(page, "Исходник");
    const editor = page.getByRole("textbox", { name: "Markdown-редактор" });
    await expect(editor).toContainText("[x]");
    await editor.press("Control+z");
    await expect(editor).toContainText("[ ]");
    await setMode(page, "Live Preview");
    await expect(
      page.locator('.live-inline-preview[data-live-kind="highlight"] mark'),
    ).toHaveText("Важный текст");
    await expect(
      page.locator('.live-block-preview[data-live-kind="callout"]'),
    ).toBeVisible();
    await page
      .locator('.live-inline-preview[data-live-kind="task"] input')
      .click({ noWaitAfter: true });
    await expect(
      page.locator('.live-inline-preview[data-live-kind="task"] input'),
    ).toBeChecked();
    await setMode(page, "Исходник");
    await expect(editor).toContainText("[x]");
    await editor.press("Control+s");
    await expect
      .poll(() => readFile(note, "utf8"))
      .toBe(content.replace("[ ]", "[x]"));
    await setMode(page, "Чтение");
    await expect(reading.getByRole("checkbox")).toBeChecked();
    await page.screenshot({
      path: test.info().outputPath("obsidian-syntax-dark.png"),
    });
    await page.getByRole("button", { name: /тему/i }).click();
    await page.screenshot({
      path: test.info().outputPath("obsidian-syntax-light.png"),
    });
  } finally {
    await stop(app);
  }
});

test("live attachments: source paths stay above all cards while typing and selecting", async () => {
  const run = await mkdtemp(
    join(root, ".build-cache/native-live-attachments-"),
  );
  const vault = join(run, "Native-MVP"),
    data = join(run, "data");
  await mkdir(join(vault, "Media"), { recursive: true });
  await mkdir(data);
  for (const name of ["Report.pdf", "Sound.wav", "Data.csv", "Archive.zip"])
    await writeFile(join(vault, "Media", name), "test attachment");
  await writeFile(join(vault, "Other.md"), "Other note");
  const examples = [
    ["![[Media/Report.pdf|Отчёт]]", "Отчёт"],
    ["![Звук](Media/Sound.wav)", "Звук"],
    ["![[Media/Data.csv]]", "Media/Data.csv"],
    ["![[Media/Archive.zip]]", "Media/Archive.zip"],
    ["![[Other]]", "Other"],
  ];
  await writeFile(
    join(vault, "Заметка.md"),
    examples.map(([source]) => source).join("\n\n") + "\n",
  );
  await writeFile(
    join(data, "settings.json"),
    JSON.stringify({ lastVault: vault }),
  );
  let app: RunningApp | undefined;
  try {
    app = await launch(data, join(run, "profile"), false);
    const page = app.page;
    await page.getByRole("button", { name: "Заметка", exact: true }).click();
    await setMode(page, "Live Preview");
    const editor = page.getByRole("textbox", { name: "Markdown-редактор" });
    await expect(
      page.locator(".live-block-preview[data-source-visible]"),
    ).toHaveCount(5);
    for (const [source, label] of examples) {
      const line = editor.locator(".cm-line").filter({ hasText: source });
      const preview = page
        .locator(".live-block-preview")
        .filter({ hasText: label });
      await expect(line).toBeVisible();
      await expect(preview).toBeVisible();
      const bounds = (await line.boundingBox())!;
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(
        (await preview.boundingBox())!.y,
      );
    }
    const report = page
      .locator(".live-block-preview .attachment-card")
      .filter({ hasText: "Отчёт" });
    await report.evaluate((button) =>
      button.setAttribute("data-edit-check", "persistent"),
    );
    await editor.press("Control+Home");
    await editor.press("End");
    await editor.press("ArrowLeft");
    await editor.press("ArrowLeft");
    for (const character of " дополнение") {
      await editor.pressSequentially(character);
      await expect(
        page.locator('[data-edit-check="persistent"]'),
      ).toBeVisible();
    }
    await expect(report).toHaveText("Отчёт дополнение");
    await editor.press("Control+a");
    await expect(
      page.locator(".live-block-preview[data-source-visible]"),
    ).toHaveCount(5);
    await page.screenshot({
      path: test.info().outputPath("live-attachment-sources.png"),
    });
  } finally {
    await stop(app);
  }
});

test("attachment sidebar: unique files, live aliases, note-only outgoing links and opening image tabs", async () => {
  const run = await mkdtemp(
    join(root, ".build-cache/native-attachment-sidebar-"),
  );
  const vault = join(run, "Native-MVP"),
    data = join(run, "data");
  await mkdir(vault);
  await mkdir(data);
  await writeFile(
    join(vault, "Photo.png"),
    await readFile(join(root, "src-tauri/icons/icon.png")),
  );
  await writeFile(join(vault, "Report.pdf"), "%PDF-1.4\nfixture");
  await writeFile(
    join(vault, "Other.md"),
    "Other note\n[[Список]]\n[[Список|Обратно]]\n",
  );
  const source =
    "![[Photo.png|Моя подпись|64]]\n\n![[Photo.png|Другая подпись|64]]\n\n![Markdown](Photo.png)\n\n![[Report.pdf]]\n\n[[Other]] [[Other|Other alias]] [[./Other.md|Ещё имя]]\n";
  await writeFile(join(vault, "Список.md"), source);
  await writeFile(
    join(data, "settings.json"),
    JSON.stringify({ lastVault: vault }),
  );
  let app: RunningApp | undefined;
  try {
    app = await launch(data, join(run, "profile"), true);
    const page = app.page;
    await page.getByRole("button", { name: "Список", exact: true }).click();
    const attachments = page.locator(".note-attachments");
    await expect(attachments.locator(".attachment-link")).toHaveCount(2);
    await expect(
      attachments.getByRole("button", {
        name: "Вложение: Моя подпись",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      attachments.getByRole("button", {
        name: "Вложение: Report.pdf",
        exact: true,
      }),
    ).toBeVisible();
    const outgoing = page.locator(".relations-section").filter({
      has: page.locator("summary").filter({ hasText: "Исходящие ссылки" }),
    });
    await expect(outgoing.locator(".relation-link")).toHaveCount(1);
    await expect(outgoing.locator(".relation-link")).toContainText("Other");
    await expect(outgoing.locator(".relation-repeat-count")).toHaveText("×3");
    const incoming = page.locator(".relations-section").filter({
      has: page.locator("summary").filter({ hasText: "Обратные ссылки" }),
    });
    await expect(incoming.locator(".relation-link")).toHaveCount(1);
    await expect(incoming.locator(".relation-repeat-count")).toHaveText("×2");
    await setMode(page, "Исходник");
    const editor = page.getByRole("textbox", { name: "Markdown-редактор" });
    await editor.press("Control+Home");
    await editor.press("Shift+End");
    await editor.pressSequentially("![[Photo.png|Изменённая подпись|64]]");
    await expect(
      attachments.getByRole("button", {
        name: "Вложение: Изменённая подпись",
        exact: true,
      }),
    ).toBeVisible();
    await expect(attachments.locator(".attachment-link")).toHaveCount(2);
    expect(await readFile(join(vault, "Список.md"), "utf8")).toBe(source);
    await attachments.locator("summary").click();
    await expect(
      attachments.locator(".attachment-link").first(),
    ).not.toBeVisible();
    await attachments.locator("summary").click();
    await page.screenshot({
      path: test.info().outputPath("attachment-sidebar.png"),
    });
    await attachments
      .getByRole("button", {
        name: "Вложение: Изменённая подпись",
        exact: true,
      })
      .click();
    await expect(
      page.getByRole("tab", { name: "Photo.png", exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("dialog[open]")).toHaveCount(0);
    expect(
      (await readdir(vault)).filter((name) => name.endsWith(".png.md")),
    ).toEqual([]);
  } finally {
    await stop(app);
  }
});

test("Obsidian vault: paste/drop attachments, preserve config and CRLF, preview short names and use Markdown links", async () => {
  const run = await mkdtemp(join(root, ".build-cache/native-attachments-"));
  const vault = join(run, "Native-MVP"),
    data = join(run, "data");
  await mkdir(join(vault, "Notes"), { recursive: true });
  await mkdir(join(vault, "Media"));
  await mkdir(join(vault, ".obsidian"));
  await mkdir(data);
  const png = await readFile(join(root, "src-tauri/icons/icon.png"));
  await writeFile(join(vault, "Media/Old.png"), png);
  const config = {
    attachmentFolderPath: "./assets",
    newLinkFormat: "shortest",
    useMarkdownLinks: false,
    unrelated: "preserve",
  };
  const configPath = join(vault, ".obsidian/app.json");
  await writeFile(configPath, JSON.stringify(config));
  const notePath = join(vault, "Notes/Заметка.md");
  const seed =
    "\uFEFF# Вложения\r\n\r\n![[Old.png|120]]\r\n\r\nМесто вставки\r\n";
  await writeFile(notePath, seed);
  await writeFile(
    join(data, "settings.json"),
    JSON.stringify({ lastVault: vault }),
  );
  let app: RunningApp | undefined;
  try {
    app = await launch(data, join(run, "profile"), false);
    const page = app.page;
    await expect(
      page.getByRole("button", { name: ".obsidian", exact: true }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "Notes", exact: true }).click();
    await page.getByRole("button", { name: "Заметка", exact: true }).click();
    await setMode(page, "Чтение");
    const reading = page.getByRole("region", { name: "Просмотр заметки" });
    await expect(
      reading.getByRole("img", { name: "Old.png", exact: true }),
    ).toBeVisible();
    expect(
      (await reading
        .getByRole("img", { name: "Old.png", exact: true })
        .boundingBox())!.width,
    ).toBe(120);
    await reading
      .getByRole("button", {
        name: "Открыть изображение: Old.png",
        exact: true,
      })
      .click();
    const lightbox = page.getByRole("dialog", {
      name: "Просмотр изображения: Old.png",
    });
    await expect(lightbox).toBeVisible();
    await expect(lightbox.locator(".modal-header")).toHaveCount(0);
    await expect(
      lightbox.getByRole("img", { name: "Old.png", exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: test.info().outputPath("image-lightbox.png"),
    });
    await page.keyboard.press("Escape");
    await expect(lightbox).toHaveCount(0);
    await expect(
      reading.getByRole("button", {
        name: "Открыть изображение: Old.png",
        exact: true,
      }),
    ).toBeFocused();
    await reading
      .getByRole("button", {
        name: "Открыть изображение: Old.png",
        exact: true,
      })
      .click();
    await lightbox.click({ position: { x: 8, y: 8 } });
    await expect(lightbox).toHaveCount(0);
    await setMode(page, "Исходник");
    const editor = page.getByRole("textbox", { name: "Markdown-редактор" });
    await editor.press("Control+End");
    const send = async (type: "paste" | "drop", names: string[]) => {
      await editor.evaluate(
        (element, payload) => {
          const transfer = new DataTransfer();
          const bytes = Uint8Array.from(atob(payload.png), (char) =>
            char.charCodeAt(0),
          );
          for (const name of payload.names)
            transfer.items.add(
              new File(
                [
                  name.endsWith(".pdf")
                    ? new TextEncoder().encode("%PDF-1.4\nfixture")
                    : bytes,
                ],
                name,
                {
                  type: name.endsWith(".pdf") ? "application/pdf" : "image/png",
                },
              ),
            );
          if (payload.type === "paste")
            element.dispatchEvent(
              new ClipboardEvent("paste", {
                clipboardData: transfer,
                bubbles: true,
                cancelable: true,
              }),
            );
          else {
            const rect = element.getBoundingClientRect();
            element.dispatchEvent(
              new DragEvent("drop", {
                dataTransfer: transfer,
                clientX: rect.left + 20,
                clientY: rect.bottom - 5,
                bubbles: true,
                cancelable: true,
              }),
            );
          }
        },
        { type, names, png: png.toString("base64") },
      );
    };
    await send("paste", ["image.png"]);
    let pasted = "";
    await expect
      .poll(async () => {
        try {
          pasted =
            (await readdir(vault)).find(
              (name) => name === "Новое изображение.png",
            ) ?? "";
          return !!pasted;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
          throw error;
        }
      })
      .toBe(true);
    await expect(editor).toContainText(`![[${pasted}]]`);
    expect(await readFile(join(vault, pasted))).toEqual(png);
    await editor.press("Control+s");
    await expect
      .poll(() => readFile(notePath, "utf8"))
      .toContain(`![[${pasted}]]`);
    const saved = await readFile(notePath, "utf8");
    expect(saved.startsWith("\uFEFF")).toBe(true);
    expect(saved).not.toMatch(/[^\r]\n/);
    await editor.press("Control+z");
    await expect(editor).not.toContainText(pasted);
    expect(await readFile(join(vault, pasted))).toEqual(png);
    const imageRow = page.getByRole("button", { name: pasted, exact: true });
    await expect(imageRow).toBeVisible();
    await expect(imageRow.locator(".tree-file-type")).toHaveText("PNG");
    await imageRow.click();
    const imageDocument = page.getByRole("region", {
      name: `Изображение: ${pasted}`,
    });
    await expect(
      imageDocument.getByRole("img", { name: pasted, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("tab", { name: pasted, exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("dialog[open]")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Режим заметки", exact: true }),
    ).toHaveCount(0);
    await page.screenshot({
      path: test.info().outputPath("image-document-tab.png"),
    });
    await page.getByRole("tab", { name: "Заметка", exact: true }).click();
    await expect(editor).toBeVisible();
    await page.getByRole("tab", { name: pasted, exact: true }).click();
    await expect(imageDocument).toBeVisible();
    await imageRow.click();
    await expect(
      page.getByRole("tab", { name: pasted, exact: true }),
    ).toHaveCount(1);
    await page.keyboard.press("Control+w");
    await expect(
      page.getByRole("tab", { name: pasted, exact: true }),
    ).toHaveCount(0);
    await expect(editor).toBeVisible();
    await editor.press("Control+Home");
    const dropLine = editor
      .locator(".cm-line")
      .filter({ hasText: "Место вставки" });
    await imageRow.dragTo(dropLine, { targetPosition: { x: 180, y: 8 } });
    await expect(dropLine).toContainText(`![[${pasted}]]`);
    expect((await dropLine.textContent())!.replace(`![[${pasted}]]`, "")).toBe(
      "Место вставки",
    );
    expect(
      (await readdir(vault)).filter((name) =>
        /^Новое изображение.*\.png$/.test(name),
      ),
    ).toEqual([pasted]);
    await page.screenshot({
      path: test.info().outputPath("image-tree-drag.png"),
    });
    await editor.press("Control+z");
    await expect(editor).not.toContainText(pasted);
    await send("drop", ["photo.png", "photo.png", "Report.pdf"]);
    await expect(editor).toContainText("![[photo 1.png]]");
    await expect(editor).toContainText("![[Report.pdf]]");
    expect(await readFile(join(vault, "Notes/assets/photo.png"))).toEqual(png);
    expect(await readFile(join(vault, "Notes/assets/photo 1.png"))).toEqual(
      png,
    );
    expect(JSON.parse(await readFile(configPath, "utf8"))).toEqual(config);
    const markdownConfig = {
      ...config,
      attachmentFolderPath: "Media",
      useMarkdownLinks: true,
      newLinkFormat: "relative",
    };
    await writeFile(configPath, JSON.stringify(markdownConfig));
    await editor.press("Control+End");
    await send("paste", ["новое фото.png"]);
    await expect(editor).toContainText("![](../%D0");
    expect(await readFile(join(vault, "Новое изображение 1.png"))).toEqual(png);
    await editor.press("Control+s");
    await setMode(page, "Live Preview");
    await editor.press("Control+Home");
    await expect(page.locator(".live-block-preview img").first()).toBeVisible();
    const sourceLine = editor
      .locator(".cm-line")
      .filter({ hasText: "![[Old.png|120]]" });
    await expect(sourceLine).toBeVisible();
    const oldPreview = page.locator('.live-block-preview img[alt="Old.png"]');
    const sourceBounds = (await sourceLine.boundingBox())!;
    expect(sourceBounds.y + sourceBounds.height).toBeLessThanOrEqual(
      (await oldPreview.boundingBox())!.y,
    );
    await sourceLine.click();
    await editor.press("Home");
    await editor.press("Shift+End");
    await editor.pressSequentially("![[Old.png|160]]");
    await expect
      .poll(async () => (await oldPreview.boundingBox())?.width)
      .toBe(160);
    await expect(
      editor.locator(".cm-line").filter({ hasText: "![[Old.png|160]]" }),
    ).toBeVisible();
    await editor.press("Home");
    await editor.press("Shift+End");
    await editor.pressSequentially("![[Old.png|Фото из хранилища|160]]");
    const caption = page.locator(".live-block-preview .image-caption").filter({
      hasText: "Фото из хранилища",
    });
    await expect(caption).toBeVisible();
    const captionImage = page.locator(
      '.live-block-preview img[alt="Фото из хранилища"]',
    );
    await expect
      .poll(async () => (await captionImage.boundingBox())?.width)
      .toBe(160);
    const imageBounds = (await captionImage.boundingBox())!;
    expect((await caption.boundingBox())!.y).toBeGreaterThanOrEqual(
      imageBounds.y + imageBounds.height,
    );
    const captionBounds = (await caption.boundingBox())!;
    expect(
      Math.abs(
        captionBounds.x +
          captionBounds.width / 2 -
          imageBounds.x -
          imageBounds.width / 2,
      ),
    ).toBeLessThan(2);
    await captionImage.evaluate((image) =>
      image.setAttribute("data-edit-check", "stable"),
    );
    const persistentImage = page.locator('img[data-edit-check="stable"]');
    await editor.press("End");
    for (let i = 0; i < 6; i++) await editor.press("ArrowLeft");
    for (const character of " дополнение") {
      await editor.pressSequentially(character);
      await expect(persistentImage).toBeVisible();
      expect(
        await persistentImage.evaluate(
          (image) => (image as HTMLImageElement).complete,
        ),
      ).toBe(true);
    }
    await expect(caption).toHaveText("Фото из хранилища дополнение");
    await expect(persistentImage).toBeVisible();
    await expect(
      editor.locator(".cm-line").filter({ hasText: "![](../%D0" }),
    ).toBeVisible();
    await page.screenshot({
      path: test.info().outputPath("live-image-source.png"),
    });
    await editor.press("Control+s");
    await setMode(page, "Чтение");
    await expect(
      reading
        .locator(".image-caption")
        .filter({ hasText: "Фото из хранилища" }),
    ).toBeVisible();
    await expect(
      reading.locator(".attachment-card").filter({ hasText: "Report.pdf" }),
    ).toBeVisible();
    await reading.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await expect
      .poll(() =>
        reading
          .locator("img")
          .evaluateAll(
            (images) =>
              images.filter(
                (image) =>
                  (image as HTMLImageElement).complete &&
                  (image as HTMLImageElement).naturalWidth > 0,
              ).length,
          ),
      )
      .toBeGreaterThanOrEqual(4);
    await page.screenshot({
      path: test.info().outputPath("obsidian-attachments.png"),
    });
    expect(JSON.parse(await readFile(configPath, "utf8"))).toEqual(
      markdownConfig,
    );
    expect(await readFile(join(vault, "Media/Old.png"))).toEqual(png);
    const noteBeforeImage = await readFile(notePath);
    await imageRow.click();
    await expect(imageDocument).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(() =>
          Object.keys(localStorage)
            .filter((key) => key.startsWith("aether.workspace.v1:"))
            .map((key) => JSON.parse(localStorage.getItem(key)!).active),
        ),
      )
      .toContain(pasted);
    await stop(app);
    app = await launch(data, join(run, "profile"), false);
    await expect(
      app.page.getByRole("tab", { name: pasted, exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    await expect(
      app.page
        .getByRole("region", { name: `Изображение: ${pasted}` })
        .getByRole("img", { name: pasted, exact: true }),
    ).toBeVisible();
    await expect(app.page.locator("dialog[open]")).toHaveCount(0);
    expect(await readFile(notePath)).toEqual(noteBeforeImage);
    expect(await readFile(join(vault, pasted))).toEqual(png);
  } finally {
    await stop(app);
  }
});

test("editor modes toggle reading/live, active line number follows the caret and formatting preserves selection", async () => {
  const run = await mkdtemp(join(root, ".build-cache/native-editor-controls-"));
  const vault = join(run, "Native-MVP"),
    data = join(run, "data");
  await mkdir(vault);
  await mkdir(data);
  const content = "Первая строка\nВторая строка\nТретья строка\n";
  await writeFile(join(vault, "Редактор.md"), content);
  await writeFile(
    join(data, "settings.json"),
    JSON.stringify({ lastVault: vault }),
  );
  let app: RunningApp | undefined;
  try {
    app = await launch(data, join(run, "profile"), false);
    const page = app.page;
    await page.getByRole("button", { name: "Редактор", exact: true }).click();
    const editor = page.getByRole("textbox", { name: "Markdown-редактор" });
    const toggle = page.getByRole("button", {
      name: "Переключить режим чтения",
    });
    await expect(page.locator(".is-live")).toBeVisible();
    await toggle.click();
    await expect(
      page.getByRole("region", { name: "Просмотр заметки" }),
    ).toBeVisible();
    await toggle.click();
    await expect(page.locator(".is-live")).toBeVisible();
    await setMode(page, "Исходник");
    await expect(page.locator(".is-live")).toHaveCount(0);
    await page.keyboard.press("Control+e");
    await page.keyboard.press("Control+e");
    await expect(page.locator(".is-live")).toBeVisible();
    await setMode(page, "Исходник");
    await noteAction(page, "Номера строк");
    await editor.press("Control+Home");
    const activeLine = page.locator(".cm-lineNumbers .cm-activeLineGutter");
    await expect(activeLine).toHaveText("1");
    await editor.press("ArrowDown");
    await expect(activeLine).toHaveText("2");
    expect(
      await activeLine.evaluate(
        (element) => getComputedStyle(element).paddingTop,
      ),
    ).toBe("4px");
    expect(
      await activeLine.evaluate(
        (element) => getComputedStyle(element).backgroundColor,
      ),
    ).not.toBe("rgba(0, 0, 0, 0)");
    await noteAction(page, "Панель форматирования");
    const toolbar = page.getByRole("toolbar", { name: "Форматирование" });
    await expect(toolbar.getByRole("group")).toHaveCount(3);
    await editor.press("Control+Home");
    await editor.press("Shift+End");
    const selectionAlignment = async () =>
      page.evaluate(() => {
        const selection = window.getSelection();
        if (!selection?.rangeCount) return 1000;
        const text = selection.getRangeAt(0).getBoundingClientRect();
        const background = [
          ...document.querySelectorAll(".cm-selectionBackground"),
        ]
          .map((element) => element.getBoundingClientRect())
          .find((rect) => rect.width > 2 && rect.height > 2);
        return background
          ? Math.max(
              Math.abs(background.left - text.left),
              Math.abs(background.right - text.right),
            )
          : 1000;
      });
    await expect.poll(selectionAlignment).toBeLessThan(2);
    await toolbar.getByRole("button", { name: "Жирный", exact: true }).click();
    await expect(
      toolbar.getByRole("button", { name: "Жирный", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await editor.press("Control+s");
    await expect
      .poll(() => readFile(join(vault, "Редактор.md"), "utf8"))
      .toBe("**Первая строка**\nВторая строка\nТретья строка\n");
    const columnGap = await page.locator(".cm-editor").evaluate((element) => {
      const line = element.querySelector(".cm-line")!;
      const range = document.createRange();
      range.selectNodeContents(line);
      return (
        range.getBoundingClientRect().left -
        element.querySelector(".cm-gutters")!.getBoundingClientRect().right
      );
    });
    expect(columnGap).toBeGreaterThanOrEqual(0);
    expect(columnGap).toBeLessThan(24);
    await expect(page.locator(".breadcrumbs")).toHaveText("");
    await editor.hover();
    await toolbar.getByRole("button", { name: "Жирный", exact: true }).hover();
    await expect(page.getByRole("tooltip")).toContainText("Ctrl+B");
    await expect(
      toolbar.getByRole("button", { name: "Жирный", exact: true }),
    ).not.toHaveAttribute("title");
    await editor.press("Control+Home");
    await editor.press("ArrowDown");
    await editor.press("Home");
    await editor.press("Shift+End");
    await expect.poll(selectionAlignment).toBeLessThan(2);
    const dragText = async () => {
      await editor.press("ArrowLeft");
      const bounds = await editor
        .locator(".cm-line")
        .nth(1)
        .evaluate((line) => {
          const text = line.firstChild!;
          const range = document.createRange();
          range.setStart(text, 2);
          range.setEnd(text, 6);
          const rect = range.getBoundingClientRect();
          return {
            from: rect.left + 0.1,
            to: rect.right - 0.1,
            y: (rect.top + rect.bottom) / 2,
          };
        });
      await page.mouse.move(bounds.from, bounds.y);
      await page.mouse.down();
      await page.mouse.move(bounds.to, bounds.y, { steps: 5 });
      await page.mouse.up();
      await expect
        .poll(() => editor.evaluate(() => window.getSelection()?.toString()))
        .toBe("орая");
      await expect.poll(selectionAlignment).toBeLessThan(2);
    };
    await dragText();
    await editor.press("Home");
    await editor.press("Shift+End");
    await expect(
      toolbar.getByRole("button", { name: "Жирный", exact: true }),
    ).toHaveAttribute("aria-pressed", "false");
    await editor
      .locator(".cm-line")
      .nth(1)
      .click({ button: "right", position: { x: 24, y: 10 } });
    const menu = page.getByRole("menu", { name: "Действия редактора" });
    await expect(menu).toContainText("Форматирование");
    await menu
      .getByRole("menuitemcheckbox", { name: "Цитата", exact: true })
      .click();
    await expect(
      toolbar.getByRole("button", { name: "Цитата", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await editor.press("Control+z");
    await expect(
      toolbar.getByRole("button", { name: "Цитата", exact: true }),
    ).toHaveAttribute("aria-pressed", "false");
    await setMode(page, "Live Preview");
    await dragText();
    await page.screenshot({
      path: test.info().outputPath("editor-toolbar-dark.png"),
    });
    await page.getByRole("button", { name: "Переключить тему" }).click();
    await page.screenshot({
      path: test.info().outputPath("editor-toolbar-light.png"),
    });
    await page.setViewportSize({ width: 800, height: 650 });
    await editor.focus();
    await expect.poll(selectionAlignment).toBeLessThan(2);
    expect(
      await toolbar.evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
    ).toBe(true);
    await page
      .getByRole("button", { name: "Переключить правую панель" })
      .click();
    const linkBox = (await toolbar
      .getByRole("button", { name: "Wiki-ссылка" })
      .boundingBox())!;
    const closeBox = (await toolbar
      .getByRole("button", { name: "Скрыть панель форматирования" })
      .boundingBox())!;
    const boldBox = (await toolbar
      .getByRole("button", { name: "Жирный", exact: true })
      .boundingBox())!;
    expect(linkBox.y).toBe(closeBox.y);
    expect(linkBox.y).toBeGreaterThan(boldBox.y);
    await page.screenshot({
      path: test.info().outputPath("editor-toolbar-narrow.png"),
    });
    await page
      .getByRole("button", { name: "Переключить правую панель" })
      .click();
    await toolbar
      .getByRole("button", { name: "Скрыть панель форматирования" })
      .click();
    await expect(toolbar).toHaveCount(0);
    await setMode(page, "Исходник");
    await page
      .getByRole("button", { name: "Переключить правую панель" })
      .click();
    await editor.fill(
      Array.from(
        { length: 8 },
        (_, index) =>
          `${index + 1} ${"длиннаястрока".repeat(25)} [[Без названия]]`,
      ).join("\n"),
    );
    const scroller = page.locator(".cm-scroller");
    const gutterClearance = () =>
      page.locator(".cm-editor").evaluate((element) => {
        const gutter = element
          .querySelector(".cm-gutters")!
          .getBoundingClientRect();
        return (
          element.querySelector(".cm-content")!.getBoundingClientRect().left -
          gutter.right
        );
      });
    await expect.poll(gutterClearance).toBeGreaterThanOrEqual(0);
    await expect
      .poll(() =>
        scroller.evaluate(
          (element) => element.scrollWidth - element.clientWidth,
        ),
      )
      .toBeLessThan(2);
    await noteAction(page, "Перенос строк");
    await expect(editor).not.toHaveClass(/cm-lineWrapping/);
    await expect
      .poll(() =>
        scroller.evaluate(
          (element) => element.scrollWidth - element.clientWidth,
        ),
      )
      .toBeGreaterThan(100);
    expect(
      await page.evaluate(() => localStorage.getItem("aether.ui.lineWrapping")),
    ).toBe("false");
    await scroller.evaluate((element) => {
      element.scrollLeft = 150;
    });
    expect(
      await page.locator(".cm-gutters").evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const viewport = element.parentElement!.getBoundingClientRect();
        return !!document
          .elementFromPoint(
            rect.left + rect.width / 2,
            (viewport.top + viewport.bottom) / 2,
          )
          ?.closest(".cm-gutters");
      }),
    ).toBe(true);
    await noteAction(page, "Перенос строк");
    await expect(editor).toHaveClass(/cm-lineWrapping/);
    await expect.poll(gutterClearance).toBeGreaterThanOrEqual(0);
    await expect
      .poll(() => scroller.evaluate((element) => element.scrollLeft))
      .toBe(0);
    const numberAlignment = await page
      .locator(".cm-editor")
      .evaluate((element) => {
        const number = [
          ...element.querySelectorAll(".cm-lineNumbers .cm-gutterElement"),
        ].find(
          (entry) =>
            entry.textContent === "1" &&
            entry.getBoundingClientRect().height > 0,
        )!;
        const glyph = document.createRange();
        glyph.selectNodeContents(number);
        const text = document.createRange();
        text.selectNodeContents(element.querySelector(".cm-line")!);
        return Math.abs(
          glyph.getClientRects()[0].top - text.getClientRects()[0].top,
        );
      });
    // Different font metrics and the optical offset still keep the digit on the first visual row.
    expect(numberAlignment).toBeLessThan(12);
    await page.screenshot({
      path: test.info().outputPath("narrow-editor-wrapping.png"),
    });
  } finally {
    await stop(app);
  }
});

test("welcome creates notes immediately and vault creation uses a single name/location form", async () => {
  const temporary = await mkdtemp(join(root, ".build-cache/native-welcome-"));
  const vault = join(temporary, "Native-MVP");
  const data = join(temporary, "data");
  await mkdir(vault);
  await mkdir(data);
  await writeFile(
    join(data, "settings.json"),
    JSON.stringify({ lastVault: vault }),
  );
  let app: RunningApp | undefined;
  try {
    app = await launch(data, join(temporary, "profile"), false);
    const page = app.page;
    const welcome = page.locator(".quiet-welcome");
    const noteButton = welcome.getByRole("button", { name: /Создать заметку/ });
    const vaultButton = welcome.getByRole("button", {
      name: "Создать хранилище",
      exact: true,
    });
    expect((await noteButton.boundingBox())!.width).toBe(
      (await vaultButton.boundingBox())!.width,
    );
    const actionButtons = welcome.locator(".button");
    await expect(actionButtons).toHaveCount(3);
    const bounds = await actionButtons.evaluateAll((buttons) =>
      buttons.map((button) => {
        const label = button
          .querySelector(".welcome-action-label")!
          .getBoundingClientRect();
        const shortcut = button.querySelector("kbd")!.getBoundingClientRect();
        return { left: label.left, right: shortcut.right };
      }),
    );
    expect(new Set(bounds.map((value) => value.left)).size).toBe(1);
    expect(new Set(bounds.map((value) => value.right)).size).toBe(1);
    const pageCount = page.context().pages().length;
    expect(
      await page.evaluate(() => {
        window.open("about:blank", "_blank");
        window.alert("Native browser dialog should be suppressed");
        return window.confirm(
          "Native browser confirmation should be suppressed",
        );
      }),
    ).toBe(false);
    expect(page.context().pages().length).toBe(pageCount);
    await page.screenshot({
      path: test.info().outputPath("welcome-actions.png"),
    });
    await noteButton.click();
    await expect(page.locator("dialog[open]")).toHaveCount(0);
    await expect(
      page.getByRole("textbox", { name: "Название заметки" }),
    ).toHaveValue("Новая заметка");
    expect(await readFile(join(vault, "Новая заметка.md"), "utf8")).toBe("");
    await page.keyboard.press("Control+w");
    await page.keyboard.press("Control+Shift+n");
    let dialog = page.getByRole("dialog");
    await expect(
      dialog.getByRole("button", { name: "Создать хранилище", exact: true }),
    ).toBeDisabled();
    await dialog
      .getByRole("textbox", { name: "Название хранилища" })
      .fill("Новый архив");
    await dialog
      .getByRole("textbox", { name: "Расположение", exact: true })
      .fill(temporary);
    await expect(dialog).toHaveAccessibleName("Новое хранилище");
    await page.screenshot({
      path: test.info().outputPath("redesigned-vault-dialog.png"),
    });
    await page.screenshot({ path: test.info().outputPath("create-vault.png") });
    await dialog.getByRole("button", { name: "Отмена", exact: true }).click();
    expect(await readdir(temporary)).not.toContain("Новый архив");
    await page.keyboard.press("Control+p");
    await expect(
      page.getByRole("dialog", { name: "Палитра команд" }),
    ).toBeVisible();
    await page.screenshot({
      path: test.info().outputPath("redesigned-command-palette.png"),
    });
    await page.keyboard.press("Escape");
    await vaultButton.click();
    dialog = page.getByRole("dialog");
    await dialog
      .getByRole("textbox", { name: "Название хранилища" })
      .fill("Новый архив");
    await dialog
      .getByRole("textbox", { name: "Расположение", exact: true })
      .fill(temporary);
    await dialog
      .getByRole("button", { name: "Создать хранилище", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Хранилище: Новый архив" }),
    ).toBeVisible();
    expect(await readdir(temporary)).toContain("Новый архив");
    await page.keyboard.press("Control+n");
    await expect(page.locator("dialog[open]")).toHaveCount(0);
    await expect(
      page.getByRole("textbox", { name: "Название заметки" }),
    ).toHaveValue("Новая заметка");
    expect(
      await readFile(
        join(temporary, "Новый архив", "Новая заметка.md"),
        "utf8",
      ),
    ).toBe("");
    await page.keyboard.press("Control+Shift+f");
    await expect(page.locator(".search-pagination")).toHaveCount(0);
  } finally {
    await stop(app);
  }
});
type RunningApp = {
  child: ChildProcess;
  browser: Browser;
  page: Page;
  exited: Promise<unknown>;
};

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((done, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", done);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("No test CDP port");
  await new Promise<void>((done, reject) =>
    server.close((error) => (error ? reject(error) : done())),
  );
  return address.port;
}

async function launch(
  data: string,
  profile: string,
  showRelations = true,
): Promise<RunningApp> {
  const port = await freePort();
  const child = spawn(executable, [], {
    cwd: root,
    windowsHide: true,
    stdio: "ignore",
    env: {
      ...process.env,
      AETHER_E2E_DATA_DIR: data,
      WEBVIEW2_USER_DATA_FOLDER: profile,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port} --remote-debugging-address=127.0.0.1 --disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows`,
    },
  });
  let startupError: Error | undefined;
  child.once("error", (error) => {
    startupError = error;
  });
  const exited = new Promise((done) => child.once("exit", done));
  try {
    await expect
      .poll(
        async () => {
          if (startupError) throw startupError;
          if (child.exitCode !== null)
            throw new Error(
              `Native app exited before WebView2 started: ${child.exitCode}`,
            );
          try {
            return (
              await fetch(`http://127.0.0.1:${port}/json/version`, {
                signal: AbortSignal.timeout(800),
              })
            ).ok;
          } catch {
            return false;
          }
        },
        { timeout: 30_000, message: "Real WebView2 CDP endpoint starts" },
      )
      .toBe(true);
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    await expect
      .poll(
        () => browser.contexts().flatMap((context) => context.pages()).length,
      )
      .toBeGreaterThan(0);
    const page = browser.contexts().flatMap((context) => context.pages())[0];
    await page.getByRole("button", { name: "Хранилище: Native-MVP" }).waitFor();
    if (
      showRelations &&
      (await page
        .getByRole("button", { name: "Переключить правую панель" })
        .getAttribute("aria-expanded")) === "false"
    )
      await page
        .getByRole("button", { name: "Переключить правую панель" })
        .click();
    return { child, browser, page, exited };
  } catch (error) {
    child.kill();
    throw error;
  }
}

async function stop(app: RunningApp | undefined): Promise<void> {
  if (!app) return;
  await app.browser.close().catch(() => {});
  if (app.child.exitCode === null) app.child.kill();
  await app.exited;
}

async function closeNative(app: RunningApp, button: Locator): Promise<void> {
  await button.click({ noWaitAfter: true }).catch((error: unknown) => {
    // WebView2 may disappear before Chromium acknowledges the successful click.
    if (!app.page.isClosed()) throw error;
  });
  await expect.poll(() => app.child.exitCode, { timeout: 15_000 }).toBe(0);
  await app.exited;
}

async function noteAction(page: Page, label: string) {
  if (label === "Переименовать") {
    await page.keyboard.press("Control+p");
    await page
      .getByRole("textbox", { name: "Поиск команды" })
      .fill("Предпросмотр переименования");
    await page
      .getByRole("button", { name: "Предпросмотр переименования", exact: true })
      .click();
    return;
  }
  await page
    .getByRole("button", { name: "Действия с заметкой", exact: true })
    .click();
  await page
    .getByRole("group", { name: "Действия с заметкой", exact: true })
    .getByRole("button", { name: label, exact: true })
    .click();
}
async function setMode(page: Page, label: string) {
  await page
    .getByRole("button", { name: "Режим заметки", exact: true })
    .click();
  await page
    .getByRole("group", { name: "Режим заметки", exact: true })
    .getByRole("button", { name: label, exact: true })
    .click();
}
async function formatAction(page: Page, label: string) {
  if (
    !(await page.getByRole("toolbar", { name: "Форматирование" }).isVisible())
  )
    await noteAction(page, "Панель форматирования");
  await page
    .getByRole("toolbar", { name: "Форматирование" })
    .getByRole("button", { name: label, exact: true })
    .click();
}
async function create(page: Page, path: string, directory = false) {
  await page
    .getByRole("button", {
      name: directory ? "Новая папка" : "Новая заметка",
      exact: true,
    })
    .click();
  if (directory) {
    const name = page.getByRole("textbox", { name: "Имя папки" });
    await name.fill(path);
    await name.press("Enter");
    await expect(
      page.locator(`.tree-item[data-tooltip="${path}"]`),
    ).toBeVisible();
    return;
  }
  const dialog = page.locator("dialog[open]");
  await dialog.getByLabel("Имя и путь").fill(path);
  await dialog.getByRole("button", { name: "Создать", exact: true }).click();
  await expect(dialog).toHaveCount(0);
}

test("native MVP: real files, Unicode, conflicts, trash, tabs, close guard and restart recovery", async () => {
  test.skip(
    process.platform !== "win32",
    "Native WebView2 acceptance runs on Windows",
  );
  await access(executable);
  await mkdir(resolve(root, ".build-cache"), { recursive: true });
  const run = await mkdtemp(resolve(root, ".build-cache/native-mvp-"));
  const vault = join(run, "Native-MVP");
  const data = join(run, "app-data");
  const profile = join(run, "webview-profile");
  await mkdir(join(vault, "Заметки"), { recursive: true });
  await mkdir(data, { recursive: true });
  const seed =
    "---\r\ntags: [Работа]\r\nstatus: draft\r\n---\r\n# Начало\r\n\r\nПроверка UTF-8 и CRLF. knowledge\r\n[[Заметки/Вторая|Связь]] [[Новая связанная]]\r\n";
  await writeFile(join(vault, "Начало.md"), seed, "utf8");
  await writeFile(join(vault, "Заметки", "Вторая.md"), "# Вторая\n", "utf8");
  await writeFile(
    join(data, "settings.json"),
    JSON.stringify({ lastVault: vault }),
  );
  await test
    .info()
    .attach("isolated-vault", { body: vault, contentType: "text/plain" });
  let app: RunningApp | undefined;

  try {
    app = await launch(data, profile);
    let page = app.page;
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));

    await test.step("open nested Markdown and preserve CRLF through actual IPC save", async () => {
      await page.getByRole("button", { name: "Начало", exact: true }).click();
      const editor = page.getByRole("textbox", { name: "Markdown-редактор" });
      await expect(editor).toContainText("Проверка UTF-8");
      await editor.press("Control+End");
      await editor.pressSequentially("Сохранено из WebView2.");
      await page
        .getByRole("button", { name: "Сохранить", exact: true })
        .click();
      await expect
        .poll(() => readFile(join(vault, "Начало.md"), "utf8"))
        .toBe(seed + "Сохранено из WebView2.");
      await page.getByRole("button", { name: "Заметки", exact: true }).click();
      await page.getByRole("button", { name: "Вторая", exact: true }).click();
      await expect(page.getByRole("tab")).toHaveCount(2);
    });

    await test.step("wiki navigation, backlinks, missing-link creation, filtered FTS and external watcher", async () => {
      await expect(page.locator(".note-relations")).toContainText("Начало");
      await page
        .locator(".relation-link")
        .filter({ hasText: "Начало" })
        .click();
      await expect(
        page.getByRole("tab", { name: "Начало", exact: true }),
      ).toHaveAttribute("aria-selected", "true");
      await expect(page.locator(".note-tags")).toContainText("работа");
      await page
        .locator(".relation-link")
        .filter({ hasText: "Новая связанная" })
        .click();
      await page
        .locator("dialog[open]")
        .getByRole("button", { name: "Создать", exact: true })
        .click();
      await expect
        .poll(() =>
          readFile(join(vault, "Новая связанная.md"), "utf8").catch((error) => {
            if (error.code === "ENOENT") return null;
            throw error;
          }),
        )
        .toBe("");
      await page
        .getByRole("button", { name: "Закрыть Новая связанная", exact: true })
        .click();
      await page.getByRole("tab", { name: "Начало", exact: true }).click();
      await page
        .getByRole("button", { name: "Поиск по хранилищу", exact: true })
        .click();
      await page
        .getByRole("textbox", { name: "Поиск по содержимому" })
        .fill("know");
      await page.locator(".search-filters > summary").click();
      await page.getByRole("textbox", { name: "Фильтр тега" }).fill("работа");
      await page.getByRole("textbox", { name: "Имя свойства" }).fill("status");
      await page
        .getByRole("textbox", { name: "Значение свойства" })
        .fill("draft");
      await expect(page.locator(".search-hit")).toHaveCount(1);
      await expect(page.locator(".search-hit")).toContainText("Начало.md");
      await expect(page.locator(".search-hit mark").first()).toBeVisible();
      await writeFile(
        join(vault, "Наблюдение.md"),
        "# Наблюдение\nвнешнийпоиск",
        "utf8",
      );
      await page.getByRole("textbox", { name: "Фильтр тега" }).fill("");
      await page.getByRole("textbox", { name: "Имя свойства" }).fill("");
      await page.getByRole("textbox", { name: "Значение свойства" }).fill("");
      await page
        .getByRole("textbox", { name: "Поиск по содержимому" })
        .fill("внешнийпоиск");
      await expect(page.locator(".search-hit")).toHaveCount(1);
      await expect(page.locator(".search-hit")).toContainText("Наблюдение.md");
      await page.screenshot({
        path: test.info().outputPath("knowledge-search.png"),
      });
      await page
        .getByRole("button", { name: "Показать проводник", exact: true })
        .click();
    });

    await test.step("create a folder and Unicode note, rename without overwriting", async () => {
      await create(page, "Создано", true);
      await create(page, "Создано/Юникод.md");
      await page
        .getByRole("textbox", { name: "Markdown-редактор" })
        .fill("# Юникод\n\nМой текст.");
      await page
        .getByRole("button", { name: "Сохранить", exact: true })
        .click();
      await expect
        .poll(() => readFile(join(vault, "Создано/Юникод.md"), "utf8"))
        .toBe("# Юникод\n\nМой текст.");
      await noteAction(page, "Переименовать");
      const dialog = page.locator("dialog[open]");
      await dialog.getByLabel("Имя и путь").fill("Создано/Переименовано.md");
      await dialog
        .getByRole("button", { name: "Предпросмотр", exact: true })
        .click();
      await dialog
        .getByRole("button", { name: "Применить переименование", exact: true })
        .click();
      await expect(
        page.getByRole("tab", { name: "Переименовано", exact: true }),
      ).toHaveAttribute("aria-selected", "true");
      await expect
        .poll(() => readFile(join(vault, "Создано/Переименовано.md"), "utf8"))
        .toContain("Мой текст.");
      await expect(access(join(vault, "Создано/Юникод.md"))).rejects.toThrow();
    });

    await test.step("preserve an external edit and save the editor version as a new copy", async () => {
      await writeFile(
        join(vault, "Создано/Переименовано.md"),
        "Внешняя версия",
        "utf8",
      );
      await page
        .getByRole("textbox", { name: "Markdown-редактор" })
        .fill("Версия редактора");
      await page
        .getByRole("button", { name: "Сохранить", exact: true })
        .click();
      await expect(page.getByRole("alert")).toContainText(
        "Файл изменился на диске",
      );
      expect(
        await readFile(join(vault, "Создано/Переименовано.md"), "utf8"),
      ).toBe("Внешняя версия");
      await noteAction(page, "Сохранить копию");
      const dialog = page.locator("dialog[open]");
      await dialog.getByLabel("Имя и путь").fill("Создано/Копия.md");
      await dialog
        .getByRole("button", { name: "Создать", exact: true })
        .click();
      await expect
        .poll(async () => {
          try {
            return await readFile(join(vault, "Создано/Копия.md"), "utf8");
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
            throw error;
          }
        })
        .toBe("Версия редактора");
      await page
        .getByRole("button", { name: "Закрыть Переименовано", exact: true })
        .click();
      await page
        .locator("dialog[open]")
        .getByRole("button", { name: "Отбросить изменения", exact: true })
        .click();
    });

    await test.step("trash the test copy with a recoverable original, reject path traversal", async () => {
      await noteAction(page, "Переместить в корзину");
      await page
        .locator("dialog[open]")
        .getByRole("button", { name: "В корзину", exact: true })
        .click();
      await expect
        .poll(
          async () =>
            (await readdir(join(vault, ".aether/trash"))).filter((name) =>
              name.endsWith(".md"),
            ).length,
        )
        .toBe(1);
      const [trashed] = await readdir(join(vault, ".aether/trash"));
      expect(
        await readFile(join(vault, ".aether/trash", trashed), "utf8"),
      ).toBe("Версия редактора");
      await expect
        .poll(async () => {
          try {
            await access(join(vault, "Создано/Копия.md"));
            return false;
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
            throw error;
          }
        })
        .toBe(true);
      await create(page, "../outside.md");
      await expect(page.getByRole("alert")).toBeVisible();
      await expect(access(join(run, "outside.md"))).rejects.toThrow();
    });

    await test.step("cancel close with unsaved text, then close and restore the draft and theme", async () => {
      await page.getByRole("tab", { name: "Начало", exact: true }).click();
      await page
        .getByRole("textbox", { name: "Markdown-редактор" })
        .fill("Несохранённый черновик после перезапуска.");
      await page
        .getByRole("button", { name: "Переключить тему", exact: true })
        .click();
      const theme = await page.locator("html").getAttribute("data-theme");
      await page
        .getByRole("button", { name: "Закрыть окно", exact: true })
        .click();
      await expect(page.locator("dialog[open]")).toContainText(
        "Закрыть приложение?",
      );
      await page
        .locator("dialog[open]")
        .getByRole("button", { name: "Отмена", exact: true })
        .click();
      await expect(
        page.getByRole("textbox", { name: "Markdown-редактор" }),
      ).toContainText("Несохранённый черновик");
      expect(await readFile(join(vault, "Начало.md"), "utf8")).toBe(
        seed + "Сохранено из WebView2.",
      );
      await page
        .getByRole("button", { name: "Закрыть окно", exact: true })
        .click();
      await closeNative(
        app!,
        page
          .locator("dialog[open]")
          .getByRole("button", { name: "Закрыть", exact: true }),
      );
      app = await launch(data, profile);
      page = app.page;
      await expect(page.getByRole("tab")).toHaveCount(2);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme!);
      await expect(
        page.getByRole("textbox", { name: "Markdown-редактор" }),
      ).toContainText("Несохранённый черновик после перезапуска.");
      expect(await readFile(join(vault, "Начало.md"), "utf8")).toBe(
        seed + "Сохранено из WebView2.",
      );
      await page
        .getByRole("button", { name: "Сохранить", exact: true })
        .click();
      await expect
        .poll(() => readFile(join(vault, "Начало.md"), "utf8"))
        .toBe("Несохранённый черновик после перезапуска.");
      await page.screenshot({ path: test.info().outputPath("native-mvp.png") });
    });
    await test.step("a damaged SQLite cache cannot disable editing Markdown", async () => {
      await closeNative(
        app!,
        page.getByRole("button", { name: "Закрыть окно", exact: true }),
      );
      const caches = (await readdir(join(data, "indexes"))).filter((name) =>
        name.endsWith(".sqlite"),
      );
      expect(caches).toHaveLength(1);
      await writeFile(
        join(data, "indexes", caches[0]),
        "damaged test cache",
        "utf8",
      );
      app = await launch(data, profile);
      page = app.page;
      await expect(page.locator(".inspector .tree-error")).toContainText(
        "Сведения индекса недоступны",
      );
      await create(page, "Кеш не мешает.md");
      await page
        .getByRole("textbox", { name: "Markdown-редактор" })
        .fill("Файл остаётся источником истины.");
      await page
        .getByRole("button", { name: "Сохранить", exact: true })
        .click();
      await expect
        .poll(() => readFile(join(vault, "Кеш не мешает.md"), "utf8"))
        .toBe("Файл остаётся источником истины.");
    });
    expect(errors).toEqual([]);
  } catch (error) {
    if (app && !app.page.isClosed())
      await test.info().attach("native-runtime-banners", {
        body: JSON.stringify(
          await app.page.locator(".banner").allTextContents(),
        ),
        contentType: "application/json",
      });
    throw error;
  } finally {
    await stop(app);
  }
});

test("stage 2: native anchor navigation, rename preview, dirty guards, undo, conflicts and journal recovery", async () => {
  test.skip(process.platform !== "win32", "Native WebView2 runs on Windows");
  const run = await mkdtemp(resolve(root, ".build-cache/native-stage2-"));
  const vault = join(run, "Native-MVP"),
    data = join(run, "data"),
    profile = join(run, "profile");
  await mkdir(join(vault, "A"), { recursive: true });
  await mkdir(join(vault, "B"));
  await mkdir(data);
  const source =
    "\uFEFF# Цель\r\n\r\n## **Секция**\r\n\r\nАбзац для блока ^block\r\n\r\n[[./Other#Раздел|Исходящая]]\r\n";
  const original =
    "\uFEFF---\r\nexample: '[[A/Target]]'\r\n---\r\n# Ссылки\r\n[[A/Target#Секция|К заголовку]]\r\n![[A/Target#^block|К блоку]]\r\n`[[A/Target]]`\r\n";
  await writeFile(join(vault, "A/Target.md"), source);
  await writeFile(join(vault, "A/Other.md"), "# Раздел\n");
  await writeFile(join(vault, "Ref.md"), original);
  await writeFile(
    join(data, "settings.json"),
    JSON.stringify({ lastVault: vault }),
  );
  let app: RunningApp | undefined;
  try {
    app = await launch(data, profile);
    let page = app.page;
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const editor = () =>
      page.getByRole("textbox", { name: "Markdown-редактор" });
    const caretLine = () =>
      editor().evaluate(
        () =>
          window.getSelection()?.anchorNode?.parentElement?.closest(".cm-line")
            ?.textContent ?? "",
      );
    const link = (alias: string) =>
      page.locator(".relation-link").filter({ hasText: alias });
    const startPreview = async () => {
      await noteAction(page, "Переименовать");
      const dialog = page.locator("dialog[open]");
      await dialog.getByLabel("Имя и путь").fill("B/New.md");
      await dialog
        .getByRole("button", { name: "Предпросмотр", exact: true })
        .click();
      await expect(dialog).toContainText("Изменений ссылок: 3");
      return dialog;
    };
    await test.step("headings and blocks navigate in existing dirty buffers and preserve undo", async () => {
      await page.getByRole("button", { name: "Ref", exact: true }).click();
      // This scenario inspects literal Markdown around the caret.
      await setMode(page, "Исходник");
      await link("К заголовку").click();
      await expect.poll(caretLine).toBe("## **Секция**");
      await editor().fill(
        source.replace("# Цель", "# Цель\r\n😀 Несохранённая строка"),
      );
      await page.getByRole("tab", { name: /^Ref(?: |$)/ }).click();
      await link("К блоку").click();
      await expect.poll(caretLine).toBe("Абзац для блока ^block");
      await expect(editor()).toContainText("Несохранённая строка");
      await editor().press("Control+z");
      await expect(editor()).not.toContainText("Несохранённая строка");
      expect(await readFile(join(vault, "A/Target.md"), "utf8")).toBe(source);
    });
    await test.step("dirty related tabs block apply, and cancelling a clean preview changes no files", async () => {
      await page.getByRole("tab", { name: /^Ref(?: |$)/ }).click();
      await editor().press("Control+End");
      await editor().pressSequentially("draft");
      await page.getByRole("tab", { name: "Target", exact: true }).click();
      let dialog = await startPreview();
      await expect(
        dialog.getByRole("button", {
          name: "Применить переименование",
          exact: true,
        }),
      ).toBeDisabled();
      await dialog.getByRole("button", { name: "Отмена", exact: true }).click();
      await page.getByRole("tab", { name: /^Ref(?: |$)/ }).click();
      await noteAction(page, "Перечитать с диска");
      await page
        .locator("dialog[open]")
        .getByRole("button", { name: "Перечитать", exact: true })
        .click();
      await page.getByRole("tab", { name: "Target", exact: true }).click();
      dialog = await startPreview();
      await expect(dialog.locator(".rename-after")).toContainText([
        "[[A/Other#Раздел|Исходящая]]",
        "[[B/New#Секция|К заголовку]]",
        "![[B/New#^block|К блоку]]",
      ]);
      await page.screenshot({
        path: test.info().outputPath("rename-preview.png"),
      });
      await dialog.getByRole("button", { name: "Отмена", exact: true }).click();
      expect(await readFile(join(vault, "Ref.md"), "utf8")).toBe(original);
      await expect(access(join(vault, "B/New.md"))).rejects.toThrow();
    });
    await test.step("apply rewrites only real links, refreshes tabs, and undo restores byte-identical files", async () => {
      const dialog = await startPreview();
      await dialog
        .getByRole("button", { name: "Применить переименование", exact: true })
        .click();
      await expect(
        page.getByRole("tab", { name: "New", exact: true }),
      ).toHaveAttribute("aria-selected", "true");
      await expect
        .poll(() => readFile(join(vault, "Ref.md"), "utf8"))
        .toBe(original.replaceAll("A/Target#", "B/New#"));
      expect(await readFile(join(vault, "B/New.md"), "utf8")).toBe(
        source.replace("./Other", "A/Other"),
      );
      await page.getByRole("tab", { name: /^Ref(?: |$)/ }).click();
      await expect(editor()).toContainText("B/New#Секция");
      await expect(link("К заголовку")).toHaveAttribute(
        "data-tooltip",
        "B/New.md\nК заголовку",
      );
      await link("К заголовку").click();
      await page.screenshot({
        path: test.info().outputPath("after-rename-navigation.png"),
      });
      await expect.poll(caretLine).toBe("## **Секция**");
      await noteAction(page, "Отменить переименование");
      await page
        .locator("dialog[open]")
        .getByRole("button", { name: "Отменить переименование", exact: true })
        .click();
      await expect
        .poll(() => readFile(join(vault, "Ref.md"), "utf8"))
        .toBe(original);
      await expect(
        page.getByRole("tab", { name: "Target", exact: true }),
      ).toHaveAttribute("aria-selected", "true");
      expect(await readFile(join(vault, "A/Target.md"), "utf8")).toBe(source);
    });
    await test.step("changes after preview refuse all writes", async () => {
      const dialog = await startPreview();
      await writeFile(join(vault, "Added.md"), "external");
      await dialog
        .getByRole("button", { name: "Применить переименование", exact: true })
        .click();
      await expect(page.getByRole("alert")).toContainText(
        "изменилось после предпросмотра",
      );
      expect(await readFile(join(vault, "A/Target.md"), "utf8")).toBe(source);
      expect(await readFile(join(vault, "Ref.md"), "utf8")).toBe(original);
    });
    await test.step("restart detects a partially applied durable journal and recovers only on request", async () => {
      await closeNative(
        app!,
        page.getByRole("button", { name: "Закрыть окно", exact: true }),
      );
      const id = "r-999-1",
        journal = join(vault, ".aether/renames", id);
      await mkdir(journal, { recursive: true });
      const afterSource = source.replace("./Other", "A/Other"),
        afterRef = original.replaceAll("A/Target#", "B/New#");
      const sha = (value: string) =>
        createHash("sha256").update(value).digest("hex");
      for (const [i, before, after] of [
        [0, source, afterSource],
        [1, original, afterRef],
      ] as const) {
        await writeFile(join(journal, `${i}-before.txt`), before);
        await writeFile(join(journal, `${i}-after.txt`), after);
      }
      await writeFile(
        join(journal, "manifest.json"),
        JSON.stringify({
          version: 1,
          id,
          from: "A/Target.md",
          to: "B/New.md",
          state: "prepared",
          previous: null,
          unresolved: 0,
          files: [
            {
              path: "A/Target.md",
              afterPath: "B/New.md",
              before: sha(source),
              after: sha(afterSource),
            },
            {
              path: "Ref.md",
              afterPath: "Ref.md",
              before: sha(original),
              after: sha(afterRef),
            },
          ],
        }),
      );
      await writeFile(
        join(vault, ".aether/rename.json"),
        JSON.stringify({ id }),
      );
      // Simulate a crash after one related file was written. The source still has its old name.
      await writeFile(join(vault, "Ref.md"), afterRef);
      app = await launch(data, profile);
      page = app.page;
      await expect(page.getByRole("alert").first()).toContainText(
        "незавершённое переименование",
      );
      expect(await readFile(join(vault, "Ref.md"), "utf8")).toBe(afterRef);
      await page
        .getByRole("button", { name: "Восстановить", exact: true })
        .click();
      await page
        .locator("dialog[open]")
        .getByRole("button", { name: "Восстановить", exact: true })
        .click();
      await expect
        .poll(() => readFile(join(vault, "Ref.md"), "utf8"))
        .toBe(original);
      expect(await readFile(join(vault, "A/Target.md"), "utf8")).toBe(source);
      await expect(
        page
          .getByRole("alert")
          .filter({ hasText: "незавершённое переименование" }),
      ).toHaveCount(0);
    });
    expect(errors).toEqual([]);
  } finally {
    await stop(app);
  }
});

test("stage 3: reading, local images, KaTeX, sandboxed Mermaid, live editing, completion and formatting", async () => {
  test.skip(process.platform !== "win32", "Native WebView2 runs on Windows");
  const run = await mkdtemp(resolve(root, ".build-cache/native-stage3-"));
  const vault = join(run, "Native-MVP"),
    data = join(run, "data"),
    profile = join(run, "profile");
  await mkdir(join(vault, "assets"), { recursive: true });
  await mkdir(data);
  const content =
    "---\r\ntags: [Проверка]\r\n---\r\n# Пространство для идей\r\n\r\nЗаметка с **важными мыслями**, *акцентами* и `кодом`.\r\n\r\n> Сначала идея. Затем ясный план.\r\n\r\n## План работы\r\n\r\n- [x] Собрать материалы\r\n- [ ] Подготовить черновик\r\n\r\n| Этап | Состояние |\r\n| --- | --- |\r\n| База знаний | Готово |\r\n| Редактор | В работе |\r\n\r\n[Перейти к разделу](Target.md#Раздел) · [[Target#^block|Перейти к блоку]]\r\n\r\n![Пиксель](assets/pixel.png)\r\n\r\nФормула: $x^2+y^2=z^2$\r\n\r\n```mermaid\r\nflowchart LR\r\n  A[Идея] --> B[Заметка]\r\n  B --> C[Связи]\r\n```\r\n\r\n<script>window.__noteExecuted=true</script>\r\n\r\n[Плохая ссылка](javascript:alert(1))\r\n\r\n![Внешняя картинка](https://example.invalid/pixel.png)\r\n";
  await writeFile(join(vault, "Guide.md"), content);
  await writeFile(
    join(vault, "Target.md"),
    "# Цель\n\n## Раздел\n\nНужный блок ^block\n",
  );
  await writeFile(
    join(vault, "assets/pixel.png"),
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jB1kAAAAASUVORK5CYII=",
      "base64",
    ),
  );
  await writeFile(
    join(data, "settings.json"),
    JSON.stringify({ lastVault: vault }),
  );
  let app: RunningApp | undefined;
  try {
    app = await launch(data, profile);
    const page = app.page;
    const errors: string[] = [];
    const remote: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("request", (r) => {
      if (r.url().includes("example.invalid")) remote.push(r.url());
    });
    await page.getByRole("button", { name: "Guide", exact: true }).click();
    const editor = page.getByRole("textbox", { name: "Markdown-редактор" });
    await editor.press("Control+End");
    await editor.pressSequentially("Несохранённый текст.");
    await setMode(page, "Чтение");
    const reading = page.getByRole("region", { name: "Просмотр заметки" });
    await expect(
      reading.getByRole("heading", { name: "Пространство для идей" }),
    ).toBeVisible();
    await expect(reading.locator("table")).toContainText("База знаний");
    await expect(reading.locator("strong")).toHaveText("важными мыслями");
    await page.screenshot({ path: test.info().outputPath("reading-mode.png") });
    await expect(reading).toContainText("Несохранённый текст.");
    expect(await readFile(join(vault, "Guide.md"), "utf8")).toBe(content);
    const image = reading.getByAltText("Пиксель");
    await reading.locator(".reading-image").first().scrollIntoViewIfNeeded();
    await expect(image).toHaveAttribute("src", /^data:image\/png;base64,/);
    await expect
      .poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth))
      .toBe(1);
    await expect(reading.locator(".katex")).toHaveCount(1);
    const diagram = reading.getByTitle("Диаграмма Mermaid");
    await expect(diagram).toHaveAttribute("sandbox", "");
    await expect(
      page.frameLocator('iframe[title="Диаграмма Mermaid"]').locator("svg"),
    ).toHaveCount(1);
    await diagram.scrollIntoViewIfNeeded();
    await page.screenshot({ path: test.info().outputPath("math-mermaid.png") });
    expect(await page.evaluate(() => "__noteExecuted" in window)).toBe(false);
    await expect(reading.locator("script")).toHaveCount(0);
    await expect(
      reading.getByRole("link", { name: "Плохая ссылка" }),
    ).toHaveCount(0);
    expect(remote).toEqual([]);
    await reading.getByRole("link", { name: "Перейти к разделу" }).click();
    await expect(
      reading.getByRole("heading", { name: "Раздел" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: "Переключить режим чтения",
        exact: true,
      }),
    ).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("tab", { name: /^Guide(?: |$)/ }).click();
    await reading.getByRole("link", { name: "Перейти к блоку" }).click();
    await expect(reading).toContainText("Нужный блок ^block");
    await page.getByRole("tab", { name: /^Guide(?: |$)/ }).click();
    await setMode(page, "Исходник");
    await expect(editor).toContainText("Несохранённый текст.");
    await editor.press("Control+z");
    await expect(editor).not.toContainText("Несохранённый текст.");
    await setMode(page, "Live Preview");
    await editor.press("Control+End");
    await expect(page.locator(".live-heading").first()).toBeVisible();
    await editor.press("Control+Home");
    await editor.press("Control+End");
    await editor.press("Enter");
    await editor.pressSequentially("[[Tar");
    await expect(page.getByRole("option", { name: /Target/ })).toBeVisible();
    await editor.press("Enter");
    await expect(editor).toContainText("[[Target]]");
    await editor.press("End");
    await editor.press("Enter");
    await editor.pressSequentially("[[Target#");
    await expect(page.getByRole("option", { name: /Раздел/ })).toBeVisible();
    await expect(page.getByRole("option", { name: /\^block/ })).toBeVisible();
    await editor.press("Escape");
    await editor.press("Control+a");
    await formatAction(page, "Жирный");
    await expect(editor).toContainText("**---");
    await editor.press("Control+z");
    await editor.fill(
      "# Ошибки отображения\n\n$\\href{javascript:alert(1)}{bad}$\n\n```mermaid\nnot valid diagram syntax\n```\n\nОстальной текст доступен.",
    );
    await setMode(page, "Чтение");
    await expect(reading).toContainText("Не удалось построить диаграмму");
    await expect(reading).toContainText("Остальной текст доступен.");
    await expect(reading.locator(".katex a")).toHaveCount(0);
    expect(await readFile(join(vault, "Guide.md"), "utf8")).toBe(content);
    expect(errors).toEqual([]);
  } finally {
    await stop(app);
  }
});

test("live rich blocks: inline/display math, table, image, Mermaid, source editing and byte-safe undo", async () => {
  test.skip(process.platform !== "win32", "Native WebView2 runs on Windows");
  const run = await mkdtemp(resolve(root, ".build-cache/native-live-blocks-"));
  const vault = join(run, "Native-MVP"),
    data = join(run, "data"),
    profile = join(run, "profile");
  await mkdir(vault);
  await mkdir(data);
  const content =
    "\uFEFF# Живой документ 😀\r\n\r\nТекст и формула $x+1$.\r\n\r\n![Пиксель](pixel.png)\r\n\r\n| Колонка | Значение |\r\n|---|---|\r\n| Строка | 42 |\r\n\r\n$$a^2$$\r\n\r\n```mermaid\r\nflowchart LR\r\n A[Заметка] --> B[Идея]\r\n```\r\n\r\nКонец документа.\r\n";
  await writeFile(join(vault, "Live.md"), content);
  await writeFile(
    join(vault, "pixel.png"),
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jB1kAAAAASUVORK5CYII=",
      "base64",
    ),
  );
  await writeFile(
    join(data, "settings.json"),
    JSON.stringify({ lastVault: vault }),
  );
  let app: RunningApp | undefined;
  try {
    app = await launch(data, profile);
    const page = app.page;
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.getByRole("button", { name: "Live", exact: true }).click();
    const editor = page.getByRole("textbox", { name: "Markdown-редактор" });
    await setMode(page, "Live Preview");
    await expect(
      page.locator('.live-block-preview[data-live-kind="table"] table'),
    ).toContainText("42");
    await expect(page.locator(".live-inline-preview .katex")).toHaveCount(1);
    const display = () =>
      page.locator('.live-block-preview[data-live-kind="math"]');
    await expect(display().locator(".katex")).toHaveCount(1);
    await expect(
      page.locator('.live-block-preview img[alt="Пиксель"]'),
    ).toHaveAttribute("src", /^data:image\/png;base64,/);
    await expect(
      page.frameLocator('iframe[title="Диаграмма Mermaid"]').locator("svg"),
    ).toHaveCount(1);
    expect(await readFile(join(vault, "Live.md"), "utf8")).toBe(content);
    await page.screenshot({
      path: test.info().outputPath("live-rich-blocks.png"),
    });
    await page
      .getByRole("button", { name: "Переключить тему", exact: true })
      .click();
    await expect(page.getByTitle("Диаграмма Mermaid")).toHaveAttribute(
      "srcdoc",
      /background:#f5f5f1/,
    );
    await expect(display().locator(".katex")).toHaveCount(1);
    await display()
      .getByRole("button", { name: "Изменить формулу", exact: true })
      .click();
    const sourceFormula = editor
      .locator(".cm-line")
      .filter({ hasText: "$$a^2$$" });
    await expect(sourceFormula).toBeVisible();
    await editor.press("End");
    await editor.press("ArrowLeft");
    await editor.press("ArrowLeft");
    await editor.pressSequentially("+1");
    await expect(editor).toContainText("$$a^2+1$$");
    await editor.press("Control+End");
    await expect(
      display().locator('annotation[encoding="application/x-tex"]'),
    ).toHaveText("a^2+1");
    await page.getByRole("button", { name: "Сохранить", exact: true }).click();
    await expect
      .poll(() => readFile(join(vault, "Live.md"), "utf8"))
      .toBe(content.replace("$$a^2$$", () => "$$a^2+1$$"));
    await page
      .locator('.live-block-preview[data-live-kind="table"]')
      .getByRole("button", { name: "Изменить таблицу", exact: true })
      .click();
    await expect(
      editor.locator(".cm-line").filter({ hasText: "| Колонка | Значение |" }),
    ).toBeVisible();
    await editor.press("Control+End");
    await expect(page.locator(".live-block-preview table")).toContainText("42");
    await setMode(page, "Исходник");
    await expect(page.locator(".live-block-preview")).toHaveCount(0);
    await editor.press("Control+z");
    await editor.press("Control+s");
    await expect
      .poll(() => readFile(join(vault, "Live.md"), "utf8"))
      .toBe(content);
    await setMode(page, "Live Preview");
    await editor.press("Control+End");
    await expect(display().locator(".katex")).toHaveCount(1);
    await editor.press("Control+a");
    await expect(
      page.locator(
        ".live-block-preview:not([data-source-visible]),.live-inline-preview",
      ),
    ).toHaveCount(0);
    await expect(editor).toContainText("```mermaid");
    expect(await readFile(join(vault, "Live.md"), "utf8")).toBe(content);
    expect(errors).toEqual([]);
  } finally {
    await stop(app);
  }
});

test("quiet workspace: default layout, discoverable menus, optional panels, persistence and narrow window", async () => {
  test.skip(process.platform !== "win32", "Native WebView2 runs on Windows");
  const run = await mkdtemp(resolve(root, ".build-cache/native-quiet-ui-"));
  const vault = join(run, "Native-MVP"),
    data = join(run, "data"),
    profile = join(run, "profile");
  await mkdir(join(vault, "Проекты"), { recursive: true });
  await mkdir(join(vault, "Личное"));
  await mkdir(data);
  const note =
    "# Место для хороших идей\n\nНе нужно записывать всё. Достаточно сохранить то, к чему хочется вернуться.\n\n## На этой неделе\n\n- Дочитать книгу и выписать главное\n- Собрать материалы для нового проекта\n- Оставить время на прогулку без телефона\n\n> Самое полезное в заметках — связи, которые появляются со временем.\n\n## Следующая мысль\n\nНачать с малого. Одна заметка, один вопрос, одна новая связь.\n\n[[Входящие|Открыть входящие]]\n";
  await writeFile(join(vault, "Идеи.md"), note);
  await writeFile(join(vault, "Входящие.md"), "# Входящие\n");
  await writeFile(join(vault, "Чтение.md"), "# Список чтения\n");
  await writeFile(
    join(data, "settings.json"),
    JSON.stringify({ lastVault: vault }),
  );
  let app: RunningApp | undefined;
  try {
    app = await launch(data, profile, false);
    const page = app.page;
    await expect(page.locator(".inspector")).toHaveCount(0);
    await expect(
      page.getByRole("toolbar", { name: "Форматирование" }),
    ).toHaveCount(0);
    await page
      .getByRole("button", { name: "Создать хранилище", exact: true })
      .click();
    await expect(
      page
        .getByRole("dialog")
        .getByRole("heading", { name: "Новое хранилище" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Отмена", exact: true }).click();
    await page.screenshot({
      path: test.info().outputPath("quiet-welcome.png"),
    });
    await page.getByRole("button", { name: "Идеи", exact: true }).click();
    await setMode(page, "Live Preview");
    const editor = page.getByRole("textbox", { name: "Markdown-редактор" });
    await editor.press("Control+End");
    await expect(page.locator(".cm-lineNumbers")).toHaveCount(0);
    await page.screenshot({
      path: test.info().outputPath("quiet-workspace.png"),
    });
    await page
      .getByRole("button", { name: "Действия с заметкой", exact: true })
      .click();
    await expect(
      page.getByRole("group", { name: "Действия с заметкой" }),
    ).toContainText("Переименовать");
    await page.keyboard.press("Escape");
    await noteAction(page, "Панель форматирования");
    await expect(
      page.getByRole("toolbar", { name: "Форматирование" }),
    ).toBeVisible();
    await noteAction(page, "Панель форматирования");
    await noteAction(page, "Номера строк");
    await expect(page.locator(".cm-lineNumbers")).toBeVisible();
    await noteAction(page, "Номера строк");
    await page
      .getByRole("button", { name: "Переключить правую панель" })
      .click();
    await expect(page.locator(".inspector")).toBeVisible();
    await expect(
      page.locator(
        ".inspector .properties,.inspector .note-actions,.inspector-document",
      ),
    ).toHaveCount(0);
    await page
      .getByRole("button", { name: "Переключить правую панель" })
      .click();
    await setMode(page, "Чтение");
    await expect(
      page
        .getByRole("region", { name: "Просмотр заметки" })
        .getByRole("heading", { name: "Место для хороших идей" }),
    ).toBeVisible();
    await page.screenshot({
      path: test.info().outputPath("quiet-reading.png"),
    });
    await page.setViewportSize({ width: 900, height: 650 });
    await page.screenshot({ path: test.info().outputPath("quiet-narrow.png") });
    await page
      .getByRole("button", { name: "Переключить левую панель" })
      .click();
    await expect(page.locator(".sidebar")).toHaveCount(0);
    await page
      .getByRole("button", { name: "Переключить левую панель" })
      .click();
    expect(await readFile(join(vault, "Идеи.md"), "utf8")).toBe(note);
    await closeNative(app, page.getByRole("button", { name: "Закрыть окно" }));
    app = await launch(data, profile, false);
    await expect(app.page.locator(".inspector")).toHaveCount(0);
    await expect(
      app.page.getByRole("toolbar", { name: "Форматирование" }),
    ).toHaveCount(0);
  } finally {
    await stop(app);
  }
});

test("vault menu and workspace refinements: switching, drafts, registry guard and editor-only footer", async () => {
  test.skip(process.platform !== "win32", "Native WebView2 runs on Windows");
  const run = await mkdtemp(resolve(root, ".build-cache/native-vault-menu-"));
  const vault = join(run, "Native-MVP"),
    other = join(run, "Работа"),
    data = join(run, "data"),
    profile = join(run, "profile");
  await mkdir(join(vault, "Пустая"), { recursive: true });
  await mkdir(other);
  await mkdir(data);
  const original = "# Личные заметки\n\nПервая запись.\n";
  await writeFile(join(vault, "Начало.md"), original);
  await writeFile(
    join(other, "Проект.md"),
    "# Рабочий проект\n\nДругая папка.\n",
  );
  await writeFile(
    join(data, "settings.json"),
    JSON.stringify({ lastVault: vault, recentVaults: [vault, other] }),
  );
  let app: RunningApp | undefined;
  try {
    app = await launch(data, profile, false);
    const page = app.page;
    await expect(
      page.getByRole("group", { name: "Боковые панели" }).getByRole("button"),
    ).toHaveCount(2);
    await expect(
      page.getByRole("img", { name: "Логотип Aether" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Начало", exact: true }).click();
    await page.getByRole("button", { name: "Пустая", exact: true }).click();
    await expect(page.getByText("Папка пуста", { exact: true })).toBeVisible();
    await expect(page.locator(".selected-folder")).toHaveCount(0);
    await page
      .getByRole("button", { name: "Переключить правую панель" })
      .click();
    const [status, main, left, right] = await Promise.all([
      page.locator(".status-bar").boundingBox(),
      page.locator(".main-pane").boundingBox(),
      page.locator(".sidebar").boundingBox(),
      page.locator(".inspector").boundingBox(),
    ]);
    if (!status || !main || !left || !right)
      throw new Error("Missing workspace geometry");
    const height = await page.evaluate(() => innerHeight);
    expect(status.x).toBeCloseTo(main.x, 0);
    expect(status.width).toBeCloseTo(main.width, 0);
    expect(left.y + left.height).toBeCloseTo(height, 0);
    expect(right.y + right.height).toBeCloseTo(height, 0);
    await page.getByRole("button", { name: "Хранилище: Native-MVP" }).click();
    await expect(
      page.getByRole("button", { name: "Переключиться на Native-MVP" }),
    ).toHaveCount(1);
    await expect(
      page.getByRole("button", { name: "Переключиться на Работа" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Открыть хранилище…" }),
    ).toBeVisible();
    await page.screenshot({ path: test.info().outputPath("vault-menu.png") });
    await page.getByRole("button", { name: "Создать хранилище…" }).click();
    await expect(page.locator("dialog[open]")).toContainText("Новое хранилище");
    await page
      .locator("dialog[open]")
      .getByRole("button", { name: "Отмена", exact: true })
      .click();
    const code = await page.evaluate(async () => {
      const native = window as unknown as Window & {
        __TAURI_INTERNALS__: {
          invoke: (
            command: string,
            args: Record<string, unknown>,
          ) => Promise<unknown>;
        };
      };
      try {
        await native.__TAURI_INTERNALS__.invoke("switch_vault", {
          vaultId: "C:/not-a-registered-vault",
        });
        return "allowed";
      } catch (error) {
        return typeof error === "object" && error !== null && "code" in error
          ? String(error.code)
          : String(error);
      }
    });
    expect(code).toBe("InvalidPath");
    const editor = () =>
      page.getByRole("textbox", { name: "Markdown-редактор" });
    await editor().press("Control+End");
    await editor().pressSequentially("Ценный черновик.");
    const switchTo = async (name: string) => {
      await page.locator(".vault-switcher").click();
      await page
        .getByRole("button", { name: `Переключиться на ${name}`, exact: true })
        .click();
    };
    await switchTo("Работа");
    await page
      .locator("dialog[open]")
      .getByRole("button", { name: "Отмена", exact: true })
      .click();
    await expect(editor()).toContainText("Ценный черновик.");
    await switchTo("Работа");
    await page
      .locator("dialog[open]")
      .getByRole("button", { name: "Продолжить", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Хранилище: Работа" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Проект", exact: true }).click();
    await expect(editor()).toContainText("Рабочий проект");
    await switchTo("Native-MVP");
    await expect(editor()).toContainText("Ценный черновик.");
    expect(await readFile(join(vault, "Начало.md"), "utf8")).toBe(original);
    await page.getByRole("button", { name: "Сохранить", exact: true }).click();
    await expect
      .poll(() => readFile(join(vault, "Начало.md"), "utf8"))
      .toBe(original + "Ценный черновик.");
    await expect(
      page.getByRole("button", { name: "Сохранить", exact: true }),
    ).toHaveCount(0);
    await closeNative(app, page.getByRole("button", { name: "Закрыть окно" }));
    app = await launch(data, profile, false);
    await app.page.locator(".vault-switcher").click();
    await expect(
      app.page.getByRole("button", { name: "Переключиться на Работа" }),
    ).toBeVisible();
  } catch (error) {
    if (app && !app.page.isClosed()) {
      const state = {
        banners: await app.page.locator(".banner").allTextContents(),
        notice: await app.page.locator(".status-bar").innerText(),
        text: await app.page
          .getByRole("textbox", { name: "Markdown-редактор" })
          .innerText(),
      };
      await test.info().attach("vault-switch-runtime", {
        body: JSON.stringify(state),
        contentType: "application/json",
      });
      await app.page.screenshot({
        path: test.info().outputPath("vault-switch-failure.png"),
      });
    }
    throw error;
  } finally {
    await stop(app);
  }
});

test("resizable sidebars, rounded tabs and theme-aware caret", async () => {
  test.skip(process.platform !== "win32", "Native WebView2 runs on Windows");
  const run = await mkdtemp(resolve(root, ".build-cache/native-resize-"));
  const vault = join(run, "Native-MVP"),
    data = join(run, "data"),
    profile = join(run, "profile");
  await mkdir(vault);
  await mkdir(data);
  const text =
    "# Спокойное рабочее место\n\nПанели подстраиваются под ваши заметки.\n";
  await writeFile(join(vault, "Начало.md"), text);
  await writeFile(join(vault, "Идеи.md"), "# Идеи\n");
  await writeFile(
    join(data, "settings.json"),
    JSON.stringify({ lastVault: vault }),
  );
  let app: RunningApp | undefined;
  try {
    app = await launch(data, profile);
    const page = app.page;
    await expect(
      page.getByRole("button", { name: "Показать поиск", exact: true }),
    ).toHaveCount(0);
    await expect(
      page
        .locator(".activity-rail")
        .getByRole("button", { name: "Показать проводник" }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".sidebar-view-title")).toHaveText("Файлы");
    await page
      .getByRole("button", { name: "Поиск по хранилищу", exact: true })
      .click();
    await expect(page.locator(".search-panel")).toBeVisible();
    await expect(page.locator(".sidebar-view-title")).toHaveText("Поиск");
    await page.getByRole("button", { name: "Показать проводник" }).click();
    await expect(page.locator(".sidebar-view-title")).toHaveText("Файлы");
    await page.getByRole("button", { name: "Идеи", exact: true }).click();
    await page.getByRole("button", { name: "Начало", exact: true }).click();
    const drag = async (side: string, delta: number) => {
      const handle = page.getByRole("separator", {
        name: `Ширина ${side} панели`,
      });
      const box = (await handle.boundingBox())!;
      await page.mouse.move(box.x + box.width / 2, box.y + 160);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2 + delta, box.y + 160, {
        steps: 8,
      });
      await page.mouse.up();
    };
    const width = async (selector: string) =>
      (await page.locator(selector).boundingBox())!.width;
    await drag("левой", 65);
    expect(await width(".sidebar")).toBeCloseTo(305, 0);
    await drag("правой", -50);
    expect(await width(".right-pane")).toBeCloseTo(310, 0);
    await drag("левой", -200);
    await expect(page.locator(".sidebar")).toHaveCount(0);
    await page.getByRole("button", { name: "Показать проводник" }).click();
    expect(await width(".sidebar")).toBeCloseTo(305, 0);
    await drag("правой", 180);
    await expect(page.locator(".right-pane")).toHaveCount(0);
    await page
      .getByRole("button", { name: "Переключить правую панель" })
      .click();
    expect(await width(".right-pane")).toBeCloseTo(310, 0);
    const leftHandle = page.getByRole("separator", {
      name: "Ширина левой панели",
    });
    await leftHandle.focus();
    await leftHandle.press("ArrowRight");
    expect(await width(".sidebar")).toBeCloseTo(315, 0);
    await leftHandle.press("ArrowLeft");
    const editor = page.getByRole("textbox", { name: "Markdown-редактор" });
    const colors: string[] = [];
    for (const theme of ["light", "dark"]) {
      if ((await page.locator("html").getAttribute("data-theme")) !== theme)
        await page
          .getByRole("button", { name: "Переключить тему", exact: true })
          .click();
      await editor.click();
      await editor.press("Control+End");
      await expect(page.locator(".cm-cursor").first()).toBeAttached();
      const color = await page
        .locator(".cm-cursor")
        .first()
        .evaluate((node) => getComputedStyle(node).borderLeftColor);
      expect(color).toBe(
        await editor.evaluate((node) => getComputedStyle(node).color),
      );
      colors.push(color);
      await page.screenshot({
        path: test.info().outputPath(`resizable-${theme}.png`),
      });
    }
    expect(colors[0]).not.toBe(colors[1]);
    const viewport = await page.evaluate(() => ({
      width: innerWidth,
      height: innerHeight,
    }));
    await page.setViewportSize({ width: 800, height: 650 });
    expect(await width(".main-pane")).toBeGreaterThanOrEqual(319);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(800);
    await page.setViewportSize(viewport);
    expect(
      await page
        .locator(".tab.active")
        .evaluate((node) => getComputedStyle(node).borderBottomLeftRadius),
    ).toBe("9px");
    expect(await readFile(join(vault, "Начало.md"), "utf8")).toBe(text);
    await closeNative(app, page.getByRole("button", { name: "Закрыть окно" }));
    app = await launch(data, profile);
    expect(
      (await app.page.locator(".sidebar").boundingBox())!.width,
    ).toBeCloseTo(305, 0);
    expect(
      (await app.page.locator(".right-pane").boundingBox())!.width,
    ).toBeCloseTo(310, 0);
  } finally {
    await stop(app);
  }
});

test("editor tabs, horizontally scrolling tree and unclipped contextual menus", async () => {
  test.skip(process.platform !== "win32", "Native WebView2 runs on Windows");
  const run = await mkdtemp(resolve(root, ".build-cache/native-editor-tabs-"));
  const vault = join(run, "Native-MVP"),
    data = join(run, "data"),
    profile = join(run, "profile");
  const folder =
    "Очень длинное название папки с материалами для нового проекта";
  await mkdir(join(vault, folder), { recursive: true });
  await mkdir(data);
  await writeFile(
    join(
      vault,
      folder,
      "Заметка с длинным названием для проверки прокрутки.md",
    ),
    "# Заметка\n",
  );
  await writeFile(join(vault, "Начало.md"), "# Начало\n");
  await writeFile(
    join(data, "settings.json"),
    JSON.stringify({ lastVault: vault }),
  );
  let app: RunningApp | undefined;
  try {
    app = await launch(data, profile, false);
    const page = app.page;
    await page.getByRole("button", { name: "Начало", exact: true }).click();
    await expect(page.locator(".titlebar .workspace-tabs")).toHaveCount(0);
    await expect(page.locator(".main-pane .workspace-tabs")).toBeVisible();
    const main = (await page.locator(".main-pane").boundingBox())!;
    const tabs = (await page.locator(".workspace-tabs").boundingBox())!;
    expect(tabs.x).toBeCloseTo(main.x, 0);
    expect(tabs.width).toBeCloseTo(main.width, 0);
    const handle = page.getByRole("separator", { name: "Ширина левой панели" });
    await handle.focus();
    for (let step = 0; step < 6; step++) await handle.press("ArrowLeft");
    expect((await page.locator(".sidebar").boundingBox())!.width).toBeCloseTo(
      180,
      0,
    );
    await page.getByRole("button", { name: folder, exact: true }).click();
    const scroll = page.locator(".explorer-scroll");
    expect(
      await scroll.evaluate((node) => node.scrollWidth > node.clientWidth),
    ).toBe(true);
    await scroll.evaluate((node) => {
      node.scrollLeft = node.scrollWidth;
    });
    expect(await scroll.evaluate((node) => node.scrollLeft)).toBeGreaterThan(
      100,
    );
    await page
      .getByRole("button", { name: "Действия с файлами", exact: true })
      .click();
    const menu = page.getByRole("group", {
      name: "Действия с файлами",
      exact: true,
    });
    const menuBox = (await menu.boundingBox())!;
    const sidebar = (await page.locator(".sidebar").boundingBox())!;
    expect(menuBox.x + menuBox.width).toBeGreaterThan(
      sidebar.x + sidebar.width,
    );
    expect(
      await menu.evaluate((node) => {
        const r = node.getBoundingClientRect();
        return node.contains(
          document.elementFromPoint(r.right - 12, r.top + 16),
        );
      }),
    ).toBe(true);
    await menu.getByRole("button", { name: "Обновить дерево" }).click();
    await expect(menu).toHaveCount(0);
    await page.locator(".vault-switcher").click();
    const vaultMenu = page.getByRole("group", {
      name: "Хранилище: Native-MVP",
    });
    expect((await vaultMenu.boundingBox())!.width).toBeGreaterThan(180);
    await expect(
      vaultMenu.getByRole("button", { name: "Создать хранилище…" }),
    ).toBeVisible();
    await page.screenshot({
      path: test.info().outputPath("editor-tabs-vault-menu.png"),
    });
    const viewport = await page.evaluate(() => ({
      width: innerWidth,
      height: innerHeight,
    }));
    await page.setViewportSize({ width: 800, height: 650 });
    await expect
      .poll(() =>
        vaultMenu.evaluate((node) => {
          const r = node.getBoundingClientRect();
          return (
            r.left >= 8 &&
            r.right <= innerWidth - 8 &&
            r.top >= 8 &&
            r.bottom <= innerHeight - 8
          );
        }),
      )
      .toBe(true);
    await page.setViewportSize(viewport);
    await page.keyboard.press("Escape");
    await page
      .getByRole("button", { name: "Поиск по хранилищу", exact: true })
      .click();
    await expect(
      page
        .locator(".sidebar-toolbar")
        .getByRole("button", { name: "Новая заметка" }),
    ).toHaveCount(0);
    await expect(
      page
        .locator(".sidebar-toolbar")
        .getByRole("button", { name: "Новая папка" }),
    ).toHaveCount(0);
    const input = page.getByRole("textbox", { name: "Поиск по содержимому" });
    await input.fill("запрос");
    await page.locator(".search-filters summary").click();
    await page.getByRole("textbox", { name: "Фильтр пути" }).fill("Проект");
    const action = async (name: string) => {
      await page
        .getByRole("button", { name: "Действия поиска", exact: true })
        .click();
      await expect(
        page.getByRole("group", { name: "Действия поиска" }),
      ).not.toContainText("Открыть хранилище");
      await page.getByRole("button", { name, exact: true }).click();
    };
    await action("Сбросить фильтры");
    await expect(input).toHaveValue("запрос");
    await expect(
      page.getByRole("textbox", { name: "Фильтр пути" }),
    ).toHaveValue("");
    await action("Очистить запрос");
    await expect(input).toHaveValue("");
    await action("Обновить результаты");
    await page
      .getByRole("button", { name: "Действия поиска", exact: true })
      .click();
    await page.screenshot({
      path: test.info().outputPath("search-actions.png"),
    });
  } finally {
    await stop(app);
  }
});

test("tab strip scrolls with the wheel and reveals the active note", async () => {
  test.skip(process.platform !== "win32", "Native WebView2 runs on Windows");
  const run = await mkdtemp(resolve(root, ".build-cache/native-tab-scroll-"));
  const vault = join(run, "Native-MVP"),
    data = join(run, "data"),
    profile = join(run, "profile");
  await mkdir(vault);
  await mkdir(data);
  const names = Array.from(
    { length: 12 },
    (_, i) => `Заметка ${String(i + 1).padStart(2, "0")}`,
  );
  for (const name of names)
    await writeFile(join(vault, `${name}.md`), `# ${name}\n`);
  await writeFile(
    join(data, "settings.json"),
    JSON.stringify({ lastVault: vault }),
  );
  let app: RunningApp | undefined;
  try {
    app = await launch(data, profile, false);
    const page = app.page;
    for (const name of names)
      await page.getByRole("button", { name, exact: true }).click();
    const strip = page.getByRole("tablist", { name: "Открытые заметки" });
    expect(
      await strip.evaluate((node) => node.scrollWidth > node.clientWidth),
    ).toBe(true);
    const visibleActive = () =>
      strip.evaluate((node) => {
        const active = node
          .querySelector('[aria-selected="true"]')!
          .closest(".tab")!
          .getBoundingClientRect();
        const box = node.getBoundingClientRect();
        return active.left >= box.left - 1 && active.right <= box.right + 1;
      });
    await expect.poll(visibleActive).toBe(true);
    await strip.hover();
    await page.mouse.wheel(0, -9000);
    await expect.poll(() => strip.evaluate((node) => node.scrollLeft)).toBe(0);
    await page.mouse.wheel(0, 300);
    await expect
      .poll(() => strip.evaluate((node) => node.scrollLeft))
      .toBeGreaterThan(100);
    await page.mouse.wheel(-9000, 0);
    await expect.poll(() => strip.evaluate((node) => node.scrollLeft)).toBe(0);
    await page.mouse.wheel(9000, 0);
    await expect.poll(visibleActive).toBe(true);
    await page.getByRole("button", { name: names[0], exact: true }).click();
    await expect
      .poll(() => strip.evaluate((node) => node.scrollLeft))
      .toBeLessThan(5);
    await expect.poll(visibleActive).toBe(true);
    await page
      .getByRole("button", { name: names.at(-1)!, exact: true })
      .click();
    await expect.poll(visibleActive).toBe(true);
    await page.setViewportSize({ width: 800, height: 650 });
    await expect.poll(visibleActive).toBe(true);
    await expect(
      page.getByRole("button", { name: "Открыть новую заметку", exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: test.info().outputPath("scrolling-tabs.png"),
    });
    expect(await readFile(join(vault, `${names.at(-1)}.md`), "utf8")).toBe(
      `# ${names.at(-1)}\n`,
    );
  } finally {
    await stop(app);
  }
});

test("styled context menus: editor clipboard, inactive files, folders and tabs", async () => {
  test.skip(process.platform !== "win32", "Native WebView2 runs on Windows");
  const run = await mkdtemp(resolve(root, ".build-cache/native-context-menu-"));
  const vault = join(run, "Native-MVP"),
    data = join(run, "data"),
    profile = join(run, "profile");
  await mkdir(join(vault, "Проект"), { recursive: true });
  await mkdir(data);
  const original = "# Начало\n\nТекст для контекстного меню.\n";
  await writeFile(join(vault, "Начало.md"), original);
  await writeFile(join(vault, "Другая.md"), "# Другая\n");
  await writeFile(
    join(data, "settings.json"),
    JSON.stringify({ lastVault: vault }),
  );
  let app: RunningApp | undefined;
  try {
    app = await launch(data, profile, false);
    const page = app.page;
    // Isolate clipboard tests from the user's system clipboard.
    await page.evaluate(() => {
      let text = "";
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async (value: string) => {
            text = value;
          },
          readText: async () => text,
        },
      });
    });
    await page.getByRole("button", { name: "Начало", exact: true }).click();
    const editor = page.getByRole("textbox", { name: "Markdown-редактор" });
    await editor.press("Control+End");
    await editor.pressSequentially("Дополнение");
    const expected = original + "Дополнение";
    await page
      .getByRole("button", { name: "Другая", exact: true })
      .click({ button: "right" });
    await expect(
      page.getByRole("menu", { name: "Действия с файлом" }),
    ).toBeVisible();
    await page
      .getByRole("menuitem", { name: "Переименовать", exact: true })
      .click();
    await expect(page.getByRole("textbox", { name: "Имя файла" })).toHaveValue(
      "Другая",
    );
    await page.getByRole("textbox", { name: "Имя файла" }).press("Escape");
    await expect(editor).toContainText("Дополнение");
    await page
      .getByRole("button", { name: "Другая", exact: true })
      .click({ button: "right" });
    await page
      .getByRole("menuitem", { name: "Переместить в корзину", exact: true })
      .click();
    await expect(page.locator("dialog[open]")).toContainText("Другая.md");
    await page
      .locator("dialog[open]")
      .getByRole("button", { name: "Отмена", exact: true })
      .click();
    expect(await readFile(join(vault, "Другая.md"), "utf8")).toBe("# Другая\n");
    await page
      .getByRole("button", { name: "Проект", exact: true })
      .click({ button: "right" });
    await page
      .getByRole("menuitem", { name: "Новая заметка", exact: true })
      .click();
    await expect(page.locator("dialog[open] input")).toHaveValue(
      "Проект/Без названия.md",
    );
    await page
      .locator("dialog[open]")
      .getByRole("button", { name: "Отмена", exact: true })
      .click();
    await editor.press("Control+a");
    await editor.click({ button: "right" });
    await expect(
      page.getByRole("menu", { name: "Действия редактора" }),
    ).toBeVisible();
    await page
      .getByRole("menuitem", { name: "Копировать", exact: false })
      .click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      expected,
    );
    await editor.click({ button: "right" });
    await page
      .getByRole("menuitem", { name: "Вырезать", exact: false })
      .click();
    await expect(editor).toHaveText("");
    await editor.click({ button: "right" });
    await page
      .getByRole("menuitem", { name: "Вставить", exact: false })
      .click();
    await expect(editor).toContainText("Дополнение");
    await editor.click({ button: "right" });
    await page
      .getByRole("menuitem", { name: "Отменить", exact: false })
      .click();
    await expect(editor).toHaveText("");
    await editor.click({ button: "right" });
    await page
      .getByRole("menuitem", { name: "Повторить", exact: false })
      .click();
    await expect(editor).toContainText("Дополнение");
    await page
      .getByRole("button", { name: "Действия с заметкой", exact: true })
      .click();
    const skin = await page
      .getByRole("group", { name: "Действия с заметкой" })
      .evaluate((node) => getComputedStyle(node).backgroundColor);
    await editor.click({ button: "right", position: { x: 100, y: 120 } });
    await expect(
      page.getByRole("group", { name: "Действия с заметкой" }),
    ).toHaveCount(0);
    const menu = page.getByRole("menu", { name: "Действия редактора" });
    expect(
      await menu.evaluate((node) => getComputedStyle(node).backgroundColor),
    ).toBe(skin);
    expect(
      await menu.evaluate((node) => {
        const r = node.getBoundingClientRect();
        return r.right <= innerWidth - 8 && r.bottom <= innerHeight - 8;
      }),
    ).toBe(true);
    await page.screenshot({
      path: test.info().outputPath("editor-context-menu.png"),
    });
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await editor.click({ button: "right" });
    await page
      .getByRole("menuitem", { name: "Сохранить заметку", exact: false })
      .click();
    await expect
      .poll(() => readFile(join(vault, "Начало.md"), "utf8"))
      .toBe(expected);
    await page.getByRole("button", { name: "Другая", exact: true }).click();
    await page
      .getByRole("tab", { name: "Начало", exact: true })
      .click({ button: "right" });
    await page
      .getByRole("menuitem", { name: "Закрыть вкладку", exact: false })
      .click();
    await expect(
      page.getByRole("tab", { name: "Начало", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("tab", { name: "Другая", exact: true }),
    ).toHaveAttribute("aria-selected", "true");
  } finally {
    await stop(app);
  }
});

test("inline title rename, clean tabs and caret-scoped Live Preview", async () => {
  test.skip(process.platform !== "win32", "Native WebView2 runs on Windows");
  const run = await mkdtemp(resolve(root, ".build-cache/native-inline-title-"));
  const vault = join(run, "Native-MVP"),
    data = join(run, "data"),
    profile = join(run, "profile");
  await mkdir(vault);
  await mkdir(data);
  const text =
    "Обычный **жирный** и *курсив* и [[Другая|ссылка]] и [сайт](https://example.com) и ~~пункт~~.\n\nКонец\n";
  await writeFile(join(vault, "Начало.md"), text);
  await writeFile(join(vault, "Другая.md"), "# Другая\n");
  await writeFile(join(vault, "Связь.md"), "[[Начало]]\n");
  await writeFile(
    join(data, "settings.json"),
    JSON.stringify({ lastVault: vault }),
  );
  let app: RunningApp | undefined;
  try {
    app = await launch(data, profile);
    const page = app.page;
    await expect(page.locator(".new-tab")).toHaveCount(0);
    await page.getByRole("button", { name: "Начало", exact: true }).click();
    await expect(page.locator(".new-tab")).toBeVisible();
    const title = page.getByRole("textbox", { name: "Название заметки" });
    await expect(title).toHaveValue("Начало");
    expect(
      await title.evaluate((node) =>
        parseFloat(getComputedStyle(node).fontSize),
      ),
    ).toBeGreaterThanOrEqual(28);
    await setMode(page, "Live Preview");
    const editor = page.getByRole("textbox", { name: "Markdown-редактор" });
    const move = async (position: number) => {
      await editor.press("Control+Home");
      for (let index = 0; index < position; index++)
        await editor.press("ArrowRight");
    };
    await move(0);
    await expect(editor).not.toContainText("**");
    await expect(editor).not.toContainText("[[");
    await expect(editor).not.toContainText("https://");
    await move(text.indexOf("жирный") + 2);
    await expect(editor).toContainText("**жирный**");
    await expect(editor).not.toContainText("*курсив*");
    await move(text.indexOf("курсив") + 2);
    await expect(editor).toContainText("*курсив*");
    await expect(editor).not.toContainText("**жирный**");
    await move(text.indexOf("Другая") + 2);
    await expect(page.locator(".live-wiki-link")).toHaveText(
      "[[Другая|ссылка]]",
    );
    await move(text.indexOf("сайт") + 1);
    await expect(editor).toContainText("[сайт](https://example.com)");
    await expect(editor).not.toContainText("[[");
    await move(text.indexOf("пункт") + 1);
    await expect(editor).toContainText("~~пункт~~");
    expect(await readFile(join(vault, "Начало.md"), "utf8")).toBe(text);
    await editor.press("Control+End");
    await editor.pressSequentially("!");
    const dot = page.locator(".tab.active .dirty-dot");
    await expect(dot).toBeVisible();
    const nameBox = (await page
      .locator(".tab.active .tab-name")
      .boundingBox())!;
    const dotBox = (await dot.boundingBox())!;
    expect(dotBox.x).toBeGreaterThanOrEqual(nameBox.x + nameBox.width);
    await move(text.indexOf("Другая") + 1);
    await page.screenshot({
      path: test.info().outputPath("live-caret-fragments.png"),
    });
    await editor.press("Control+s");
    await expect
      .poll(() => readFile(join(vault, "Начало.md"), "utf8"))
      .toBe(text + "!");
    await title.fill("Новая заметка");
    await title.press("Enter");
    await expect(page.locator("dialog[open]")).toHaveCount(0);
    await expect(
      page.getByRole("tab", { name: "Новая заметка", exact: true }),
    ).toBeVisible();
    await expect(title).toHaveValue("Новая заметка");
    expect(await readFile(join(vault, "Новая заметка.md"), "utf8")).toBe(
      text + "!",
    );
    expect(await readFile(join(vault, "Связь.md"), "utf8")).toBe(
      "[[Новая заметка]]\n",
    );
    const section = page.locator(".relations-section").first();
    await expect(section).toBeVisible();
    await section.locator("summary").click();
    await expect(section).not.toHaveAttribute("open", "");
    const outgoing = page.locator(".relations-section").nth(1);
    await outgoing.locator("summary").click();
    await expect(outgoing).not.toHaveAttribute("open", "");
    const incomingBounds = (await section.boundingBox())!;
    const outgoingBounds = (await outgoing.boundingBox())!;
    expect(incomingBounds.height).toBe(outgoingBounds.height);
    expect(outgoingBounds.y - incomingBounds.y).toBe(incomingBounds.height);
    await page.screenshot({
      path: test.info().outputPath("collapsed-inspector.png"),
    });
    await outgoing.locator("summary").click();
    await section.locator("summary").click();
    await page.screenshot({
      path: test.info().outputPath("inline-title-and-inspector.png"),
    });
    await page
      .getByRole("button", { name: "Закрыть Новая заметка", exact: true })
      .click();
    await expect(page.locator(".new-tab")).toHaveCount(0);
  } finally {
    await stop(app);
  }
});

test("instant new note and inline rename without dialog or input chrome", async () => {
  test.skip(process.platform !== "win32", "Native WebView2 runs on Windows");
  const run = await mkdtemp(resolve(root, ".build-cache/native-instant-note-"));
  const vault = join(run, "Native-MVP"),
    data = join(run, "data"),
    profile = join(run, "profile");
  await mkdir(vault);
  await mkdir(data);
  await writeFile(join(vault, "Новая заметка.md"), "existing content\n");
  await writeFile(join(vault, "Связь.md"), "[[Новая заметка 1]]\n");
  await writeFile(
    join(data, "settings.json"),
    JSON.stringify({ lastVault: vault }),
  );
  let app: RunningApp | undefined;
  try {
    app = await launch(data, profile, false);
    const page = app.page;
    await page
      .locator(".file-tree")
      .getByRole("button", { name: "Новая заметка", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Открыть новую заметку", exact: true })
      .click();
    await expect(page.locator("dialog[open]")).toHaveCount(0);
    const title = page.getByRole("textbox", { name: "Название заметки" });
    await expect(title).toHaveValue("Новая заметка 1");
    await expect(title).toBeFocused();
    expect(await readFile(join(vault, "Новая заметка.md"), "utf8")).toBe(
      "existing content\n",
    );
    expect(await readFile(join(vault, "Новая заметка 1.md"), "utf8")).toBe("");
    const skin = await title.evaluate((node) => {
      const style = getComputedStyle(node);
      return {
        background: style.backgroundColor,
        shadow: style.boxShadow,
        border: style.borderTopWidth,
      };
    });
    expect(skin.background).toBe("rgba(0, 0, 0, 0)");
    expect(skin.shadow).toBe("none");
    expect(skin.border).toBe("0px");
    await page.getByRole("button", { name: "Связь", exact: true }).click();
    const editor = page.getByRole("textbox", { name: "Markdown-редактор" });
    await editor.press("Control+End");
    await editor.pressSequentially("[[Новая заметка 1]]");
    await page
      .getByRole("tab", { name: "Новая заметка 1", exact: true })
      .click();
    await editor.pressSequentially("Текст черновика");
    await title.fill("Идея");
    await title.press("Enter");
    await expect(
      page.getByRole("tab", { name: "Идея", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Идея", exact: true }),
    ).toBeVisible();
    await expect(page.locator("dialog[open]")).toHaveCount(0);
    expect(await readFile(join(vault, "Идея.md"), "utf8")).toBe(
      "Текст черновика",
    );
    const renamedLinks = await readFile(join(vault, "Связь.md"), "utf8");
    expect(renamedLinks.match(/\[\[Идея\]\]/g)).toHaveLength(2);
    expect(renamedLinks.replaceAll("[[Идея]]", "")).toBe("\n");
    await page.getByRole("tab", { name: "Связь", exact: true }).click();
    await expect(editor).toContainText("[[Идея]]");
    await expect(editor).not.toContainText("Новая заметка 1");
    await page.getByRole("tab", { name: "Идея", exact: true }).click();
    await title.fill("Мысль");
    await editor.click();
    await expect(
      page.getByRole("tab", { name: "Мысль", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Мысль", exact: true }),
    ).toBeVisible();
    await expect(page.locator("dialog[open]")).toHaveCount(0);
    await page.screenshot({
      path: test.info().outputPath("instant-rename.png"),
    });
  } finally {
    await stop(app);
  }
});

test("wiki completion styling, uniform brackets and automatic closing", async () => {
  test.skip(process.platform !== "win32", "Native WebView2 runs on Windows");
  const run = await mkdtemp(resolve(root, ".build-cache/native-wiki-input-"));
  const vault = join(run, "Native-MVP"),
    data = join(run, "data"),
    profile = join(run, "profile");
  await mkdir(join(vault, "Проект"), { recursive: true });
  await mkdir(data);
  await writeFile(join(vault, "Редактор.md"), "[[Цель]]\n\nКонец");
  await writeFile(join(vault, "Цель.md"), "# Лишний заголовок\n");
  await writeFile(
    join(vault, "Проект", "Цель 2.md"),
    "# Дублирующий заголовок\n",
  );
  await writeFile(
    join(data, "settings.json"),
    JSON.stringify({ lastVault: vault }),
  );
  let app: RunningApp | undefined;
  try {
    app = await launch(data, profile, false);
    const page = app.page;
    await page.getByRole("button", { name: "Редактор", exact: true }).click();
    const editor = page.getByRole("textbox", { name: "Markdown-редактор" });
    const uniform = async () => {
      const colors = await editor
        .locator(".cm-line")
        .first()
        .evaluate((line) => {
          const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
          const found: string[] = [];
          while (walker.nextNode()) {
            const text = walker.currentNode;
            for (const char of text.textContent ?? "")
              if (char === "[" || char === "]")
                found.push(getComputedStyle(text.parentElement!).color);
          }
          return found;
        });
      expect(colors).toHaveLength(4);
      expect(new Set(colors).size).toBe(1);
      expect(colors[0]).toBe(
        await page
          .locator(".wiki-link")
          .first()
          .evaluate((node) => getComputedStyle(node).color),
      );
    };
    await editor.press("Control+Home");
    await editor.press("ArrowRight");
    await uniform();
    await editor.press("ArrowRight");
    await uniform();
    await setMode(page, "Live Preview");
    await editor.press("Control+Home");
    await editor.press("ArrowRight");
    await uniform();
    await editor.press("ArrowRight");
    await uniform();
    await editor.press("Control+End");
    await editor.press("Enter");
    await editor.pressSequentially("[");
    await expect(editor.locator(".cm-line").last()).toHaveText("[]");
    await editor.pressSequentially("[");
    await expect(editor.locator(".cm-line").last()).toHaveText("[[]]");
    await editor.pressSequentially("Це");
    const popup = page.locator(".cm-tooltip-autocomplete");
    await expect(popup).toBeVisible();
    await expect(popup).not.toContainText("Лишний заголовок");
    await expect(popup).not.toContainText("Дублирующий заголовок");
    await expect(
      popup.locator(".cm-completionDetail").filter({ hasText: "Проект" }),
    ).toHaveCount(1);
    expect(
      await popup.evaluate((node) => getComputedStyle(node).borderRadius),
    ).toBe("8px");
    expect(
      await popup
        .locator("ul")
        .evaluate((node) => getComputedStyle(node).paddingTop),
    ).toBe("5px");
    await page.screenshot({
      path: test.info().outputPath("wiki-completion-dark.png"),
    });
    await page
      .getByRole("button", { name: "Переключить тему", exact: true })
      .click();
    await setMode(page, "Исходник");
    await editor.press("Control+Space");
    await expect(popup).toBeVisible();
    await page.screenshot({
      path: test.info().outputPath("wiki-completion-light.png"),
    });
    await page.getByRole("option", { name: "Цель", exact: true }).click();
    await expect(editor.locator(".cm-line").last()).toHaveText("[[Цель]]");
    await editor.press("End");
    await editor.press("Enter");
    await editor.pressSequentially("[[");
    await expect(editor.locator(".cm-line").last()).toHaveText("[[]]");
    await editor.press("Backspace");
    await expect(editor.locator(".cm-line").last()).toHaveText("[]");
    await editor.press("Backspace");
    await expect(editor.locator(".cm-line").last()).toHaveText("");
    expect(await readFile(join(vault, "Редактор.md"), "utf8")).toBe(
      "[[Цель]]\n\nКонец",
    );
  } finally {
    await stop(app);
  }
});

test("move notes by dragging, update links, reveal menus and root-only plus", async () => {
  test.skip(process.platform !== "win32", "Native WebView2 runs on Windows");
  const run = await mkdtemp(resolve(root, ".build-cache/native-file-move-"));
  const vault = join(run, "Native-MVP"),
    data = join(run, "data"),
    profile = join(run, "profile");
  await mkdir(join(vault, "A"), { recursive: true });
  await mkdir(join(vault, "B", "Nested"), { recursive: true });
  await mkdir(data);
  const note = "# Note\n\n[[./Other#anchor|alias]]\n![image](image.png)\n";
  await writeFile(join(vault, "A", "Note.md"), note);
  await writeFile(join(vault, "A", "Other.md"), "# Other\n\n## anchor\n");
  await writeFile(
    join(vault, "A", "image.png"),
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j4l8AAAAASUVORK5CYII=",
      "base64",
    ),
  );
  const reference =
    "# Ref\n\n[[Note#anchor|short]]\n[[A/Note#anchor|explicit]]\n[markdown](A/Note.md)\n";
  await writeFile(join(vault, "Ref.md"), reference);
  await writeFile(join(vault, "Clash.md"), "root collision\n");
  await writeFile(join(vault, "B", "Clash.md"), "destination collision\n");
  await writeFile(
    join(data, "settings.json"),
    JSON.stringify({ lastVault: vault }),
  );
  let app: RunningApp | undefined;
  try {
    app = await launch(data, profile);
    const page = app.page;
    const file = (path: string) =>
      page.locator(`.tree-item[data-tooltip="${path}"]`);
    const expand = async (path: string) => {
      if ((await file(path).getAttribute("aria-expanded")) !== "true")
        await file(path).click();
    };
    await expand("A");
    await file("A/Note.md").click();
    await file("A/Note.md").dragTo(file("B"));
    await expect(
      page.getByRole("tab", { name: "Note", exact: true }),
    ).toHaveAttribute("data-tooltip", "B/Note.md");
    expect(await readFile(join(vault, "B", "Note.md"), "utf8")).toContain(
      "![image](../A/image.png)",
    );
    expect(await readFile(join(vault, "B", "Note.md"), "utf8")).toContain(
      "[[A/Other#anchor|alias]]",
    );
    let ref = await readFile(join(vault, "Ref.md"), "utf8");
    expect(ref).toContain("[[Note#anchor|short]]");
    expect(ref).toContain("[[B/Note#anchor|explicit]]");
    expect(ref).toContain("[markdown](B/Note.md)");
    await expand("B");
    await file("B/Note.md").dragTo(file("B/Nested"));
    await expect(
      page.getByRole("tab", { name: "Note", exact: true }),
    ).toHaveAttribute("data-tooltip", "B/Nested/Note.md");
    expect(
      await readFile(join(vault, "B", "Nested", "Note.md"), "utf8"),
    ).toContain("../../A/image.png");
    await expand("B/Nested");
    await file("B/Nested/Note.md").dragTo(page.locator(".explorer-scroll"), {
      targetPosition: { x: 15, y: 600 },
    });
    await expect(
      page.getByRole("tab", { name: "Note", exact: true }),
    ).toHaveAttribute("data-tooltip", "Note.md");
    expect(await readFile(join(vault, "Note.md"), "utf8")).toContain(
      "![image](A/image.png)",
    );
    ref = await readFile(join(vault, "Ref.md"), "utf8");
    expect(ref).toContain("[markdown](Note.md)");
    expect(ref).toContain("[[Note#anchor|short]]");
    await file("Clash.md").dragTo(file("B"));
    await expect(page.locator(".banner.error")).toContainText("существует");
    expect(await readFile(join(vault, "Clash.md"), "utf8")).toBe(
      "root collision\n",
    );
    expect(await readFile(join(vault, "B", "Clash.md"), "utf8")).toBe(
      "destination collision\n",
    );
    await page.getByRole("button", { name: "Скрыть ошибку" }).click();
    // Record only OS-reveal invocations, without opening windows on the user's desktop.
    const scope = await page.evaluate(async () => {
      const runtime = window as unknown as {
        __TAURI_INTERNALS__: {
          invoke: (
            command: string,
            args?: Record<string, unknown>,
            options?: unknown,
          ) => Promise<unknown>;
        };
        __revealCalls: unknown[];
      };
      const original = runtime.__TAURI_INTERNALS__.invoke.bind(
        runtime.__TAURI_INTERNALS__,
      );
      const vaults = (await original("list_vaults", {})) as { id: string }[];
      let rejected = "";
      try {
        await original("reveal_in_explorer", {
          vaultId: vaults[0].id,
          path: "../outside",
        });
      } catch (error) {
        rejected = (error as { code: string }).code;
      }
      runtime.__revealCalls = [];
      const fetchOriginal = window.fetch.bind(window);
      window.fetch = async (input, options) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        if (url.includes("/reveal_in_explorer")) {
          runtime.__revealCalls.push(JSON.parse(String(options?.body)));
          return new Response("null", {
            headers: {
              "Content-Type": "application/json",
              "Tauri-Response": "ok",
            },
          });
        }
        return fetchOriginal(input, options);
      };
      return rejected;
    });
    expect(scope).toBe("InvalidPath");
    await file("Note.md").click({ button: "right" });
    await page
      .getByRole("menuitem", { name: "Открыть в проводнике", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Действия с файлами", exact: true })
      .click();
    const filesMenu = page.getByRole("group", {
      name: "Действия с файлами",
      exact: true,
    });
    await expect(filesMenu).not.toContainText("Новые файлы в корне");
    await filesMenu
      .getByRole("button", { name: "Открыть хранилище в проводнике" })
      .click();
    const backlink = page
      .locator('.inspector .relation-link[data-tooltip^="Ref.md:"]')
      .first();
    await expect(backlink).toBeVisible();
    await backlink.click({ button: "right" });
    await page
      .getByRole("menuitem", { name: "Открыть в проводнике", exact: true })
      .click();
    const calls = await page.evaluate(() =>
      (
        window as unknown as { __revealCalls: { path: string }[] }
      ).__revealCalls.map((call) => call.path),
    );
    expect(calls).toEqual(["Note.md", "", "Ref.md"]);
    await file("A").click();
    await page
      .getByRole("button", { name: "Открыть новую заметку", exact: true })
      .click();
    await expect(
      page.getByRole("textbox", { name: "Название заметки" }),
    ).toHaveValue("Новая заметка");
    expect(await readFile(join(vault, "Новая заметка.md"), "utf8")).toBe("");
    expect(
      await access(join(vault, "A", "Новая заметка.md")).then(
        () => true,
        () => false,
      ),
    ).toBe(false);
    await page.screenshot({
      path: test.info().outputPath("drag-drop-files.png"),
    });
  } finally {
    await stop(app);
  }
});

test("instant folders and inline tree file renaming without path dialogs", async () => {
  test.skip(process.platform !== "win32", "Native WebView2 runs on Windows");
  const run = await mkdtemp(resolve(root, ".build-cache/native-inline-tree-"));
  const vault = join(run, "Native-MVP"),
    data = join(run, "data"),
    profile = join(run, "profile");
  await mkdir(join(vault, "Родитель"), { recursive: true });
  await mkdir(join(vault, "Новая папка"));
  await mkdir(data);
  await writeFile(join(vault, "Родитель", "Заметка.md"), "# Текст\n");
  await writeFile(join(vault, "Связь.md"), "[[Родитель/Заметка]]\n");
  await writeFile(
    join(data, "settings.json"),
    JSON.stringify({ lastVault: vault }),
  );
  let app: RunningApp | undefined;
  try {
    app = await launch(data, profile, false);
    const page = app.page;
    const file = (path: string) =>
      page.locator(`.tree-item[data-tooltip="${path}"]`);
    await page
      .locator(".sidebar-toolbar")
      .getByRole("button", { name: "Новая папка", exact: true })
      .click();
    const folderName = page.getByRole("textbox", { name: "Имя папки" });
    await expect(folderName).toHaveValue("Новая папка 1");
    await expect(folderName).toBeFocused();
    await expect(page.locator("dialog[open]")).toHaveCount(0);
    await folderName.fill("Планы");
    await folderName.press("Enter");
    await expect(file("Планы")).toBeVisible();
    expect(await readdir(join(vault, "Планы"))).toEqual([]);
    await file("Родитель").click({ button: "right" });
    await page
      .getByRole("menuitem", { name: "Новая папка", exact: true })
      .click();
    await expect(folderName).toHaveValue("Новая папка");
    await expect(folderName).toBeFocused();
    await expect(file("Родитель")).toHaveAttribute("aria-expanded", "true");
    await folderName.fill("Материалы");
    await page.locator(".sidebar-view-title").click();
    await expect(file("Родитель/Материалы")).toBeVisible();
    expect(await readdir(join(vault, "Родитель", "Материалы"))).toEqual([]);
    await page.getByRole("button", { name: "Связь", exact: true }).click();
    const editor = page.getByRole("textbox", { name: "Markdown-редактор" });
    await editor.press("Control+End");
    await editor.pressSequentially("!");
    await file("Родитель/Заметка.md").click({ button: "right" });
    await page
      .getByRole("menuitem", { name: "Переименовать", exact: true })
      .click();
    const fileName = page.getByRole("textbox", { name: "Имя файла" });
    await expect(fileName).toHaveValue("Заметка");
    await expect(fileName).toBeFocused();
    await expect(page.locator("dialog[open]")).toHaveCount(0);
    await page.screenshot({
      path: test.info().outputPath("inline-file-name.png"),
    });
    await fileName.fill("Идея");
    await fileName.press("Enter");
    await expect(file("Родитель/Идея.md")).toBeVisible();
    expect(await readFile(join(vault, "Родитель", "Идея.md"), "utf8")).toBe(
      "# Текст\n",
    );
    expect(await readFile(join(vault, "Связь.md"), "utf8")).toBe(
      "[[Родитель/Идея]]\n!",
    );
    await expect(editor).toContainText("Родитель/Идея");
    await page
      .getByRole("button", { name: "Действия с заметкой", exact: true })
      .click();
    await page
      .getByRole("group", { name: "Действия с заметкой" })
      .getByRole("button", { name: "Переименовать", exact: true })
      .click();
    await expect(
      page.getByRole("textbox", { name: "Название заметки" }),
    ).toBeFocused();
    await expect(page.locator("dialog[open]")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await page
      .locator(".sidebar-toolbar")
      .getByRole("button", { name: "Новая папка", exact: true })
      .click();
    await expect(folderName).toHaveValue("Новая папка 1");
    await folderName.fill("Новая папка");
    await folderName.press("Enter");
    await expect(page.locator(".banner.error")).toContainText("существует");
    await expect(folderName).toBeVisible();
    await folderName.press("Escape");
    expect(await readdir(join(vault, "Новая папка"))).toEqual([]);
    expect(await readdir(join(vault, "Новая папка 1"))).toEqual([]);
    await expect(page.locator("dialog[open]")).toHaveCount(0);
  } finally {
    await stop(app);
  }
});

test("folder context rename and trash preserve contents and refresh nested tabs", async () => {
  test.skip(process.platform !== "win32", "Native WebView2 runs on Windows");
  const run = await mkdtemp(
    resolve(root, ".build-cache/native-folder-actions-"),
  );
  const vault = join(run, "Native-MVP"),
    data = join(run, "data"),
    profile = join(run, "profile");
  await mkdir(join(vault, "Проект", "Вложено"), { recursive: true });
  await mkdir(data);
  const note = "# Заметка\n\n![image](../image.png)\n";
  await writeFile(join(vault, "Проект", "Вложено", "Заметка.md"), note);
  await writeFile(
    join(vault, "Проект", "image.png"),
    Buffer.from([1, 2, 3, 4]),
  );
  await writeFile(
    join(vault, "Связь.md"),
    "[[Проект/Вложено/Заметка]]\n[markdown](Проект/Вложено/Заметка.md)\n",
  );
  await writeFile(
    join(data, "settings.json"),
    JSON.stringify({ lastVault: vault }),
  );
  let app: RunningApp | undefined;
  try {
    app = await launch(data, profile, false);
    const page = app.page;
    const entry = (path: string) =>
      page.locator(`.tree-item[data-tooltip="${path}"]`);
    await entry("Проект").click();
    await entry("Проект/Вложено").click();
    await entry("Проект/Вложено/Заметка.md").click();
    const editor = page.getByRole("textbox", { name: "Markdown-редактор" });
    await editor.press("Control+End");
    await editor.pressSequentially("черновик");
    await entry("Связь.md").click();
    const rename = async (path: string, name: string) => {
      await entry(path).click({ button: "right" });
      await expect(
        page.getByRole("menuitem", {
          name: "Переместить в корзину",
          exact: true,
        }),
      ).toBeVisible();
      await page
        .getByRole("menuitem", { name: "Переименовать", exact: true })
        .click();
      const input = page.getByRole("textbox", { name: "Имя папки" });
      await input.fill(name);
      await input.press("Enter");
      await expect(entry(name)).toBeVisible();
    };
    await rename("Проект", "Архив");
    await expect(
      page.getByRole("tab", { name: "Заметка", exact: true }),
    ).toHaveAttribute("data-tooltip", "Архив/Вложено/Заметка.md");
    await expect(editor).toContainText("Архив/Вложено/Заметка");
    expect(
      await readFile(join(vault, "Архив", "Вложено", "Заметка.md"), "utf8"),
    ).toBe(note + "черновик");
    expect(await readFile(join(vault, "Архив", "image.png"))).toEqual(
      Buffer.from([1, 2, 3, 4]),
    );
    await noteAction(page, "Отменить переименование");
    await page
      .locator("dialog[open]")
      .getByRole("button", { name: "Отменить переименование", exact: true })
      .click();
    await expect(entry("Проект")).toBeVisible();
    await expect(
      page.getByRole("tab", { name: "Заметка", exact: true }),
    ).toHaveAttribute("data-tooltip", "Проект/Вложено/Заметка.md");
    await expect(editor).toContainText("Проект/Вложено/Заметка");
    await rename("Проект", "Архив");
    await entry("Архив").click({ button: "right" });
    await page.screenshot({
      path: test.info().outputPath("folder-context-actions.png"),
    });
    await page
      .getByRole("menuitem", { name: "Переместить в корзину", exact: true })
      .click();
    await page
      .locator("dialog[open]")
      .getByRole("button", { name: "Отмена", exact: true })
      .click();
    expect(
      await readFile(join(vault, "Архив", "Вложено", "Заметка.md"), "utf8"),
    ).toBe(note + "черновик");
    await entry("Архив").click({ button: "right" });
    await page
      .getByRole("menuitem", { name: "Переместить в корзину", exact: true })
      .click();
    await page
      .locator("dialog[open]")
      .getByRole("button", { name: "В корзину", exact: true })
      .click();
    await expect(entry("Архив")).toHaveCount(0);
    await expect(
      page.getByRole("tab", { name: "Заметка", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("tab", { name: "Связь", exact: true }),
    ).toBeVisible();
    const trash = join(vault, ".aether", "trash");
    const holder = (await readdir(trash)).find((name) =>
      name.startsWith("folder-"),
    )!;
    expect(
      await readFile(
        join(trash, holder, "Архив", "Вложено", "Заметка.md"),
        "utf8",
      ),
    ).toBe(note + "черновик");
    expect(await readFile(join(trash, holder, "Архив", "image.png"))).toEqual(
      Buffer.from([1, 2, 3, 4]),
    );
  } finally {
    await stop(app);
  }
});
