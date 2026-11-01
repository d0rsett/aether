import { useState, type ReactNode } from "react";
import { Globe, Palette, TextCursorInput, Keyboard, X } from "lucide-react";
import { defaultTypography, type Typography } from "../workspace/typography";
import { platform } from "../services/platform";
import { t, useLocale, type Locale } from "../i18n";
import { DialogSurface } from "./DialogSurface";
import "../styles/settings.css";

interface Props {
  typography?: Typography;
  setTypography?: (value: Typography) => void;
  commands?: { title: string; shortcut: string }[];
  theme: string;
  setTheme: (value: string) => void;
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
            <Row
              label="Тема"
              description="Цветовая схема рабочего пространства."
            >
              <select
                value={props.theme}
                onChange={(event) => props.setTheme(event.target.value)}
              >
                <option value="dark">{t("Тёмная")}</option>
                <option value="light">{t("Светлая")}</option>
              </select>
            </Row>
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
