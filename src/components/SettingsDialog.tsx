import { useState, type ReactNode } from "react";
import {
  Check,
  Globe,
  Palette,
  TextCursorInput,
  Keyboard,
  X,
} from "lucide-react";
import { defaultTypography, type Typography } from "../workspace/typography";
import type { ThemePreference } from "../workspace/theme";
import { platform } from "../services/platform";
import { t, useLocale, type Locale } from "../i18n";
import { DialogSurface } from "./DialogSurface";
import "../styles/settings.css";

const themeOptions = [
  { value: "light", label: "Светлая", previews: ["light"] },
  { value: "dark", label: "Тёмная", previews: ["dark"] },
  { value: "system", label: "Как в системе", previews: ["light", "dark"] },
] as const;

interface Props {
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
  const typography = props.typography ?? defaultTypography;
  const shortcut = (value: string) =>
    platform.macOS ? value.replaceAll("Ctrl", "⌘") : value;
  const commands = [
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
  ].filter((item) =>
    (item.title + " " + item.shortcut + " " + shortcut(item.shortcut))
      .toLocaleLowerCase()
      .includes(query.trim().toLocaleLowerCase()),
  );
  const [section, setSection] = useState("general");
  const sections = [
    { id: "general", label: "Общие", icon: Globe },
    { id: "appearance", label: "Оформление", icon: Palette },
    { id: "editor", label: "Редактор", icon: TextCursorInput },
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
              onClick={() => setSection(id)}
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
              <div className="palette-settings">
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
            </>
          )}
          {section === "editor" && (
            <>
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
              <input
                className="settings-command-search"
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                aria-label={t("Поиск команд")}
                placeholder={t("Поиск команд")}
              />
              <div className="settings-commands">
                {commands.map((item, index) => (
                  <div className="settings-command" key={item.title + index}>
                    <span>{item.title}</span>
                    {item.shortcut ? (
                      <kbd>{shortcut(item.shortcut)}</kbd>
                    ) : (
                      <span className="settings-unassigned">
                        {t("Не назначено")}
                      </span>
                    )}
                  </div>
                ))}
              </div>
              {!commands.length && (
                <p className="settings-hint">{t("Команды не найдены")}</p>
              )}
              <p className="settings-hint">
                {t(
                  "Сочетания показаны для справки. Редактирование пока недоступно.",
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
