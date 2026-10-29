import { t, useLocale } from "../i18n";
import {
  useEffect,
  useMemo,
  useRef,
  useId,
  useState,
  type KeyboardEvent,
} from "react";
import {
  CalendarClock,
  Check,
  X,
  CalendarDays,
  CheckSquare,
  ChevronRight,
  Hash,
  List,
  Plus,
  Trash2,
  Type,
} from "lucide-react";
import { useContextMenu } from "./ContextMenu";
import { api } from "../services/api";
import { propertyCatalog } from "../services/propertyCatalog";
import {
  configuredPropertyType,
  configuredTypeName,
  propertyValue,
  readProperties,
  type NoteProperty,
  type PropertyAction,
  type PropertyType,
  type PropertyTypes,
} from "../editor/properties";
export type PropertyApply = (
  action: PropertyAction,
  expected: string,
  done: (error?: string) => void,
) => void;
const choices: {
  value: PropertyType;
  label: string;
}[] = [
  { value: "text", label: "Текст" },
  { value: "list", label: "Список" },
  { value: "number", label: "Число" },
  { value: "date", label: "Дата" },
  { value: "datetime", label: "Дата и время" },
  { value: "checkbox", label: "Флажок" },
];
function TypePicker({
  type,
  label,
  locked = false,
  onSelect,
}: {
  type: PropertyType;
  label: string;
  locked?: boolean;
  onSelect: (type: PropertyType) => void;
}) {
  useLocale();
  const menu = useContextMenu();
  const icon = {
    text: Type,
    list: List,
    number: Hash,
    date: CalendarDays,
    datetime: CalendarClock,
    checkbox: CheckSquare,
  }[type];
  const Icon = icon;
  const current = t(
    choices.find((choice) => choice.value === type)?.label ?? "Текст",
  );
  return (
    <>
      <button
        type="button"
        className="inline-property-type"
        aria-label={label}
        title={
          locked ? t`${current} · встроенное свойство` : t`Тип: ${current}`
        }
        aria-haspopup="menu"
        onClick={(event) =>
          menu.show(
            event,
            label,
            choices.map((choice, index) => ({
              label: t(choice.label),
              icon: (() => {
                const ChoiceIcon = {
                  text: Type,
                  list: List,
                  number: Hash,
                  date: CalendarDays,
                  datetime: CalendarClock,
                  checkbox: CheckSquare,
                }[choice.value];
                return <ChoiceIcon size={15} aria-hidden="true" />;
              })(),
              heading:
                index === 0
                  ? locked
                    ? t("Тип встроенного свойства")
                    : t("Тип для всего хранилища")
                  : undefined,
              checked: choice.value === type,
              disabled: locked && choice.value !== type,
              run: () => {
                if (!locked && choice.value !== type) onSelect(choice.value);
              },
            })),
          )
        }
      >
        <Icon size={15} aria-hidden="true" />
      </button>
      {menu.menu}
    </>
  );
}
const invalidDrafts = new Map<
  string,
  {
    text: string;
    error: string;
  }
>();
type NewPropertyDraft = {
  name: string;
  type: PropertyType;
  value: string;
  checked: boolean;
};
const newPropertyDrafts = new Map<string, NewPropertyDraft>();
const emptyPropertyDraft = (): NewPropertyDraft => ({
  name: "",
  type: "text",
  value: "",
  checked: false,
});
export function InlineProperties({
  content,
  vaultId,
  path,
  onApply,
  onSource,
  onHistory,
}: {
  content: string;
  vaultId: string;
  path: string;
  onApply: PropertyApply;
  onSource: () => void;
  onHistory?: (redo: boolean) => void;
}) {
  useLocale();
  const [settings, setSettings] = useState<{
    vaultId: string;
    types: PropertyTypes;
    error: string;
  } | null>(null);
  const formKey = JSON.stringify([vaultId, path]);
  const [adding, setAdding] = useState(() => newPropertyDrafts.has(formKey));
  const [form, setForm] = useState(
    () => newPropertyDrafts.get(formKey) ?? emptyPropertyDraft(),
  );
  const { name, type, value: newValue, checked: newChecked } = form;
  const updateForm = (patch: Partial<NewPropertyDraft>) => {
    const next = { ...form, ...patch };
    newPropertyDrafts.set(formKey, next);
    setForm(next);
  };
  const startAdding = () => {
    newPropertyDrafts.set(formKey, form);
    setAdding(true);
  };
  const [error, setError] = useState("");
  const suggestionId = useId();
  const [catalog, setCatalog] = useState<Record<string, string[]>>({});
  const [catalogError, setCatalogError] = useState("");
  useEffect(() => {
    let active = true;
    setCatalogError("");
    void propertyCatalog(vaultId)
      .then((value) => {
        if (active) setCatalog(value);
      })
      .catch(() => {
        if (active) {
          setCatalog({});
          setCatalogError(
            t(
              "Не удалось загрузить подсказки свойств. Значения можно ввести вручную.",
            ),
          );
        }
      });
    return () => {
      active = false;
    };
  }, [vaultId]);
  useEffect(() => {
    let active = true;
    setSettings(null);
    void api
      .propertyTypes(vaultId)
      .then((types) => {
        if (active) setSettings({ vaultId, types, error: "" });
      })
      .catch(() => {
        if (active)
          setSettings({
            vaultId,
            types: {},
            error: t("Не удалось прочитать типы свойств Obsidian."),
          });
      });
    return () => {
      active = false;
    };
  }, [vaultId]);
  const identity = useRef(formKey);
  identity.current = formKey;
  const pendingType = useRef(false);
  useEffect(
    () => () => {
      identity.current = "";
    },
    [],
  );
  useEffect(() => {
    const reload = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          vaultId: string;
          types: PropertyTypes;
        }>
      ).detail;
      if (detail.vaultId === vaultId) setSettings({ ...detail, error: "" });
    };
    window.addEventListener("aether:property-types", reload);
    return () => window.removeEventListener("aether:property-types", reload);
  }, [vaultId]);
  const saveType = async (key: string, type: PropertyType) => {
    if (!settings || settings.error)
      throw new Error(t("Типы свойств ещё не загружены."));
    if (pendingType.current)
      throw new Error(t("Дождитесь сохранения типа свойства."));
    pendingType.current = true;
    try {
      const types = await api.setPropertyType(
        vaultId,
        key,
        type === "list" ? "multitext" : type,
        settings.types,
      );
      window.dispatchEvent(
        new CustomEvent("aether:property-types", {
          detail: { vaultId, types },
        }),
      );
      if (identity.current !== formKey)
        throw new Error(
          t(
            "Заметка изменилась. Тип сохранён для хранилища; значение заметки не изменено.",
          ),
        );
    } finally {
      pendingType.current = false;
    }
  };
  const ready = settings?.vaultId === vaultId;
  const parsed = useMemo(
    () => readProperties(content, ready ? settings.types : {}),
    [content, settings, ready],
  );
  const configuredName = ready
    ? configuredTypeName(settings.types, name.trim())
    : undefined;
  const configured = configuredPropertyType(configuredName);
  const chosen =
    configured ??
    (name.trim() === "tags" || name.trim() === "aliases" ? "list" : type);
  if (
    ready &&
    !settings.error &&
    !parsed.error &&
    !parsed.items.length &&
    !adding &&
    !/^\uFEFF?---\r?\n/.test(content)
  ) {
    return (
      <section
        className="inline-properties inline-properties-empty"
        aria-label={t("Свойства заметки")}
      >
        <button
          type="button"
          className="inline-property-add"
          onClick={startAdding}
        >
          <Plus size={14} />
          {t(" Добавить свойство ")}
        </button>
      </section>
    );
  }
  return (
    <section className="inline-properties" aria-label={t("Свойства заметки")}>
      <details open>
        <summary>
          <ChevronRight className="inline-properties-chevron" size={14} />
          <span>{t("Свойства")}</span>
          <small>{parsed.items.length}</small>
        </summary>
        {!ready ? (
          <p className="inline-property-message">
            {t("Загрузка свойств\u2026")}
          </p>
        ) : settings.error || parsed.error ? (
          <p className="inline-property-error" role="alert">
            {t(settings.error || parsed.error)}
          </p>
        ) : (
          <div
            className="inline-property-grid"
            role="table"
            aria-label={t("Таблица свойств")}
          >
            {parsed.items.map((item) => (
              <PropertyRow
                key={item.key}
                item={item}
                suggestions={catalog[item.key] ?? []}
                names={parsed.items.map((item) => item.key)}
                onRenameType={async (name, type) => {
                  const assigned = configuredTypeName(settings.types, name);
                  if (assigned && configuredPropertyType(assigned) !== type)
                    throw new Error(
                      t(
                        "У этого имени уже задан другой тип в хранилище. Сначала измените тип свойства.",
                      ),
                    );
                  if (!assigned) await saveType(name, type);
                }}
                assignedType={configuredPropertyType(
                  configuredTypeName(settings.types, item.key),
                )}
                typeLocked={
                  item.key === "tags" ||
                  item.key === "aliases" ||
                  item.key === "cssclasses"
                }
                onType={saveType}
                draftKey={JSON.stringify([vaultId, path, item.key])}
                expected={parsed.expected}
                onApply={onApply}
                onSource={onSource}
                onHistory={onHistory}
              />
            ))}
          </div>
        )}
        {error && (
          <p className="inline-property-error" role="alert">
            {t(error)}
          </p>
        )}
        {ready &&
          !settings.error &&
          !parsed.error &&
          (adding ? (
            <form
              className="inline-property-new"
              onSubmit={async (event) => {
                event.preventDefault();
                try {
                  if (configuredName && !configured)
                    throw new Error(
                      t(
                        "Неизвестный тип свойства Obsidian. Добавьте его в исходнике.",
                      ),
                    );
                  const value = propertyValue(
                    name.trim(),
                    chosen,
                    newValue,
                    newChecked,
                  );
                  if (
                    !configured &&
                    !["tags", "aliases", "cssclasses"].includes(name.trim())
                  )
                    await saveType(name.trim(), chosen);
                  onApply(
                    { key: name.trim(), value, create: true },
                    parsed.expected,
                    (message) => {
                      if (message) setError(message);
                      else {
                        setError("");
                        newPropertyDrafts.delete(formKey);
                        setForm(emptyPropertyDraft());
                        setAdding(false);
                      }
                    },
                  );
                } catch (reason) {
                  setError(
                    reason instanceof Error
                      ? reason.message
                      : t("Не удалось добавить свойство."),
                  );
                }
              }}
            >
              <div className="inline-property-row inline-property-new-row">
                <div className="inline-property-name inline-property-new-name">
                  <TypePicker
                    type={chosen}
                    label={t("Тип нового свойства")}
                    locked={
                      !!configuredName ||
                      name.trim() === "tags" ||
                      name.trim() === "aliases"
                    }
                    onSelect={(next) => updateForm({ type: next })}
                  />
                  <input
                    autoFocus
                    aria-label={t("Имя нового свойства")}
                    list={suggestionId}
                    value={name}
                    onChange={(event) =>
                      updateForm({ name: event.target.value })
                    }
                    placeholder={t("Имя свойства")}
                    required
                    maxLength={256}
                  />
                </div>
                <div className="inline-property-value">
                  {chosen === "checkbox" ? (
                    <input
                      type="checkbox"
                      aria-label={t("Значение нового свойства")}
                      checked={newChecked}
                      onChange={(event) =>
                        updateForm({ checked: event.target.checked })
                      }
                    />
                  ) : chosen === "list" ? (
                    <textarea
                      aria-label={t("Значение нового свойства")}
                      placeholder={t("Каждое значение с новой строки")}
                      value={newValue}
                      onChange={(event) =>
                        updateForm({ value: event.target.value })
                      }
                    />
                  ) : (
                    <input
                      aria-label={t("Значение нового свойства")}
                      placeholder={t("Значение")}
                      list={`${suggestionId}-value`}
                      type={chosen === "date" ? "date" : "text"}
                      value={newValue}
                      onChange={(event) =>
                        updateForm({ value: event.target.value })
                      }
                    />
                  )}
                </div>
                <div className="inline-property-new-actions">
                  <button
                    type="submit"
                    aria-label={t("Добавить")}
                    title={t("Добавить свойство")}
                  >
                    <Check size={15} />
                  </button>
                  <button
                    type="button"
                    aria-label={t("Отмена")}
                    title={t("Отменить добавление")}
                    onClick={() => {
                      newPropertyDrafts.delete(formKey);
                      setForm(emptyPropertyDraft());
                      setAdding(false);
                      setError("");
                    }}
                  >
                    <X size={15} />
                  </button>
                </div>
              </div>
            </form>
          ) : (
            <button
              type="button"
              className="inline-property-add"
              onClick={startAdding}
            >
              <Plus size={14} />
              {t(" Добавить свойство ")}
            </button>
          ))}
        <button
          type="button"
          className="inline-property-source"
          onClick={onSource}
        >
          {t(" Открыть свойства в исходнике ")}
        </button>
        {catalogError && (
          <p className="inline-property-message">{catalogError}</p>
        )}
      </details>
      <datalist id={suggestionId}>
        {[
          ...new Set([
            ...Object.keys(catalog),
            ...Object.keys(settings?.types ?? {}),
          ]),
        ].map((key) => (
          <option key={key} value={key} />
        ))}
      </datalist>
      <datalist id={`${suggestionId}-value`}>
        {(catalog[name.trim()] ?? []).map((value) => (
          <option key={value} value={value} />
        ))}
      </datalist>
    </section>
  );
}
function PropertyList({
  name,
  value,
  suggestions,
  onChange,
  onHistory,
  onFocus,
  onBlur,
}: {
  name: string;
  value: string;
  suggestions: string[];
  onChange: (value: string) => void;
  onHistory: (
    event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => void;
  onFocus: () => void;
  onBlur: () => void;
}) {
  useLocale();
  const items = value ? value.split("\n") : [];
  const [entry, setEntry] = useState("");
  const id = useId();
  const add = () => {
    if (entry.trim()) {
      onChange([...items, entry.trim()].join("\n"));
      setEntry("");
    }
  };
  return (
    <div
      className="property-list"
      onFocus={onFocus}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) onBlur();
      }}
    >
      {items.map((item, index) => (
        <span className="property-chip" key={index}>
          <input
            aria-label={t`Элемент ${index + 1} свойства ${name}`}
            value={item}
            style={{ width: `${Math.max(3, Math.min(24, item.length + 1))}ch` }}
            onChange={(event) =>
              onChange(
                items
                  .map((value, at) =>
                    at === index ? event.target.value : value,
                  )
                  .join("\n"),
              )
            }
            onKeyDown={onHistory}
          />
          <button
            type="button"
            aria-label={t`Удалить элемент ${index + 1} свойства ${name}`}
            onClick={() =>
              onChange(items.filter((_, at) => at !== index).join("\n"))
            }
          >
            <X size={12} />
          </button>
        </span>
      ))}
      <input
        aria-label={t`Значение ${name}`}
        placeholder={t("Добавить значение\u2026")}
        list={id}
        value={entry}
        onChange={(event) => setEntry(event.target.value)}
        onBlur={add}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            add();
          } else onHistory(event);
        }}
        onPaste={(event) => {
          const text = event.clipboardData.getData("text/plain");
          if (/[\r\n]/.test(text)) {
            event.preventDefault();
            onChange(
              [...items, ...text.split(/\r?\n/).filter(Boolean)].join("\n"),
            );
            setEntry("");
          }
        }}
      />
      <datalist id={id}>
        {suggestions
          .filter((item) => !items.includes(item))
          .map((item) => (
            <option key={item} value={item} />
          ))}
      </datalist>
    </div>
  );
}
function PropertyRow({
  item,
  suggestions,
  names,
  onRenameType,
  assignedType,
  typeLocked,
  onType,
  draftKey,
  expected,
  onApply,
  onSource,
  onHistory,
}: {
  item: NoteProperty;
  suggestions: string[];
  names: string[];
  onRenameType: (name: string, type: PropertyType) => Promise<void>;
  assignedType?: PropertyType;
  typeLocked: boolean;
  onType: (key: string, type: PropertyType) => Promise<void>;
  draftKey: string;
  expected: string;
  onApply: PropertyApply;
  onSource: () => void;
  onHistory?: (redo: boolean) => void;
}) {
  useLocale();
  const displayType = item.type === "unsupported" ? assignedType : item.type;
  const valuesId = useId();
  const [nameDraft, setNameDraft] = useState(item.key);
  const value = Array.isArray(item.value)
    ? item.value.join("\n")
    : String(item.value);
  const pending = invalidDrafts.get(draftKey);
  const [draft, setDraft] = useState(pending?.text ?? value);
  const lastSent = useRef(value);
  const [focused, setFocused] = useState(false);
  const [error, setError] = useState(pending?.error ?? "");
  useEffect(() => {
    if (
      !invalidDrafts.has(draftKey) &&
      (!focused || value !== lastSent.current)
    )
      setDraft(value);
    lastSent.current = value;
  }, [value, focused, draftKey]);
  const update = (text: string, checked = false) => {
    setDraft(text);
    try {
      const next = propertyValue(
        item.key,
        item.type as PropertyType,
        text,
        checked,
      );
      lastSent.current = Array.isArray(next) ? next.join("\n") : String(next);
      onApply(
        { key: item.key, value: next, create: false },
        expected,
        (message) => {
          if (message) invalidDrafts.set(draftKey, { text, error: message });
          else invalidDrafts.delete(draftKey);
          setError(message ?? "");
        },
      );
    } catch (reason) {
      const message = t`${reason instanceof Error ? reason.message : t("Не удалось изменить свойство.")} Значение пока не применено.`;
      invalidDrafts.set(draftKey, { text, error: message });
      setError(message);
    }
  };
  const handleHistory = (
    event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => {
    if (
      !onHistory ||
      !(event.ctrlKey || event.metaKey) ||
      event.altKey ||
      !["z", "y"].includes(event.key.toLowerCase())
    )
      return;
    event.preventDefault();
    if (invalidDrafts.has(draftKey)) {
      invalidDrafts.delete(draftKey);
      setDraft(value);
      setError("");
      return;
    }
    onHistory(event.key.toLowerCase() === "y" || event.shiftKey);
  };
  return (
    <div className="inline-property-row" role="row">
      <span className="inline-property-name" role="rowheader" title={item.key}>
        {displayType && (
          <TypePicker
            type={displayType}
            label={t`Тип свойства ${item.key}`}
            locked={typeLocked}
            onSelect={async (nextType) => {
              try {
                if (item.type === "unsupported") {
                  await onType(item.key, nextType);
                  return;
                }
                if (
                  nextType === "checkbox" &&
                  !/^(true|false)$/i.test(draft.trim())
                )
                  throw new Error(t("Для флажка укажите true или false."));
                const value = propertyValue(
                  item.key,
                  nextType,
                  draft,
                  draft.trim().toLowerCase() === "true",
                );
                await onType(item.key, nextType);
                onApply(
                  { key: item.key, value, create: false },
                  expected,
                  (message) => setError(message ?? ""),
                );
              } catch (reason) {
                setError(
                  reason instanceof Error
                    ? reason.message
                    : t("Не удалось изменить тип."),
                );
              }
            }}
          />
        )}
        <input
          className="property-key-input"
          aria-label={t`Имя свойства ${item.key}`}
          value={nameDraft}
          onChange={(event) => setNameDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setNameDraft(item.key);
              event.currentTarget.blur();
            }
            if (event.key === "Enter") event.currentTarget.blur();
          }}
          onBlur={async () => {
            const name = nameDraft.trim();
            if (name === item.key) return;
            if (!name) {
              setNameDraft(item.key);
              return;
            }
            try {
              if (names.includes(name))
                throw new Error(t("Свойство с таким именем уже существует."));
              if (
                ["tags", "aliases", "cssclasses"].includes(name) &&
                item.type !== "list"
              )
                throw new Error(
                  t("Для этого имени требуется список значений."),
                );
              if (
                displayType &&
                !["tags", "aliases", "cssclasses"].includes(name)
              )
                await onRenameType(name, displayType);
              onApply({ key: item.key, rename: name }, expected, (message) => {
                setError(message ?? "");
                if (message) setNameDraft(item.key);
              });
            } catch (reason) {
              setError(
                reason instanceof Error
                  ? reason.message
                  : t("Не удалось переименовать свойство."),
              );
              setNameDraft(item.key);
            }
          }}
        />
      </span>
      <span className="inline-property-value" role="cell">
        {item.type === "unsupported" ? (
          <button
            type="button"
            className="inline-property-unsupported"
            onClick={onSource}
          >
            {String(item.value)}
          </button>
        ) : item.type === "checkbox" ? (
          <input
            type="checkbox"
            aria-label={t`Значение ${item.key}`}
            checked={item.value === true}
            onChange={(event) => update("", event.target.checked)}
          />
        ) : item.type === "list" ? (
          <PropertyList
            name={item.key}
            value={draft}
            suggestions={suggestions}
            onChange={update}
            onHistory={handleHistory}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
          />
        ) : (
          <input
            aria-label={t`Значение ${item.key}`}
            list={valuesId}
            value={draft}
            type={item.type === "date" ? "date" : "text"}
            inputMode={item.type === "number" ? "decimal" : undefined}
            onFocus={() => setFocused(true)}
            onKeyDown={handleHistory}
            onBlur={() => setFocused(false)}
            onChange={(event) => update(event.target.value)}
          />
        )}
        {error && (
          <span className="inline-property-error" role="alert">
            {t(error)}
          </span>
        )}
      </span>
      <datalist id={valuesId}>
        {suggestions.map((value) => (
          <option key={value} value={value} />
        ))}
      </datalist>
      <button
        type="button"
        className="inline-property-delete"
        aria-label={t`Удалить свойство ${item.key}`}
        title={t("Удалить свойство")}
        onClick={() =>
          onApply({ key: item.key, remove: true }, expected, (message) => {
            if (!message) invalidDrafts.delete(draftKey);
            setError(message ?? "");
          })
        }
      >
        <Trash2 size={14} />
      </button>
    </div>
  );
}
