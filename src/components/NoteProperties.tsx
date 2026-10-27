import { useMemo, useState } from "react";
import { ChevronRight, Plus, Pencil } from "lucide-react";
import { Modal } from "./Modal";
import {
  readProperties,
  propertyValue,
  type NoteProperty,
  type PropertyAction,
  type PropertyType,
} from "../editor/properties";

export type ApplyProperty = (
  action: PropertyAction,
  expected: string,
  done: (error?: string) => void,
) => void;
const types: { key: PropertyType; label: string }[] = [
  { key: "text", label: "Текст" },
  { key: "list", label: "Список" },
  { key: "number", label: "Число" },
  { key: "date", label: "Дата" },
  { key: "checkbox", label: "Флажок" },
];

export function NoteProperties({
  content,
  onApply,
  onSource,
}: {
  content: string;
  onApply: ApplyProperty;
  onSource: () => void;
}) {
  const properties = useMemo(() => readProperties(content), [content]);
  const [editing, setEditing] = useState<{
    property?: NoteProperty;
    expected: string;
  } | null>(null);
  return (
    <section className="note-properties" aria-label="Свойства заметки">
      <details className="relations-section" open>
        <summary className="relations-heading">
          <ChevronRight className="relations-chevron" size={12} />
          <span>Свойства</span>
          <small>{properties.items.length}</small>
        </summary>
        {properties.error ? (
          <p className="tree-error" role="alert">
            {properties.error}
          </p>
        ) : (
          <>
            {properties.items.map((item) => (
              <button
                key={item.key}
                type="button"
                className="property-row"
                onClick={() =>
                  item.type === "unsupported"
                    ? onSource()
                    : setEditing({
                        property: item,
                        expected: properties.expected,
                      })
                }
                aria-label={`Изменить свойство ${item.key}`}
              >
                <span className="property-name">{item.key}</span>
                <span className="property-value">
                  {Array.isArray(item.value)
                    ? item.value.join(", ")
                    : typeof item.value === "boolean"
                      ? item.value
                        ? "Да"
                        : "Нет"
                      : String(item.value) || "Пусто"}
                </span>
                <Pencil size={12} />
              </button>
            ))}
            <button
              className="property-add"
              type="button"
              onClick={() => setEditing({ expected: properties.expected })}
            >
              <Plus size={13} />
              Добавить свойство
            </button>
          </>
        )}
        <button type="button" className="property-source" onClick={onSource}>
          Открыть свойства в исходнике
        </button>
      </details>
      {editing && (
        <PropertyForm
          property={editing.property}
          expected={editing.expected}
          onApply={onApply}
          onClose={() => setEditing(null)}
        />
      )}
    </section>
  );
}

function PropertyForm({
  property,
  expected,
  onApply,
  onClose,
}: {
  property?: NoteProperty;
  expected: string;
  onApply: ApplyProperty;
  onClose: () => void;
}) {
  const [key, setKey] = useState(property?.key ?? "");
  const [type, setType] = useState<PropertyType>(
    property?.type === "unsupported" ? "text" : (property?.type ?? "text"),
  );
  const [text, setText] = useState(
    Array.isArray(property?.value)
      ? property.value.join("\n")
      : typeof property?.value === "string" ||
          typeof property?.value === "number"
        ? String(property.value)
        : "",
  );
  const [checked, setChecked] = useState(property?.value === true);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const name = property?.key ?? key.trim();
  const list = name === "tags" || name === "aliases";
  const selected = list ? "list" : type;
  const apply = (action: PropertyAction) => {
    setPending(true);
    onApply(action, expected, (message) => {
      setPending(false);
      if (message) setError(message);
      else onClose();
    });
  };
  return (
    <Modal
      title={property ? "Изменить свойство" : "Добавить свойство"}
      onClose={onClose}
      className="property-dialog"
    >
      <form
        className="property-form"
        onSubmit={(event) => {
          event.preventDefault();
          try {
            apply({
              key: name,
              value: propertyValue(name, selected, text, checked),
              create: !property,
            });
          } catch (reason) {
            setError(
              reason instanceof Error
                ? reason.message
                : "Не удалось изменить свойство.",
            );
          }
        }}
      >
        <label className="input-label">
          Имя свойства
          <input
            autoFocus
            value={key}
            readOnly={!!property}
            onChange={(event) => setKey(event.target.value)}
            required
            maxLength={256}
          />
        </label>
        <label className="input-label">
          Тип свойства
          <select
            value={selected}
            disabled={list}
            onChange={(event) => {
              const next = types.find(
                (item) => item.key === event.target.value,
              );
              if (next) setType(next.key);
            }}
          >
            {types.map((item) => (
              <option key={item.key} value={item.key}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        {selected === "checkbox" ? (
          <label className="property-checkbox">
            <input
              type="checkbox"
              checked={checked}
              onChange={(event) => setChecked(event.target.checked)}
            />
            Значение включено
          </label>
        ) : (
          <label className="input-label">
            Значение
            {selected === "list" || selected === "text" ? (
              <textarea
                aria-label="Значение"
                value={text}
                onChange={(event) => setText(event.target.value)}
                rows={selected === "list" ? 5 : 3}
              />
            ) : (
              <input
                aria-label="Значение"
                type={selected === "date" ? "date" : "text"}
                inputMode={selected === "number" ? "decimal" : undefined}
                value={text}
                onChange={(event) => setText(event.target.value)}
                required
              />
            )}
          </label>
        )}
        {selected === "list" && (
          <p className="modal-description">
            Каждое значение — с новой строки. Запятые остаются частью значения.
          </p>
        )}
        {error && (
          <p className="tree-error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-actions">
          {property && (
            <button
              className="button danger"
              type="button"
              disabled={pending}
              onClick={() => apply({ key: property.key, remove: true })}
            >
              Удалить свойство
            </button>
          )}
          <button className="button secondary" type="button" onClick={onClose}>
            Отмена
          </button>
          <button className="button primary" type="submit" disabled={pending}>
            Применить
          </button>
        </div>
      </form>
    </Modal>
  );
}
