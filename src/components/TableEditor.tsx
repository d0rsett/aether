import { t, useLocale } from "../i18n";
import {
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type TextareaHTMLAttributes,
} from "react";
import { Plus } from "lucide-react";
import { useContextMenu } from "./ContextMenu";
import {
  parseTable,
  serializeTable,
  type MarkdownTable,
} from "../editor/tables";
export function EditableTable({
  source,
  apply,
  onHistory,
  previews,
}: {
  source: string;
  apply: (value: string) => void;
  onHistory?: (redo: boolean) => void;
  previews?: ReactNode[][];
}) {
  useLocale();
  const [table, setTable] = useState(() => parseTable(source));
  const [selected, select] = useState([0, 0]);
  const [error, setError] = useState("");
  const context = useContextMenu(setError);
  const root = useRef<HTMLDivElement>(null);
  const nextFocus = useRef<[number, number] | null>(null);
  const ensureVisible = (element: HTMLTextAreaElement) => {
    requestAnimationFrame(() => {
      if (!element.isConnected || document.activeElement !== element) return;
      const grid = element.closest<HTMLElement>(".table-editor-grid");
      if (!grid) return;
      const cell = element.getBoundingClientRect();
      const bounds = grid.getBoundingClientRect();
      if (cell.right > bounds.right)
        grid.scrollLeft += cell.right - bounds.right + 1;
      else if (cell.left < bounds.left)
        grid.scrollLeft -= bounds.left - cell.left + 1;
    });
  };
  useLayoutEffect(() => {
    if (!nextFocus.current) return;
    const [row, column] = nextFocus.current;
    nextFocus.current = null;
    root.current
      ?.querySelector<HTMLTextAreaElement>(
        `textarea[data-row="${row}"][data-column="${column}"]`,
      )
      ?.focus();
  }, [table]);
  const change = (update: (copy: MarkdownTable) => void) => {
    if (!table) return;
    const copy = {
      rows: table.rows.map((row) => [...row]),
      align: [...table.align],
      prefixes: [...table.prefixes],
    };
    update(copy);
    try {
      apply(serializeTable(copy));
      setTable(copy);
      setError("");
    } catch {
      nextFocus.current = null;
      setError(
        t("Таблица изменилась. Перейдите в исходник и повторите изменение."),
      );
    }
  };
  const [r, c] = selected;
  const moveRow = (r: number, c: number, direction: number) =>
    change((copy) => {
      const next = r + direction;
      [copy.rows[r], copy.rows[next]] = [copy.rows[next], copy.rows[r]];
      [copy.prefixes[r + 1], copy.prefixes[next + 1]] = [
        copy.prefixes[next + 1],
        copy.prefixes[r + 1],
      ];
      select([next, c]);
    });
  const moveColumn = (r: number, c: number, direction: number) =>
    change((copy) => {
      const next = c + direction;
      for (const row of [...copy.rows, copy.align])
        [row[c], row[next]] = [row[next], row[c]];
      select([r, next]);
    });
  return (
    <div
      ref={root}
      className="inline-table-editor"
      role="group"
      aria-label={t("Редактор таблицы")}
    >
      {table ? (
        <>
          <div className="table-editor-grid">
            <div
              className="table-editor-track"
              style={{ minWidth: `${table.align.length * 96 + 30}px` }}
            >
              <div className="table-editor-main">
                <table>
                  <tbody>
                    {table.rows.map((row, ri) => (
                      <tr key={ri}>
                        {row.map((value, ci) => (
                          <td key={ci}>
                            <div className="table-cell">
                              <CellInput
                                data-row={ri}
                                data-column={ci}
                                aria-label={t`Строка ${ri + 1}, столбец ${ci + 1}`}
                                value={value}
                                align={table.align[ci]}
                                preview={previews?.[ri]?.[ci]}
                                onFocus={(event) => {
                                  select([ri, ci]);
                                  ensureVisible(event.currentTarget);
                                }}
                                onContextMenu={(event) => {
                                  event.currentTarget.focus();
                                  select([ri, ci]);
                                  const currentAlign = table.align[ci];
                                  const alignment = currentAlign.startsWith(":")
                                    ? currentAlign.endsWith(":")
                                      ? ":---:"
                                      : ":---"
                                    : currentAlign.endsWith(":")
                                      ? "---:"
                                      : "---";
                                  context.show(event, t("Действия с ячейкой"), [
                                    {
                                      label: t("Удалить строку"),
                                      disabled: ri === 0,
                                      run: () =>
                                        change((copy) => {
                                          copy.rows.splice(ri, 1);
                                          copy.prefixes.splice(ri + 1, 1);
                                          select([Math.max(0, ri - 1), ci]);
                                        }),
                                    },
                                    {
                                      label: t("Строку выше"),
                                      disabled: ri < 2,
                                      run: () => moveRow(ri, ci, -1),
                                    },
                                    {
                                      label: t("Строку ниже"),
                                      disabled:
                                        ri === 0 ||
                                        ri === table.rows.length - 1,
                                      run: () => moveRow(ri, ci, 1),
                                    },
                                    {
                                      label: t("Удалить столбец"),
                                      divider: true,
                                      disabled: table.align.length === 1,
                                      run: () =>
                                        change((copy) => {
                                          copy.rows.forEach((row) =>
                                            row.splice(ci, 1),
                                          );
                                          copy.align.splice(ci, 1);
                                          select([ri, Math.max(0, ci - 1)]);
                                        }),
                                    },
                                    {
                                      label: t("Столбец левее"),
                                      disabled: ci === 0,
                                      run: () => moveColumn(ri, ci, -1),
                                    },
                                    {
                                      label: t("Столбец правее"),
                                      disabled: ci === table.align.length - 1,
                                      run: () => moveColumn(ri, ci, 1),
                                    },
                                    ...[
                                      [t("Обычное выравнивание"), "---"],
                                      [t("По левому краю"), ":---"],
                                      [t("По центру"), ":---:"],
                                      [t("По правому краю"), "---:"],
                                    ].map(([label, value], index) => ({
                                      label,
                                      divider: index === 0,
                                      checked: alignment === value,
                                      run: () =>
                                        change((copy) => {
                                          copy.align[ci] = value;
                                        }),
                                    })),
                                    ...[1, -1].map((direction) => ({
                                      label: t`Сортировать ${direction === 1 ? "↑" : "↓"}`,
                                      divider: direction === 1,
                                      run: () =>
                                        change((copy) => {
                                          const sorted = copy.rows
                                            .slice(1)
                                            .map((row, index) => ({
                                              row,
                                              prefix: copy.prefixes[index + 2],
                                            }))
                                            .sort(
                                              (a, b) =>
                                                direction *
                                                a.row[ci].localeCompare(
                                                  b.row[ci],
                                                  "ru",
                                                  { numeric: true },
                                                ),
                                            );
                                          copy.rows = [
                                            copy.rows[0],
                                            ...sorted.map((item) => item.row),
                                          ];
                                          copy.prefixes = [
                                            copy.prefixes[0],
                                            copy.prefixes[1],
                                            ...sorted.map(
                                              (item) => item.prefix,
                                            ),
                                          ];
                                          select([0, ci]);
                                        }),
                                    })),
                                  ]);
                                }}
                                onKeyDown={(event) => {
                                  if (
                                    event.key === "ContextMenu" ||
                                    (event.shiftKey && event.key === "F10")
                                  ) {
                                    event.preventDefault();
                                    event.currentTarget.dispatchEvent(
                                      new MouseEvent("contextmenu", {
                                        bubbles: true,
                                        cancelable: true,
                                      }),
                                    );
                                    return;
                                  }
                                  if (event.key === "Enter") {
                                    event.preventDefault();
                                    setError(
                                      t(
                                        "Для переноса строки в ячейке используйте <br>.",
                                      ),
                                    );
                                    return;
                                  }
                                  if (
                                    (event.ctrlKey || event.metaKey) &&
                                    !event.altKey &&
                                    ["z", "y"].includes(event.key.toLowerCase())
                                  ) {
                                    event.preventDefault();
                                    onHistory?.(
                                      event.key.toLowerCase() === "y" ||
                                        event.shiftKey,
                                    );
                                  }
                                }}
                                onChange={(event) => {
                                  const next = event.target.value;
                                  ensureVisible(event.currentTarget);
                                  if (/[\r\n]/.test(next)) {
                                    setError(
                                      t(
                                        "Нельзя вставить несколько строк в ячейку. Для переноса используйте <br>.",
                                      ),
                                    );
                                    return;
                                  }
                                  change((copy) => {
                                    copy.rows[ri][ci] = next;
                                  });
                                }}
                              />
                            </div>
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                <button
                  type="button"
                  className="table-add table-add-row"
                  aria-label={t("Добавить строку")}
                  title={t("Добавить строку")}
                  disabled={(table.rows.length + 1) * table.align.length > 5000}
                  onClick={() => {
                    const row = table.rows.length;
                    nextFocus.current = [row, c];
                    change((copy) => {
                      copy.rows.push(copy.align.map(() => ""));
                      copy.prefixes.push(copy.prefixes.at(-1) ?? "");
                      select([row, c]);
                    });
                  }}
                >
                  <Plus size={16} aria-hidden="true" />
                </button>
              </div>
              <button
                type="button"
                className="table-add table-add-column"
                aria-label={t("Добавить столбец")}
                title={t("Добавить столбец")}
                disabled={
                  table.align.length >= 50 ||
                  table.rows.length * (table.align.length + 1) > 5000
                }
                onClick={() => {
                  const column = table.align.length;
                  nextFocus.current = [r, column];
                  change((copy) => {
                    copy.rows.forEach((row) => row.push(""));
                    copy.align.push("---");
                    select([r, column]);
                  });
                }}
              >
                <Plus size={16} aria-hidden="true" />
              </button>
            </div>
          </div>
          {error && <p role="alert">{t(error)}</p>}
          {context.menu}
        </>
      ) : (
        <p>{t("Эту таблицу можно изменить в исходнике заметки.")}</p>
      )}
    </div>
  );
}
function CellInput({
  value,
  preview,
  align,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & {
  value: string;
  preview?: ReactNode;
  align: string;
}) {
  useLocale();
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const resize = () => {
      element.style.height = "auto";
      const previewHeight =
        element.parentElement?.querySelector<HTMLElement>(".table-cell-preview")
          ?.scrollHeight ?? 0;
      element.style.height = `${Math.max(40, Math.min(Math.max(element.scrollHeight, previewHeight), 320))}px`;
    };
    resize();
    let width = element.clientWidth;
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => {
            if (width !== element.clientWidth) {
              width = element.clientWidth;
              resize();
            }
          });
    observer?.observe(element.parentElement!);
    return () => observer?.disconnect();
  }, [value, preview]);
  const textAlign = align.startsWith(":")
    ? align.endsWith(":")
      ? "center"
      : "left"
    : align.endsWith(":")
      ? "right"
      : "left";
  return (
    <>
      <textarea
        {...props}
        ref={ref}
        rows={1}
        value={value}
        style={{ textAlign }}
      />
      <span
        className="table-cell-preview"
        aria-hidden="true"
        style={{ textAlign }}
      >
        {preview ?? value}
      </span>
    </>
  );
}
