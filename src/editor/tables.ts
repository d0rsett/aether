export interface MarkdownTable {
  rows: string[][];
  align: string[];
  // Prefixes are attached to physical source lines, including the separator.
  prefixes: string[];
}

function cells(line: string): string[] {
  const result: string[] = [];
  let value = "";
  let trailingDelimiter = false;
  for (let at = 0; at < line.length; at++) {
    if (line[at] === "\\" && at + 1 < line.length) {
      value += line[at] + line[++at];
      trailingDelimiter = false;
    } else if (line[at] === "|") {
      result.push(value.trim());
      value = "";
      trailingDelimiter = true;
    } else {
      value += line[at];
      if (line[at].trim()) trailingDelimiter = false;
    }
  }
  result.push(value.trim());
  if (line.trimStart().startsWith("|")) result.shift();
  if (trailingDelimiter) result.pop();
  return result;
}

export function parseTable(source: string): MarkdownTable | null {
  if (source.length > 262_144) return null;
  const lines = source.trimEnd().split(/\r?\n/);
  if (lines.length < 2) return null;
  const parts: { prefix: string; content: string }[] = [];
  for (const line of lines) {
    const match = /^((?:[ \t]*>[ \t]*)+|[ \t]*)(.*)$/.exec(line);
    if (!match) return null;
    parts.push({ prefix: match[1], content: match[2] });
  }
  const prefixes = parts.map((part) => part.prefix);
  const quoteDepth = (prefix: string) => (prefix.match(/>/g) ?? []).length;
  const depth = quoteDepth(prefixes[0]);
  // Do not guess how inconsistent list indentation or quote nesting relates to its container.
  if (
    prefixes.some(
      (prefix) =>
        quoteDepth(prefix) !== depth || (!depth && prefix !== prefixes[0]),
    )
  )
    return null;
  const rows = parts.map((part) => cells(part.content));
  const align = rows[1];
  if (align.length > 50 || (rows.length - 1) * align.length > 5000) return null;
  if (!align.length || align.some((cell) => !/^:?-{2,}:?$/.test(cell)))
    return null;
  if (
    rows[0].length !== align.length ||
    rows.some((row) => row.length > align.length)
  )
    return null;
  rows.splice(1, 1);
  return {
    align,
    prefixes,
    rows: rows.map((row) => [
      ...row,
      ...Array<string>(align.length - row.length).fill(""),
    ]),
  };
}

export function serializeTable(table: MarkdownTable): string {
  const escape = (value: string) =>
    value
      .replace(/\r?\n/g, " ")
      .replace(
        /(\\.)|\|/g,
        (_match, escaped: string | undefined) => escaped ?? "\\|",
      );
  const row = (values: string[], prefix: string) =>
    `${prefix}| ${values.map(escape).join(" | ")} |`;
  const prefix = (index: number) =>
    table.prefixes[index] ?? table.prefixes.at(-1) ?? "";
  return [
    row(table.rows[0], prefix(0)),
    row(table.align, prefix(1)),
    ...table.rows
      .slice(1)
      .map((values, index) => row(values, prefix(index + 2))),
  ].join("\n");
}
