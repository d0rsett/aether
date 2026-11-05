import { useRef, useState, type ReactNode } from "react";
import {
  Check,
  Globe,
  Palette,
  TextCursorInput,
  Keyboard,
  Paperclip,
  X,
} from "lucide-react";
import { defaultTypography, type Typography } from "../workspace/typography";
import {
  palettePresets,
  type Density,
  type ThemePreference,
} from "../workspace/theme";
import { platform } from "../services/platform";
import type { Preferences } from "../workspace/preferences";
import {
  binding,
  conflictingShortcut,
  shortcutCommands,
  shortcutFromEvent,
  shortcutIds,
  shortcutLabel,
  type ShortcutCommand,
  type Shortcuts,
} from "../workspace/shortcuts";
import { t, useLocale, type Locale } from "../i18n";
import { DialogSurface } from "./DialogSurface";
import "../styles/settings.css";

const themeOptions = [
  { value: "light", label: "Светлая", previews: ["light"] },
  { value: "dark", label: "Тёмная", previews: ["dark"] },
  { value: "system", label: "Как в системе", previews: ["light", "dark"] },
] as const;

interface Props {
  shortcuts?: Shortcuts;
  onShortcuts?: (shortcuts: Shortcuts) => void;
  preferences?: Preferences;
  onPreferences?: (preferences: Preferences) => void;
  startupNote?: string;
  activeNote?: string;
  setStartupNote?: (path: string) => void;
  dividerWidth?: number;
  setDividerWidth?: (width: number) => void;
  density?: Density;
  setDensity?: (density: Density) => void;
  palette?: string | null;
  setPaletteColor?: (color: string | null) => void;
  typography?: Typography;
  setTypography?: (value: Typography) => void;
  commands?: { title: string; shortcut: string }[];
  theme: ThemePreference;
  setTheme: (value: ThemePreference) => void;
  locale: Locale;
  setLanguage: (value: Locale) => void;
  formatting: boolean;
  setFormatting: (value: boolean) => void;
  lineNumbers: boolean;
  setLineNumbers: (value: boolean) => void;
  lineWrapping: boolean;
  setLineWrapping: (value: boolean) => void;
  onClose: () => void;
}
function PreferenceSelect<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: readonly (readonly [T, string])[];
  onChange: (value: T) => void;
}) {
  return (
    <select
      value={value}
      onChange={(event) => {
        const option = options.find(([key]) => key === event.target.value);
        if (option) onChange(option[0]);
      }}
    >
      {options.map(([key, label]) => (
        <option key={key} value={key}>
          {t(label)}
        </option>
      ))}
    </select>
  );
}
function Row({
  label,
  description,
  children,
}: {
  label: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <label className="settings-row">
      <span>
        <span className="settings-label">{t(label)}</span>
        <span className="settings-description">{t(description)}</span>
      </span>
      {children}
    </label>
  );
}
export function SettingsDialog(props: Props) {
  useLocale();
  const [query, setQuery] = useState("");
  const [recording, setRecording] = useState<ShortcutCommand | null>(null);
  const recordingButton = useRef<HTMLButtonElement>(null);
  const [shortcutError, setShortcutError] = useState<{
    id: ShortcutCommand;
    message: string;
  } | null>(null);
  const typography = props.typography ?? defaultTypography;
  const shortcut = (value: string) =>
    platform.macOS ? value.replaceAll("Ctrl", "⌘") : value;
  const editable = props.shortcuts && props.onShortcuts;
  const commands: { title: string; shortcut: string; id?: ShortcutCommand }[] =
    [
      ...(editable
        ? shortcutIds.map((id) => ({
            id,
            title: t(shortcutCommands[id][0]),
            shortcut: shortcutLabel(binding(props.shortcuts ?? {}, id)),
          }))
        : []),
      ...(props.commands ?? []),
      { title: t("Палитра команд"), shortcut: "Ctrl P" },
      { title: t("Закрыть вкладку"), shortcut: "Ctrl W" },
      { title: t("Переключить левую панель"), shortcut: "Ctrl \\" },
      { title: t("Жирный"), shortcut: "Ctrl B" },
      { title: t("Курсив"), shortcut: "Ctrl I" },
      { title: t("Поиск в заметке"), shortcut: "Ctrl F" },
      { title: t("Отменить"), shortcut: "Ctrl Z" },
      {
        title: t("Повторить"),
        shortcut: platform.macOS ? "⌘ Shift Z" : "Ctrl Y",
      },
    ]
      .filter(
        (item) =>
          !editable ||
          "id" in item ||
          !shortcutIds.some(
            (id) =>
              t(shortcutCommands[id][0]) === item.title ||
              shortcutLabel(shortcutCommands[id][1]) ===
                shortcut(item.shortcut),
          ),
      )
      .filter((item) =>
        (item.title + " " + item.shortcut + " " + shortcut(item.shortcut))
          .toLocaleLowerCase()
          .includes(query.trim().toLocaleLowerCase()),
      );
  const assign = (id: ShortcutCommand, value: string, reset = false) => {
    const shortcuts = props.shortcuts ?? {};
    const conflict = conflictingShortcut(shortcuts, id, value);
    if (conflict) {
      setShortcutError({ id, message: t`Конфликт сочетания: ${t(conflict)}` });
      return;
    }
    const next = { ...shortcuts };
    if (reset) delete next[id];
    else next[id] = value;
    props.onShortcuts?.(next);
    setRecording(null);
    setShortcutError(null);
  };
  const cancelRecording = () => {
    setRecording(null);
    setShortcutError(null);
  };
  const [section, setSection] = useState("general");
  const preferences = props.preferences;
  const sections = [
    { id: "general", label: "Общие", icon: Globe },
    { id: "appearance", label: "Оформление", icon: Palette },
    { id: "editor", label: "Редактор", icon: TextCursorInput },
    ...(preferences
      ? [
          { id: "workspace", label: "Рабочее пространство", icon: Globe },
          { id: "attachments", label: "Вложения", icon: Paperclip },
        ]
      : []),
    { id: "shortcuts", label: "Горячие клавиши", icon: Keyboard },
  ];
  return (
    <DialogSurface
      label={t("Настройки")}
      className="settings-window"
      onClose={props.onClose}
    >
      <button
        className="icon-button settings-close"
        type="button"
        aria-label={t("Закрыть диалог")}
        onClick={props.onClose}
      >
        <X size={19} />
      </button>
      <div className="settings-layout">
        <nav className="settings-nav" aria-label={t("Разделы настроек")}>
          <div className="settings-nav-title">{t("Настройки")}</div>
          {sections.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              aria-current={section === id ? "page" : undefined}
              onClick={() => {
                cancelRecording();
                setSection(id);
              }}
            >
              <Icon size={17} />
              {t(label)}
            </button>
          ))}
        </nav>
        <section
          className="settings-content"
          aria-labelledby="settings-section-title"
        >
          <h3 id="settings-section-title">
            {t(sections.find((item) => item.id === section)?.label ?? "Общие")}
          </h3>
          {section === "general" && (
            <Row
              label="Язык интерфейса"
              description="Язык меню, команд и диалогов приложения."
            >
              <select
                value={props.locale}
                onChange={(event) =>
                  props.setLanguage(event.target.value === "en" ? "en" : "ru")
                }
              >
                <option value="ru">Русский</option>
                <option value="en">English</option>
              </select>
            </Row>
          )}
          {section === "appearance" && (
            <>
              <fieldset className="theme-picker">
                <legend className="settings-label">{t("Тема")}</legend>
                <p className="settings-description">
                  {t("Цветовая схема рабочего пространства.")}
                </p>
                <div className="theme-options">
                  {themeOptions.map(({ value, label, previews }) => (
                    <label className="theme-option" key={value}>
                      <input
                        type="radio"
                        name="appearance-theme"
                        value={value}
                        checked={props.theme === value}
                        onChange={() => props.setTheme(value)}
                      />
                      <span className="theme-card">
                        <span className="theme-preview" aria-hidden="true">
                          {previews.map((preview) => (
                            <span
                              className="theme-preview-pane"
                              data-preview={preview}
                              key={preview}
                            >
                              <span className="theme-preview-sidebar" />
                              <span className="theme-preview-note">
                                <span />
                                <span />
                                <span />
                              </span>
                            </span>
                          ))}
                        </span>
                        <span className="theme-card-label">
                          {t(label)}
                          <Check size={15} aria-hidden="true" />
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <div className="palette-settings appearance-section">
                <fieldset className="theme-picker">
                  <legend className="settings-label">
                    {t("Цветовая гамма")}
                  </legend>
                  <div className="palette-presets">
                    {palettePresets.map(({ name, color }) => (
                      <label className="palette-preset" key={color}>
                        <input
                          type="radio"
                          name="palette-preset"
                          checked={props.palette === color}
                          onChange={() => props.setPaletteColor?.(color)}
                        />
                        <span className="palette-preset-card">
                          <span
                            className="palette-sample"
                            style={
                              {
                                "--palette-color": color,
                              } as React.CSSProperties
                            }
                            aria-hidden="true"
                          >
                            <span />
                            <span />
                            <span />
                          </span>
                          <span>{t(name)}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </fieldset>
                <Row
                  label="Основной цвет"
                  description="Оттенки интерфейса рассчитываются автоматически."
                >
                  <input
                    type="color"
                    value={props.palette ?? "#7c9b80"}
                    onChange={(event) =>
                      props.setPaletteColor?.(event.target.value)
                    }
                  />
                </Row>
                <button
                  className="settings-reset"
                  type="button"
                  disabled={!props.palette}
                  onClick={() => props.setPaletteColor?.(null)}
                >
                  {t("Вернуть стандартную гамму")}
                </button>
              </div>
              <fieldset className="theme-picker density-picker appearance-section">
                <legend className="settings-label">
                  {t("Плотность интерфейса")}
                </legend>
                <div className="theme-options">
                  {(
                    [
                      { value: "compact", label: "Компактный" },
                      { value: "comfortable", label: "Свободный" },
                    ] as const
                  ).map(({ value, label }) => (
                    <label className="theme-option" key={value}>
                      <input
                        type="radio"
                        name="interface-density"
                        checked={(props.density ?? "comfortable") === value}
                        onChange={() => props.setDensity?.(value)}
                      />
                      <span className="theme-card">
                        <span
                          className={`density-preview ${value}`}
                          aria-hidden="true"
                        >
                          <span />
                          <span />
                          <span />
                        </span>
                        <span className="theme-card-label">
                          {t(label)}
                          <Check size={15} aria-hidden="true" />
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <Row
                label="Толщина разделителей"
                description="Линии между панелями и разделами рабочего пространства."
              >
                <span className="settings-range">
                  <input
                    type="range"
                    min={1}
                    max={3}
                    step={1}
                    value={props.dividerWidth ?? 1}
                    aria-label={t("Толщина разделителей")}
                    onChange={(event) =>
                      props.setDividerWidth?.(Number(event.target.value))
                    }
                  />
                  <output>{props.dividerWidth ?? 1} px</output>
                </span>
              </Row>
            </>
          )}
          {section === "workspace" && preferences && (
            <>
              <Row
                label="При запуске"
                description="Что показывать после восстановления вкладок."
              >
                <PreferenceSelect
                  value={preferences.startup}
                  options={[
                    ["last", "Последняя заметка"],
                    ["note", "Выбранная заметка"],
                    ["recent", "Недавние файлы"],
                  ]}
                  onChange={(startup) =>
                    props.onPreferences?.({ ...preferences, startup })
                  }
                />
              </Row>
              {preferences.startup === "note" && (
                <>
                  <Row
                    label="Стартовая заметка"
                    description="Путь к Markdown-файлу от корня текущего хранилища."
                  >
                    <input
                      type="text"
                      value={props.startupNote ?? ""}
                      disabled={!props.setStartupNote}
                      onChange={(event) =>
                        props.setStartupNote?.(event.target.value)
                      }
                      placeholder="Projects/Start.md"
                    />
                  </Row>
                  {props.activeNote && (
                    <button
                      className="settings-reset"
                      type="button"
                      onClick={() =>
                        props.setStartupNote?.(props.activeNote ?? "")
                      }
                    >
                      {t("Использовать открытую заметку")}
                    </button>
                  )}
                </>
              )}
              <Row
                label="Открывать ссылки"
                description="Вкладка с несохранённым текстом сохраняется."
              >
                <PreferenceSelect
                  value={preferences.links}
                  options={[
                    ["new", "В новой вкладке"],
                    ["current", "В текущей вкладке"],
                  ]}
                  onChange={(links) =>
                    props.onPreferences?.({ ...preferences, links })
                  }
                />
              </Row>
              <Row
                label="Список вкладок"
                description="Показывать кнопку списка, когда вкладки не помещаются."
              >
                <input
                  type="checkbox"
                  role="switch"
                  checked={preferences.tabList}
                  onChange={(event) =>
                    props.onPreferences?.({
                      ...preferences,
                      tabList: event.target.checked,
                    })
                  }
                />
              </Row>
            </>
          )}
          {section === "attachments" && preferences && (
            <>
              <Row
                label="Папка вложений"
                description="Куда сохранять новые файлы."
              >
                <PreferenceSelect
                  value={
                    preferences.attachmentFolder === undefined
                      ? "default"
                      : preferences.attachmentFolder === null
                        ? "vault"
                        : "custom"
                  }
                  options={[
                    ["default", "По умолчанию"],
                    ["vault", "Использовать настройки хранилища"],
                    ["custom", "Своя папка"],
                  ]}
                  onChange={(folder) =>
                    props.onPreferences?.({
                      ...preferences,
                      attachmentFolder:
                        folder === "custom"
                          ? "Attachments"
                          : folder === "vault"
                            ? null
                            : undefined,
                    })
                  }
                />
              </Row>
              {typeof preferences.attachmentFolder === "string" && (
                <Row
                  label="Путь папки вложений"
                  description="Путь от корня хранилища. Пустое поле означает корень."
                >
                  <input
                    type="text"
                    value={preferences.attachmentFolder}
                    onChange={(event) =>
                      props.onPreferences?.({
                        ...preferences,
                        attachmentFolder: event.target.value,
                      })
                    }
                  />
                </Row>
              )}
              <Row
                label="Формат ссылки на вложение"
                description="Формат вставки новых и существующих вложений."
              >
                <PreferenceSelect
                  value={preferences.attachmentFormat}
                  options={[
                    ["vault", "Использовать настройки хранилища"],
                    ["wiki", "Wiki-ссылка"],
                    ["markdown", "Markdown-ссылка"],
                  ]}
                  onChange={(attachmentFormat) =>
                    props.onPreferences?.({ ...preferences, attachmentFormat })
                  }
                />
              </Row>
            </>
          )}
          {section === "editor" && (
            <>
              {preferences && (
                <Row
                  label="Режим открытия заметок"
                  description="Режим для вновь открываемых заметок."
                >
                  <PreferenceSelect
                    value={preferences.mode}
                    options={[
                      ["live", "Live Preview"],
                      ["source", "Исходник"],
                      ["reading", "Режим чтения"],
                    ]}
                    onChange={(mode) =>
                      props.onPreferences?.({ ...preferences, mode })
                    }
                  />
                </Row>
              )}
              {(
                [
                  {
                    key: "fontSize",
                    label: "Размер шрифта",
                    description: "Размер текста заметок в пикселях.",
                    min: 12,
                    max: 24,
                    step: 1,
                  },
                  {
                    key: "lineHeight",
                    label: "Межстрочный интервал",
                    description: "Расстояние между строками текста.",
                    min: 1.2,
                    max: 2.4,
                    step: 0.05,
                  },
                  {
                    key: "textWidth",
                    label: "Ширина текста",
                    description:
                      "Максимальная ширина текста заметки в пикселях.",
                    min: 480,
                    max: 1100,
                    step: 1,
                  },
                ] as const
              ).map((item) => (
                <Row
                  key={item.key}
                  label={item.label}
                  description={item.description}
                >
                  <span className="settings-range">
                    <input
                      type="range"
                      min={item.min}
                      max={item.max}
                      step={item.step}
                      value={typography[item.key]}
                      aria-label={t(item.label)}
                      onChange={(event) =>
                        props.setTypography?.({
                          ...typography,
                          [item.key]: Number(event.target.value),
                        })
                      }
                    />
                    <output>{Number(typography[item.key].toFixed(2))}</output>
                  </span>
                </Row>
              ))}
              <div
                className="settings-text-preview"
                style={{
                  fontSize: typography.fontSize,
                  lineHeight: typography.lineHeight,
                }}
                aria-label={t("Пример текста")}
              >
                {t(
                  "Хорошая заметка начинается с одной мысли. Запишите её, добавьте детали и свяжите с тем, что уже знаете.",
                )}
              </div>
              <button
                className="settings-reset"
                type="button"
                onClick={() => props.setTypography?.({ ...defaultTypography })}
              >
                {t("Сбросить параметры текста")}
              </button>
              <Row
                label="Номера строк"
                description="Показывать номера строк рядом с текстом."
              >
                <input
                  type="checkbox"
                  role="switch"
                  checked={props.lineNumbers}
                  onChange={(event) =>
                    props.setLineNumbers(event.target.checked)
                  }
                />
              </Row>
              <Row
                label="Перенос строк"
                description="Переносить длинные строки по ширине редактора."
              >
                <input
                  type="checkbox"
                  role="switch"
                  checked={props.lineWrapping}
                  onChange={(event) =>
                    props.setLineWrapping(event.target.checked)
                  }
                />
              </Row>
              <Row
                label="Панель форматирования"
                description="Показывать инструменты форматирования над заметкой."
              >
                <input
                  type="checkbox"
                  role="switch"
                  checked={props.formatting}
                  onChange={(event) =>
                    props.setFormatting(event.target.checked)
                  }
                />
              </Row>
            </>
          )}
          {section === "shortcuts" ? (
            <>
              <div className="settings-shortcut-tools">
                <input
                  className="settings-command-search"
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  aria-label={t("Поиск команд")}
                  placeholder={t("Поиск команд")}
                />
                {editable && (
                  <button
                    type="button"
                    className="button secondary"
                    disabled={!Object.keys(props.shortcuts ?? {}).length}
                    onClick={() => {
                      props.onShortcuts?.({});
                      cancelRecording();
                    }}
                  >
                    {t("Вернуть все сочетания по умолчанию")}
                  </button>
                )}
              </div>
              <div className="settings-commands">
                {commands.map((item, index) => {
                  const id = item.id;
                  return (
                    <div className="settings-command" key={item.title + index}>
                      <span>{item.title}</span>
                      {id ? (
                        <div className="shortcut-actions">
                          <button
                            ref={recording === id ? recordingButton : undefined}
                            type="button"
                            className="button secondary"
                            aria-label={t`Изменить сочетание: ${item.title}`}
                            onClick={() => {
                              setRecording(recording === id ? null : id);
                              setShortcutError(null);
                            }}
                            onKeyDown={(event) => {
                              if (recording !== id) return;
                              if (event.key === "Tab") return;
                              if (event.key === "Escape") {
                                event.preventDefault();
                                event.stopPropagation();
                                cancelRecording();
                                return;
                              }
                              if (
                                [
                                  "Control",
                                  "Meta",
                                  "Shift",
                                  "Alt",
                                  "Enter",
                                  " ",
                                ].includes(event.key)
                              )
                                return;
                              event.preventDefault();
                              event.stopPropagation();
                              const value = shortcutFromEvent(event);
                              if (value) assign(recording, value);
                              else
                                setShortcutError({
                                  id,
                                  message: t(
                                    "Нажмите Ctrl или Cmd вместе с клавишей.",
                                  ),
                                });
                            }}
                          >
                            {recording === id
                              ? t("Нажмите сочетание")
                              : item.shortcut}
                          </button>
                          {recording === id && (
                            <button
                              type="button"
                              className="icon-button"
                              aria-label={t("Отменить запись сочетания")}
                              onClick={() => {
                                recordingButton.current?.focus();
                                cancelRecording();
                              }}
                            >
                              <X size={14} />
                            </button>
                          )}
                          {recording !== id && props.shortcuts?.[id] && (
                            <button
                              type="button"
                              className="button secondary"
                              onClick={() =>
                                assign(id, shortcutCommands[id][1], true)
                              }
                              aria-label={t`Сбросить сочетание: ${item.title}`}
                            >
                              {t("Сбросить")}
                            </button>
                          )}
                          {shortcutError?.id === id && (
                            <p className="tree-error" role="alert">
                              {shortcutError.message}
                            </p>
                          )}
                        </div>
                      ) : item.shortcut ? (
                        <kbd>{shortcut(item.shortcut)}</kbd>
                      ) : (
                        <span className="settings-unassigned">
                          {t("Не назначено")}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
              {!commands.length && (
                <p className="settings-hint">{t("Команды не найдены")}</p>
              )}
              <p className="settings-hint">
                {t(
                  editable
                    ? "Выберите сочетание, чтобы изменить его. Команды редактора без кнопки доступны для справки."
                    : "Сочетания показаны для справки. Редактирование пока недоступно.",
                )}
              </p>
            </>
          ) : (
            <p className="settings-hint">{t("Изменения применяются сразу.")}</p>
          )}
        </section>
      </div>
    </DialogSurface>
  );
}
