import {
  Bold,
  Italic,
  Code2,
  Heading2,
  Quote,
  List,
  Link2,
  X,
  Table2,
  Files,
} from "lucide-react";
import type { FormatCommand } from "../editor/enhancements";

const groups = [
  {
    label: "Начертание",
    items: [
      { type: "bold", label: "Жирный", icon: Bold, shortcut: "Ctrl+B" },
      { type: "italic", label: "Курсив", icon: Italic, shortcut: "Ctrl+I" },
      { type: "code", label: "Код", icon: Code2 },
    ],
  },
  {
    label: "Блоки",
    items: [
      { type: "heading", label: "Заголовок", icon: Heading2 },
      { type: "quote", label: "Цитата", icon: Quote },
      { type: "list", label: "Список", icon: List },
      { type: "table", label: "Вставить таблицу", icon: Table2 },
    ],
  },
  {
    label: "Связи",
    items: [{ type: "link", label: "Wiki-ссылка", icon: Link2 }],
  },
] as const;

export function FormattingToolbar({
  disabled,
  onFormat,
  onClose,
  onTemplates,
  active = [],
}: {
  disabled: boolean;
  onFormat: (command: FormatCommand) => void;
  onClose: () => void;
  onTemplates?: () => void;
  active?: FormatCommand[];
}) {
  return (
    <div className="format-toolbar" role="toolbar" aria-label="Форматирование">
      {groups.map((group, index) => (
        <div
          className={`format-group${index === groups.length - 1 ? " format-tail" : ""}`}
          role="group"
          aria-label={group.label}
          key={group.label}
        >
          {group.items.map((item) => (
            <button
              key={item.type}
              disabled={disabled}
              data-tooltip={
                item.label + ("shortcut" in item ? ` · ${item.shortcut}` : "")
              }
              aria-label={item.label}
              aria-pressed={active.includes(item.type)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onFormat(item.type)}
            >
              <item.icon size={17} strokeWidth={1.8} />
              {item.type === "link" && <span>Ссылка</span>}
            </button>
          ))}
          {index === groups.length - 1 && (
            <button
              aria-label="Вставить шаблон"
              data-tooltip="Вставить шаблон"
              disabled={disabled}
              onMouseDown={(event) => event.preventDefault()}
              onClick={onTemplates}
            >
              <Files size={17} />
            </button>
          )}
          {index === groups.length - 1 && (
            <button
              className="format-close"
              aria-label="Скрыть панель форматирования"
              data-tooltip="Скрыть панель форматирования"
              onClick={onClose}
            >
              <X size={15} />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
