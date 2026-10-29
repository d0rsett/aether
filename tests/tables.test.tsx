import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { parseTable, serializeTable } from "../src/editor/tables";
import { EditableTable } from "../src/components/TableEditor";
import { Text } from "@codemirror/state";
import { collectRichSpans } from "../src/editor/liveBlocks";
import type { RenderNode } from "../src/services/api";

afterEach(cleanup);
it("preserves Markdown and escaped pipes while adding missing cells", () => {
  const source =
    "| **Имя** | Ссылка |\r\n| :--- | ---: |\r\n| A\\|B | [[Note\\|Alias]] |\r\n| Last |\r\n";
  const table = parseTable(source)!;
  expect(table.rows[1]).toEqual(["A\\|B", "[[Note\\|Alias]]"]);
  expect(table.rows[2]).toEqual(["Last", ""]);
  expect(parseTable(serializeTable(table))).toEqual(table);
  table.rows[1][0] = "new|value";
  expect(serializeTable(table)).toContain("new\\|value");
  expect(parseTable("> | A |\n> > | --- |\n> | B |")).toBeNull();
});

it("preserves individual quote prefixes and uniform list indentation", () => {
  const quoted =
    "> | A | B |\n>  | --- | --- |\n> | One | Two |\n>  | Three | Four |";
  const table = parseTable(quoted)!;
  table.rows[1][0] = "Changed";
  expect(serializeTable(table)).toBe(
    "> | A | B |\n>  | --- | --- |\n> | Changed | Two |\n>  | Three | Four |",
  );
  const list = "  | A | B |\n  | --- | --- |\n  | One | Two |";
  const nested = parseTable(list)!;
  nested.rows[1][1] = "Changed";
  expect(serializeTable(nested)).toBe(
    "  | A | B |\n  | --- | --- |\n  | One | Changed |",
  );
  expect(parseTable("  | A |\n   | --- |\n  | B |")).toBeNull();
});

it("uses complete lines for safe nested table ranges and rejects list markers", () => {
  const content =
    "Before\n\n> | A | B |\n>  | --- | --- |\n> | One | Two |\n\nAfter";
  const first = content.indexOf("| A"),
    end = content.indexOf("\n\nAfter");
  const node: RenderNode = {
    kind: "table",
    from: first,
    to: end,
    children: [],
    text: "",
    target: "",
    level: 0,
    hasAlias: false,
    line: 3,
    endLine: 5,
  };
  const spans = collectRichSpans([node], Text.of(content.split("\n")));
  expect(spans).toHaveLength(1);
  expect(content.slice(spans[0].from, spans[0].to)).toBe(
    "> | A | B |\n>  | --- | --- |\n> | One | Two |",
  );
  const unsafe = "- | A | B |\n  | --- | --- |\n  | One | Two |";
  expect(
    collectRichSpans(
      [{ ...node, from: 2, to: unsafe.length }],
      Text.of(unsafe.split("\n")),
    ),
  ).toHaveLength(0);
});
it("edits cells and structures directly in the document", async () => {
  const apply = vi.fn();
  render(
    <EditableTable
      source={"| Name | N |\n| --- | --- |\n| Z | 2 |\n| A | 1 |"}
      apply={apply}
    />,
  );
  fireEvent.focus(screen.getByLabelText("Строка 2, столбец 1"));
  fireEvent.contextMenu(screen.getByLabelText("Строка 2, столбец 1"));
  fireEvent.click(screen.getByRole("menuitem", { name: "Сортировать ↑" }));
  await waitFor(() =>
    expect(screen.getByLabelText("Строка 2, столбец 1")).toHaveProperty(
      "value",
      "A",
    ),
  );
  expect(screen.getByLabelText("Строка 2, столбец 1")).toHaveProperty(
    "value",
    "A",
  );
  fireEvent.change(screen.getByLabelText("Строка 2, столбец 1"), {
    target: { value: "Changed" },
  });
  fireEvent.focus(screen.getByLabelText("Строка 2, столбец 2"));
  fireEvent.contextMenu(screen.getByLabelText("Строка 2, столбец 2"));
  fireEvent.click(
    screen.getByRole("menuitemcheckbox", { name: "По правому краю" }),
  );
  await waitFor(() =>
    expect(parseTable(apply.mock.lastCall![0])!.align[1]).toBe("---:"),
  );
  fireEvent.click(screen.getByRole("button", { name: "Добавить столбец" }));
  expect(screen.getByLabelText("Строка 2, столбец 3")).toBe(
    document.activeElement,
  );
  fireEvent.click(screen.getByRole("button", { name: "Добавить строку" }));
  expect(screen.getByLabelText("Строка 4, столбец 3")).toBe(
    document.activeElement,
  );
  expect(apply).toHaveBeenCalled();
  const result = parseTable(apply.mock.lastCall![0])!;
  expect(result.align).toEqual(["---", "---:", "---"]);
  expect(result.rows).toHaveLength(4);
  expect(result.rows[1][0]).toBe("Changed");
});

it("shows formatted cell previews and rejects physical line breaks without changing Markdown", () => {
  const apply = vi.fn();
  render(
    <EditableTable
      source={"| Header |\n| --- |\n| **жирный** и `код` |"}
      apply={apply}
      previews={[
        ["Header"],
        [
          <>
            <strong>жирный</strong> и <code>код</code>
          </>,
        ],
      ]}
    />,
  );
  const cell = screen.getByLabelText(
    "Строка 2, столбец 1",
  ) as HTMLTextAreaElement;
  expect(cell.value).toBe("**жирный** и `код`");
  const preview = cell.parentElement!.querySelector(".table-cell-preview")!;
  expect(preview.querySelector("strong")?.textContent).toBe("жирный");
  expect(preview.querySelector("code")?.textContent).toBe("код");
  fireEvent.focus(cell);
  fireEvent.keyDown(cell, { key: "Enter" });
  expect(screen.getByRole("alert").textContent).toContain("<br>");
  expect(apply).not.toHaveBeenCalled();
  fireEvent.change(cell, { target: { value: "первая\nвторая" } });
  expect(apply).not.toHaveBeenCalled();
  expect(cell.value).toBe("**жирный** и `код`");
  fireEvent.change(cell, {
    target: {
      value: "Очень длинное значение с **разметкой** и <br> переносом",
    },
  });
  expect(parseTable(apply.mock.lastCall![0])!.rows[1][0]).toBe(
    "Очень длинное значение с **разметкой** и <br> переносом",
  );
});
