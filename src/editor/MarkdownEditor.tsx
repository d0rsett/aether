import { t, useLocale } from "../i18n";
import { editorPhrases } from "../i18n/editor";
import { useEffect, useRef } from "react";
import { toggleTask } from "./tasks";
import { noteFolding } from "./folding";
import { noteLinkHover } from "./linkHover";
import { insertTemplate } from "./templates";
import type { PropertyCommand } from "./properties";
import { applyProperty } from "./propertyInput";
import { propertyBodyStart } from "./properties";
import type { NotePreviews } from "../services/notePreviews";
import type { RenderNode } from "../services/api";
import { Compartment, EditorState, Text, Transaction } from "@codemirror/state";
import type { AnchorLocation } from "../services/api";
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  drawSelection,
  highlightSpecialChars,
  rectangularSelection,
} from "@codemirror/view";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
  undo,
  redo,
  undoDepth,
  redoDepth,
  selectAll,
} from "@codemirror/commands";
import { useContextMenu } from "../components/ContextMenu";
import { attachmentInput, pasteClipboard } from "./attachments";
import { markdown } from "@codemirror/lang-markdown";
import { Strikethrough, TaskList } from "@lezer/markdown";
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import {
  HighlightStyle,
  syntaxHighlighting,
  bracketMatching,
  indentOnInput,
  syntaxTree,
} from "@codemirror/language";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { tags } from "@lezer/highlight";
import {
  formatSelection,
  activeFormats,
  livePreview,
  linkCompletion,
  wikiSyntax,
  type FormatCommand,
} from "./enhancements";
const highlight = HighlightStyle.define([
  { tag: tags.heading, color: "var(--accent)", fontWeight: "600" },
  { tag: tags.strong, fontWeight: "700" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strikethrough, textDecoration: "line-through" },
  {
    tag: [tags.link, tags.url],
    color: "var(--accent)",
    textDecoration: "underline",
  },
  { tag: [tags.monospace, tags.string], color: "var(--accent)" },
  {
    tag: [tags.meta, tags.comment, tags.processingInstruction],
    color: "var(--subtle)",
  },
  { tag: [tags.keyword, tags.bool, tags.number], color: "var(--muted)" },
]);
interface Props {
  templateCommand?: {
    id: number;
    text: string;
  } | null;
  propertyCommand?: PropertyCommand | null;
  propertyHistory?: {
    id: number;
    redo: boolean;
  } | null;
  propertyFocus?: number;
  previews?: NotePreviews;
  onNavigate?: (source: string, target: string) => void;
  taskCommand?: {
    id: number;
    node: RenderNode;
    snapshot: string;
  } | null;
  content: string;
  onChange: (content: string) => void;
  onSave: () => void;
  onWikiLink?: (target: string) => void;
  navigation?:
    | (AnchorLocation & {
        id: number;
      })
    | null;
  ready?: boolean;
  live?: boolean;
  vaultId?: string;
  path?: string;
  command?: {
    id: number;
    type: FormatCommand;
  } | null;
  visible?: boolean;
  theme?: string;
  onError?: (message: string) => void;
  onFormatsChange?: (formats: FormatCommand[]) => void;
  onAttachmentsImported?: () => void;
  onPropertiesSource?: () => void;
  showLineNumbers?: boolean;
  lineWrapping?: boolean;
}
export function MarkdownEditor({
  templateCommand,
  propertyCommand,
  propertyHistory,
  propertyFocus,
  previews,
  onNavigate,
  taskCommand,
  content,
  onChange,
  onSave,
  onWikiLink,
  navigation,
  ready = true,
  live = false,
  vaultId,
  path,
  command,
  visible = true,
  theme = "dark",
  onError,
  showLineNumbers = false,
  lineWrapping = true,
  onFormatsChange,
  onAttachmentsImported,
  onPropertiesSource,
}: Props) {
  const locale = useLocale();
  const host = useRef<HTMLDivElement>(null);
  const lastTemplate = useRef<number | undefined>(undefined);
  const editor = useRef<EditorView | null>(null);
  const context = useContextMenu((message) =>
    callbacks.current.onError?.(message),
  );
  const callbacks = useRef({
    onNavigate,
    onAttachmentsImported,
    onPropertiesSource,
    onChange,
    onSave,
    onWikiLink,
    onError,
    onFormatsChange,
    visible,
  });
  callbacks.current = {
    onNavigate,
    onAttachmentsImported,
    onPropertiesSource,
    onChange,
    onSave,
    onWikiLink,
    onError,
    onFormatsChange,
    visible,
  };
  const initial = useRef(content);
  const lastText = useRef(content);
  const replacing = useRef(false);
  const lineSeparator = useRef(new Compartment());
  const lastNavigation = useRef<number | null>(null);
  const presentation = useRef(new Compartment());
  const gutter = useRef(new Compartment());
  const wrapping = useRef(new Compartment());
  const language = useRef(new Compartment());
  useEffect(() => {
    if (!host.current) return;
    const view = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: initial.current,
        selection: {
          anchor:
            live && !navigation ? (propertyBodyStart(initial.current) ?? 0) : 0,
        },
        extensions: [
          language.current.of(EditorState.phrases.of(editorPhrases(locale))),
          gutter.current.of(showLineNumbers ? lineNumbers() : []),
          history(),
          ...(vaultId && path
            ? [
                attachmentInput({
                  vaultId,
                  path,
                  onError: (message) => callbacks.current.onError?.(message),
                  onImported: () => callbacks.current.onAttachmentsImported?.(),
                }),
              ]
            : []),
          drawSelection(),
          highlightActiveLine(),
          highlightActiveLineGutter(),
          highlightSpecialChars(),
          rectangularSelection(),
          markdown({ extensions: [Strikethrough, TaskList] }),
          noteFolding,
          indentOnInput(),
          bracketMatching(),
          closeBrackets(),
          EditorState.languageData.of(() => [
            { closeBrackets: { brackets: ["(", "[", "{"] } },
          ]),
          keymap.of(closeBracketsKeymap),
          wikiSyntax,
          syntaxHighlighting(highlight),
          highlightSelectionMatches(),
          wrapping.current.of(lineWrapping ? EditorView.lineWrapping : []),
          presentation.current.of(live ? livePreview : []),
          ...(vaultId && path ? [linkCompletion(vaultId, path)] : []),
          ...(vaultId && path
            ? [
                noteLinkHover({
                  vaultId,
                  path,
                  previews,
                  onWiki: (target) => callbacks.current.onWikiLink?.(target),
                  onNavigate: (source, target) =>
                    callbacks.current.onNavigate?.(source, target),
                  onError: (message) => callbacks.current.onError?.(message),
                }),
              ]
            : []),
          EditorView.domEventHandlers({
            click(event, view) {
              if (
                !(event.ctrlKey || event.metaKey) ||
                !callbacks.current.onWikiLink
              )
                return false;
              const position = view.posAtCoords({
                x: event.clientX,
                y: event.clientY,
              });
              if (position === null) return false;
              let node: ReturnType<typeof syntaxTree>["topNode"] | null =
                syntaxTree(view.state).resolveInner(position, -1);
              while (node) {
                if (/Code/.test(node.name)) return false;
                node = node.parent;
              }
              const line = view.state.doc.lineAt(position);
              for (const match of line.text.matchAll(/!?\[\[([^\]\n]+)\]\]/g)) {
                const from = line.from + (match.index ?? 0);
                if (position >= from && position <= from + match[0].length) {
                  event.preventDefault();
                  callbacks.current.onWikiLink(match[1].split("|")[0]);
                  return true;
                }
              }
              return false;
            },
          }),
          lineSeparator.current.of(
            EditorState.lineSeparator.of(
              initial.current.includes("\r\n") ? "\r\n" : "\n",
            ),
          ),
          EditorView.contentAttributes.of({
            "aria-label": t("Markdown-редактор"),
            spellcheck: "false",
          }),
          keymap.of([
            {
              key: "Mod-b",
              run: (view) => {
                formatSelection(view, "bold");
                return true;
              },
            },
            {
              key: "Mod-i",
              run: (view) => {
                formatSelection(view, "italic");
                return true;
              },
            },
            {
              key: "Mod-s",
              run: () => {
                callbacks.current.onSave();
                return true;
              },
            },
            ...defaultKeymap,
            ...historyKeymap,
            ...searchKeymap,
            indentWithTab,
          ]),
          EditorView.updateListener.of((update) => {
            if (
              (update.docChanged || update.selectionSet) &&
              callbacks.current.visible
            )
              callbacks.current.onFormatsChange?.(activeFormats(update.state));
            if (update.docChanged && !replacing.current) {
              const text = update.state.sliceDoc();
              lastText.current = text;
              callbacks.current.onChange(text);
            }
          }),
        ],
      }),
    });
    editor.current = view;
    if (callbacks.current.visible)
      callbacks.current.onFormatsChange?.(activeFormats(view.state));
    view.focus();
    return () => {
      view.destroy();
      editor.current = null;
    };
  }, []);
  useEffect(() => {
    const view = editor.current;
    if (view && lastText.current !== content) {
      replacing.current = true;
      try {
        view.dispatch({
          changes: {
            from: 0,
            to: view.state.doc.length,
            insert: Text.of(content.split(/\r\n|\n/)),
          },
          effects: lineSeparator.current.reconfigure(
            EditorState.lineSeparator.of(
              content.includes("\r\n") ? "\r\n" : "\n",
            ),
          ),
        });
        lastText.current = content;
      } finally {
        replacing.current = false;
      }
    }
  }, [content]);
  useEffect(() => {
    const view = editor.current;
    if (
      !view ||
      !navigation ||
      !ready ||
      lastNavigation.current === navigation.id
    )
      return;
    lastNavigation.current = navigation.id;
    const from = Math.min(navigation.from, view.state.doc.length);
    view.dispatch({
      selection: { anchor: from },
      effects: EditorView.scrollIntoView(from, { y: "center" }),
      annotations: Transaction.addToHistory.of(false),
    });
    view.focus();
  }, [navigation?.id, ready]);
  useEffect(() => {
    let disposed = false;
    editor.current?.dispatch({
      effects: presentation.current.reconfigure(live ? livePreview : []),
    });
    if (live && visible && vaultId && path) {
      void Promise.all([import("./liveBlocks"), import("./propertyBlock")])
        .then(([{ richPreview }, { propertyBlock }]) => {
          if (disposed || !editor.current) return;
          editor.current.dispatch({
            effects: presentation.current.reconfigure([
              livePreview,
              propertyBlock({
                vaultId,
                path,
                onSource: () => callbacks.current.onPropertiesSource?.(),
              }),
              richPreview({
                previews,
                onNavigate: (source, target) =>
                  callbacks.current.onNavigate?.(source, target),
                vaultId,
                path,
                theme,
                onWiki: (target) => callbacks.current.onWikiLink?.(target),
                onError: (message) => callbacks.current.onError?.(message),
              }),
            ]),
          });
        })
        .catch(() => {
          if (!disposed)
            callbacks.current.onError?.(
              t(
                "Не удалось загрузить визуальные блоки. Исходный Markdown доступен.",
              ),
            );
        });
    }
    return () => {
      disposed = true;
    };
  }, [live, visible, vaultId, path, theme, previews]);
  useEffect(() => {
    if (editor.current && command)
      formatSelection(editor.current, command.type);
  }, [command?.id]);
  useEffect(() => {
    if (
      !templateCommand ||
      !editor.current ||
      lastTemplate.current === templateCommand.id
    )
      return;
    lastTemplate.current = templateCommand.id;
    try {
      insertTemplate(editor.current, templateCommand.text);
    } catch (error) {
      callbacks.current.onError?.(
        error instanceof Error
          ? error.message
          : t("Не удалось вставить шаблон."),
      );
    }
  }, [templateCommand?.id]);
  useEffect(() => {
    if (
      editor.current &&
      taskCommand &&
      !toggleTask(editor.current, taskCommand.node, taskCommand.snapshot)
    )
      callbacks.current.onError?.(
        t(
          "Текст изменился. Переключите задачу ещё раз после обновления просмотра.",
        ),
      );
  }, [taskCommand?.id]);
  useEffect(() => {
    if (!propertyCommand || !editor.current) return;
    try {
      applyProperty(
        editor.current,
        propertyCommand.action,
        propertyCommand.expected,
      );
      propertyCommand.done();
    } catch (error) {
      propertyCommand.done(
        error instanceof Error
          ? error.message
          : t("Не удалось изменить свойство."),
      );
    }
  }, [propertyCommand?.id]);
  useEffect(() => {
    if (editor.current && propertyHistory)
      (propertyHistory.redo ? redo : undo)(editor.current);
  }, [propertyHistory?.id]);
  useEffect(() => {
    const view = editor.current;
    if (!view || propertyFocus === undefined) return;
    view.dispatch({
      selection: { anchor: 0 },
      effects: EditorView.scrollIntoView(0, { y: "start" }),
    });
    view.focus();
  }, [propertyFocus]);
  useEffect(() => {
    editor.current?.dispatch({
      effects: gutter.current.reconfigure(showLineNumbers ? lineNumbers() : []),
    });
  }, [showLineNumbers]);
  useEffect(() => {
    const view = editor.current;
    if (!view) return;
    view.dispatch({
      effects: language.current.reconfigure(
        EditorState.phrases.of(editorPhrases(locale)),
      ),
    });
    view.contentDOM.setAttribute("aria-label", t("Markdown-редактор"));
    for (const marker of view.dom.querySelectorAll<HTMLElement>(".fold-toggle"))
      marker.title = t(
        marker.dataset.foldState === "open"
          ? "Свернуть раздел"
          : "Развернуть раздел",
      );
    for (const placeholder of view.dom.querySelectorAll<HTMLElement>(
      ".cm-foldPlaceholder",
    )) {
      placeholder.title = t("Развернуть раздел");
      placeholder.setAttribute("aria-label", t("Свёрнутый текст"));
    }
  }, [locale]);
  useEffect(() => {
    editor.current?.dispatch({
      effects: wrapping.current.reconfigure(
        lineWrapping ? EditorView.lineWrapping : [],
      ),
    });
  }, [lineWrapping]);
  useEffect(() => {
    if (visible && editor.current)
      callbacks.current.onFormatsChange?.(activeFormats(editor.current.state));
  }, [visible]);
  return (
    <>
      <div
        className={`editor-host ${live ? "is-live" : ""}`}
        ref={host}
        onContextMenu={(event) => {
          const view = editor.current;
          if (!view) return;
          const point = view.posAtCoords({
            x: event.clientX,
            y: event.clientY,
          });
          const selection = view.state.selection.main;
          if (
            point !== null &&
            (selection.empty || point < selection.from || point > selection.to)
          )
            view.dispatch({ selection: { anchor: point } });
          const selected = view.state.selection.main;
          const snapshot = view.state.doc;
          const copiedText = view.state.sliceDoc(selected.from, selected.to);
          const copy = () => navigator.clipboard.writeText(copiedText);
          const ensureCurrent = () => {
            if (editor.current !== view || view.state.readOnly)
              throw new Error(t("Редактор недоступен для изменения."));
            if (view.state.doc !== snapshot)
              throw new Error(t("Текст изменился. Откройте меню ещё раз."));
          };
          const formats = activeFormats(view.state);
          const formatting = selected.empty
            ? []
            : (
                [
                  ["bold", t("Жирный"), "Ctrl B"],
                  ["italic", t("Курсив"), "Ctrl I"],
                  ["code", t("Код"), ""],
                  ["heading", t("Заголовок"), ""],
                  ["quote", t("Цитата"), ""],
                  ["list", t("Список"), ""],
                  ["link", t("Wiki-ссылка"), ""],
                ] as const
              ).map(([type, label, shortcut], index) => ({
                label,
                shortcut,
                heading: index === 0 ? t("Форматирование") : undefined,
                divider: index === 0,
                checked: formats.includes(type),
                disabled: view.state.readOnly,
                run: () => {
                  ensureCurrent();
                  view.dispatch({
                    selection: { anchor: selected.anchor, head: selected.head },
                  });
                  formatSelection(view, type);
                },
              }));
          context.show(event, t("Действия редактора"), [
            {
              label: t("Вставить таблицу"),
              disabled: view.state.readOnly,
              run: () => {
                ensureCurrent();
                formatSelection(view, "table");
              },
            },
            {
              label: t("Отменить"),
              shortcut: "Ctrl Z",
              disabled: undoDepth(view.state) === 0 || view.state.readOnly,
              run: () => {
                ensureCurrent();
                undo(view);
              },
            },
            {
              label: t("Повторить"),
              shortcut: "Ctrl Y",
              disabled: redoDepth(view.state) === 0 || view.state.readOnly,
              run: () => {
                ensureCurrent();
                redo(view);
              },
            },
            {
              label: t("Вырезать"),
              shortcut: "Ctrl X",
              divider: true,
              disabled: selected.empty || view.state.readOnly,
              run: async () => {
                ensureCurrent();
                await copy();
                ensureCurrent();
                view.dispatch({
                  changes: { from: selected.from, to: selected.to },
                  selection: { anchor: selected.from },
                  userEvent: "delete.cut",
                });
              },
            },
            {
              label: t("Копировать"),
              shortcut: "Ctrl C",
              disabled: selected.empty,
              run: copy,
            },
            {
              label: t("Вставить"),
              shortcut: "Ctrl V",
              disabled: view.state.readOnly,
              run: async () => {
                ensureCurrent();
                if (await pasteClipboard(view)) return;
                const text = await navigator.clipboard.readText();
                ensureCurrent();
                view.dispatch({
                  changes: {
                    from: selected.from,
                    to: selected.to,
                    insert: text.replace(/\r\n?/g, "\n"),
                  },
                  selection: {
                    anchor: selected.from + text.replace(/\r\n?/g, "\n").length,
                  },
                  userEvent: "input.paste",
                });
              },
            },
            ...formatting,
            {
              label: t("Выделить всё"),
              shortcut: "Ctrl A",
              divider: true,
              run: () => {
                selectAll(view);
              },
            },
            {
              label: t("Сохранить заметку"),
              shortcut: "Ctrl S",
              divider: true,
              disabled: view.state.readOnly,
              run: () => callbacks.current.onSave(),
            },
          ]);
        }}
      />
      {context.menu}
    </>
  );
}
