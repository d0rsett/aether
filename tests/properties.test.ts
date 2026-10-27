import { expect, it } from "vitest";
import {
  propertyEdit,
  propertyValue,
  readProperties,
  type PropertyAction,
} from "../src/editor/properties";

function edit(
  source: string,
  action: PropertyAction,
  expected = readProperties(source).expected,
) {
  const change = propertyEdit(source, action, expected);
  const normalized = source.replace(/\r\n/g, "\n");
  return (
    normalized.slice(0, change.from) +
    change.insert +
    normalized.slice(change.to)
  );
}
it("changes only the chosen value while retaining comments, unknown YAML, BOM and body", () => {
  const source =
    "\uFEFF---\r\n# comment\r\ntitle: 'Old' # title note\r\nplugin:\r\n  deep: {enabled: true, value: 9007199254740993}\r\n---\r\n# Body 😀\r\nDraft\r\n";
  expect(
    edit(source, { key: "title", value: "New: [[Link]]", create: false }),
  ).toBe(source.replace(/\r\n/g, "\n").replace("'Old'", '"New: [[Link]]"'));
  expect(
    readProperties(source).items.find((item) => item.key === "plugin")?.type,
  ).toBe("unsupported");
});
it("handles block lists, literal text and empty values without joining adjacent properties", () => {
  for (const [original, value, result] of [
    [
      "tags:\n  - old\n  - two\nnext: keep\n",
      ["new", "[[Link]]"],
      'tags:\n  ["new","[[Link]]"]\nnext: keep\n',
    ],
    [
      "title: |\n  Old\n  text\nnext: keep\n",
      "New\ntext",
      'title: "New\\ntext"\nnext: keep\n',
    ],
    [
      "title: # comment\nnext: keep\n",
      "New",
      'title: "New" # comment\nnext: keep\n',
    ],
  ] as const) {
    const key = original.startsWith("tags") ? "tags" : "title";
    expect(
      edit(`---\n${original}---\nBody`, {
        key,
        value: Array.isArray(value) ? [...value] : String(value),
        create: false,
      }),
    ).toBe(`---\n${result}---\nBody`);
  }
});
it("adds properties to plain notes and empty headers without changing Markdown", () => {
  expect(
    edit("\uFEFF# Body", { key: "title", value: "true", create: true }),
  ).toBe('\uFEFF---\n"title": "true"\n---\n# Body');
  expect(
    edit("---\n# keep\n---\nBody", { key: "done", value: false, create: true }),
  ).toBe('---\n# keep\n"done": false\n---\nBody');
});
it("deletes one property while preserving neighbors and comments", () => {
  const source =
    "---\n# keep\nlist:\n  - A\n  - B\nother: 'unchanged' # comment\n---\nBody";
  expect(edit(source, { key: "list", remove: true })).toBe(
    "---\n# keep\nother: 'unchanged' # comment\n---\nBody",
  );
});
it("edits flow/JSON frontmatter and preserves unrelated structured values", () => {
  const source =
    '---\n{"count": 1, "plugin": {"nested": [1, 2]}, "title": "old"}\n---\nBody';
  const changed = edit(source, { key: "count", value: 2.5, create: false });
  expect(
    readProperties(changed).items.find((item) => item.key === "count")?.value,
  ).toBe(2.5);
  expect(changed).toContain('"plugin": { "nested": [ 1, 2 ] }');
  expect(changed.endsWith("---\nBody")).toBe(true);
});
it("rejects invalid, duplicate, unclosed and oversized YAML without generating a replacement", () => {
  for (const source of [
    "---\nx: [bad\n---\nBody",
    "---\nx: 1\nx: 2\n---",
    "---\n- one\n---",
    "---\nx: 1\nBody",
    `---\nx: ${"a".repeat(65536)}\n---`,
  ]) {
    expect(readProperties(source).error).not.toBe("");
    expect(() => edit(source, { key: "x", value: 3, create: false })).toThrow();
  }
});
it("keeps anchored, alias, tagged, mixed-list and unsafe integer properties in source control", () => {
  const source =
    "---\nx: &ref old\ny: *ref\nz: !custom value\nnested: [one, 2]\nhuge: 9007199254740993\n---\nBody";
  expect(
    readProperties(source).items.every((item) => item.type === "unsupported"),
  ).toBe(true);
  for (const key of ["x", "y", "z", "nested", "huge"])
    expect(() => edit(source, { key, value: "new", create: false })).toThrow();
});
it("rejects stale header edits but permits intervening body changes", () => {
  const source = "---\ntitle: Old\n---\nBody";
  const expected = readProperties(source).expected;
  expect(
    edit(
      source + " new draft",
      { key: "title", value: "New", create: false },
      expected,
    ),
  ).toContain("Body new draft");
  expect(() =>
    edit(
      source.replace("Old", "Changed"),
      { key: "title", value: "New", create: false },
      expected,
    ),
  ).toThrow(/изменились/);
  expect(() =>
    edit(source, { key: "title", value: "Duplicate", create: true }),
  ).toThrow(/существует/);
});
it("validates typed numbers, dates, tags and alias lists while preserving commas", () => {
  expect(propertyValue("count", "number", "-1.5e2", false)).toBe(-150);
  expect(propertyValue("due", "date", "2028-02-29", false)).toBe("2028-02-29");
  expect(() => propertyValue("due", "date", "2026-02-29", false)).toThrow();
  expect(() => propertyValue("count", "number", "Infinity", false)).toThrow();
  expect(() =>
    propertyValue("count", "number", "9007199254740993", false),
  ).toThrow();
  expect(propertyValue("tags", "text", "#работа\nproject/test", false)).toEqual(
    ["работа", "project/test"],
  );
  expect(propertyValue("aliases", "text", "First, Last\nИИ", false)).toEqual([
    "First, Last",
    "ИИ",
  ]);
  expect(() => propertyValue("aliases", "list", "bad|link", false)).toThrow();
  expect(propertyValue("flag", "checkbox", "", false)).toBe(false);
});
