import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { EditorView } from "@codemirror/view";
import { undo } from "@codemirror/commands";
import { MarkdownEditor } from "../src/editor/MarkdownEditor";
import {
  formatSelection,
  activeFormats,
  applyWikiCompletion,
} from "../src/editor/enhancements";
import {
  insertBracket,
  deleteBracketPair,
  startCompletion,
  acceptCompletion,
  currentCompletions,
} from "@codemirror/autocomplete";
import { toggleTask } from "../src/editor/tasks";
import { api } from "../src/services/api";
import { readProperties } from "../src/editor/properties";
import { applyProperty } from "../src/editor/propertyInput";

afterEach(cleanup);
it("keeps repeated footnote widgets visible alongside Markdown link decorations", async () => {
  Object.defineProperty(Range.prototype, "getClientRects", {
    configurable: true,
    value: () => [],
  });
  Object.defineProperty(Range.prototype, "getBoundingClientRect", {
    configurable: true,
    value: () => new DOMRect(),
  });
  const content =
    "# Title\n\nRef[^one] and again[^one].\n\n[^one]: Definition\n";
  const first = content.indexOf("[^one]"),
    second = content.indexOf("[^one]", first + 1),
    definition = content.indexOf("[^one]:");
  const base = {
    text: "",
    target: "one",
    level: 0,
    line: 3,
    endLine: 3,
    children: [],
  };
  const renderMarkdown = vi.spyOn(api, "renderMarkdown").mockResolvedValue({
    warning: null,
    nodes: [
      { ...base, kind: "footnoteRef", from: first, to: first + 6 },
      { ...base, kind: "footnoteRef", from: second, to: second + 6 },
      {
        ...base,
        kind: "footnote",
        from: definition,
        to: content.length,
        line: 5,
        endLine: 5,
      },
    ],
  });
  try {
    render(
      <MarkdownEditor
        content={content}
        onChange={vi.fn()}
        onSave={vi.fn()}
        live
        vaultId="v"
        path="Note.md"
      />,
    );
    await waitFor(() =>
      expect(
        screen.getAllByRole("button", { name: "Перейти к сноске one" }),
      ).toHaveLength(2),
    );
  } finally {
    renderMarkdown.mockRestore();
  }
});
it("inserts new YAML lines using the editor line separator rather than literal LF characters", () => {
  for (const source of ["Body\r\nNext", "---\r\nold: yes\r\n---\r\nBody"]) {
    const { unmount } = render(
      <MarkdownEditor content={source} onChange={vi.fn()} onSave={vi.fn()} />,
    );
    const view = EditorView.findFromDOM(
      screen.getByRole("textbox", { name: "Markdown-редактор" }),
    )!;
    applyProperty(
      view,
      { key: "new", value: "value", create: true },
      readProperties(source).expected,
    );
    expect(view.state.sliceDoc().replace(/\r\n/g, "")).not.toContain("\n");
    expect(view.state.doc.lines).toBeGreaterThan(source.split("\r\n").length);
    expect(
      readProperties(view.state.sliceDoc()).items.find(
        (item) => item.key === "new",
      )?.value,
    ).toBe("value");
    undo(view);
    expect(view.state.sliceDoc()).toBe(source);
    unmount();
  }
});
it("maps body selections through a property edit, preserves CRLF and isolates undo", () => {
  const source = "\uFEFF---\r\ntitle: Old\r\n---\r\nBody 😀";
  render(
    <MarkdownEditor content={source} onChange={vi.fn()} onSave={vi.fn()} />,
  );
  const view = EditorView.findFromDOM(
    screen.getByRole("textbox", { name: "Markdown-редактор" }),
  )!;
  const expected = readProperties(source).expected;
  view.dispatch({
    changes: { from: view.state.doc.length, insert: " draft" },
    userEvent: "input.type",
  });
  const draft = view.state.sliceDoc();
  view.dispatch({
    selection: {
      anchor: view.state.doc.length - 5,
      head: view.state.doc.length,
    },
  });
  applyProperty(
    view,
    { key: "title", value: "New title", create: false },
    expected,
  );
  expect(view.state.sliceDoc()).toBe(draft.replace("Old", '"New title"'));
  expect(
    view.state.sliceDoc(
      view.state.selection.main.from,
      view.state.selection.main.to,
    ),
  ).toBe("draft");
  undo(view);
  expect(view.state.sliceDoc()).toBe(draft);
  undo(view);
  expect(view.state.sliceDoc()).toBe(source);
});
it("applies property commands in reading mode and reports stale header conflicts without replacing text", () => {
  const source = "---\ntitle: Old\n---\nBody";
  const props = {
    content: source,
    onChange: vi.fn(),
    onSave: vi.fn(),
    visible: false,
  };
  const { rerender } = render(<MarkdownEditor {...props} />);
  const view = EditorView.findFromDOM(
    screen.getByRole("textbox", { name: "Markdown-редактор" }),
  )!;
  view.dispatch({ changes: { from: 11, to: 14, insert: "New" } });
  const current = view.state.sliceDoc();
  const done = vi.fn();
  rerender(
    <MarkdownEditor
      {...props}
      content={current}
      propertyCommand={{
        id: 1,
        action: { key: "title", value: "Stale", create: false },
        expected: readProperties(source).expected,
        done,
      }}
    />,
  );
  expect(done).toHaveBeenCalledWith(expect.stringContaining("изменились"));
  expect(view.state.sliceDoc()).toBe(current);
  expect(props.onSave).not.toHaveBeenCalled();
});
it("completes YAML aliases as canonical links and preserves closing brackets and undo", async () => {
  const suggestions = vi.spyOn(api, "linkSuggestions").mockResolvedValue([
    { path: "Notes/Topic.md", alias: "ИИ" },
    { path: "Other.md", alias: "ИИ" },
  ]);
  try {
    render(
      <MarkdownEditor
        content="[[ИИ]]"
        vaultId="v"
        path="Main.md"
        onChange={vi.fn()}
        onSave={vi.fn()}
      />,
    );
    const view = EditorView.findFromDOM(
      screen.getByRole("textbox", { name: "Markdown-редактор" }),
    )!;
    // JSDOM does not measure text ranges; native tests cover popup placement.
    vi.spyOn(view, "coordsAtPos").mockReturnValue(null);
    view.dispatch({ selection: { anchor: 4 } });
    startCompletion(view);
    await vi.waitFor(() =>
      expect(currentCompletions(view.state)).toHaveLength(2),
    );
    expect(suggestions).toHaveBeenCalledWith("v", "ИИ");
    expect(
      currentCompletions(view.state).map((option) => option.detail),
    ).toEqual(["→ Notes/Topic.md", "→ Other.md"]);
    await vi.waitFor(() => expect(acceptCompletion(view)).toBe(true));
    expect(view.state.sliceDoc()).toBe("[[Notes/Topic|ИИ]]");
    expect(view.state.selection.main.head).toBe(view.state.doc.length);
    undo(view);
    expect(view.state.sliceDoc()).toBe("[[ИИ]]");
  } finally {
    suggestions.mockRestore();
  }
});
it("keeps checked task markers visible instead of hiding them as link brackets", () => {
  render(
    <MarkdownEditor
      content={"# Title\n\n- [x] Done"}
      live
      onChange={vi.fn()}
      onSave={vi.fn()}
    />,
  );
  expect(
    screen.getByRole("textbox", { name: "Markdown-редактор" }).textContent,
  ).toContain("[x]");
});
it("toggles a task through history without moving selection and rejects stale previews", () => {
  const content = "😀\r\n- [ ] Дело\r\n";
  const { rerender } = render(
    <MarkdownEditor content={content} onChange={vi.fn()} onSave={vi.fn()} />,
  );
  const view = EditorView.findFromDOM(
    screen.getByRole("textbox", { name: "Markdown-редактор" }),
  )!;
  const from = view.state.doc.toString().indexOf("[ ]");
  const task = {
    from,
    to: from + 3,
    kind: "task",
    text: "[ ]",
    target: "",
    level: 0,
    line: 2,
    endLine: 2,
    children: [],
  };
  view.dispatch({ selection: { anchor: view.state.doc.length } });
  const selection = view.state.selection.main.anchor;
  view.dispatch({
    changes: { from: selection, insert: "Новый текст" },
    userEvent: "input.type",
  });
  const snapshot = view.state.sliceDoc();
  const afterTypingSelection = view.state.selection.main.anchor;
  expect(toggleTask(view, task, snapshot)).toBe(true);
  expect(view.state.sliceDoc()).toBe(snapshot.replace("[ ]", "[x]"));
  expect(view.state.selection.main.anchor).toBe(afterTypingSelection);
  expect(toggleTask(view, task, content)).toBe(false);
  rerender(
    <MarkdownEditor
      content={view.state.sliceDoc()}
      onChange={vi.fn()}
      onSave={vi.fn()}
      live
    />,
  );
  undo(view);
  expect(view.state.sliceDoc()).toBe(snapshot);
});
it("switches line wrapping without replacing text, selection or undo history", () => {
  const props = {
    content: "длинная строка",
    onChange: vi.fn(),
    onSave: vi.fn(),
  };
  const { rerender } = render(<MarkdownEditor {...props} />);
  const dom = screen.getByRole("textbox", { name: "Markdown-редактор" });
  const view = EditorView.findFromDOM(dom)!;
  view.dispatch({
    changes: { from: view.state.doc.length, insert: "!" },
    selection: { anchor: 3, head: 6 },
  });
  rerender(<MarkdownEditor {...props} lineWrapping={false} />);
  expect(EditorView.findFromDOM(dom)).toBe(view);
  expect(dom.classList.contains("cm-lineWrapping")).toBe(false);
  expect(view.state.selection.main.from).toBe(3);
  expect(view.state.selection.main.to).toBe(6);
  expect(view.state.sliceDoc()).toBe(props.content + "!");
  rerender(<MarkdownEditor {...props} lineWrapping />);
  expect(dom.classList.contains("cm-lineWrapping")).toBe(true);
  undo(view);
  expect(view.state.sliceDoc()).toBe(props.content);
});
it("reports formatting of the whole selection without marking mixed text active", () => {
  const content =
    "## Heading\n\n**bold** plain **other**\n\n> quote\n\n- list\n\n`code`\n\n[[Note]]";
  render(
    <MarkdownEditor content={content} onChange={vi.fn()} onSave={vi.fn()} />,
  );
  const view = EditorView.findFromDOM(
    screen.getByRole("textbox", { name: "Markdown-редактор" }),
  )!;
  const select = (text: string) => {
    const from = content.indexOf(text);
    view.dispatch({ selection: { anchor: from, head: from + text.length } });
    return activeFormats(view.state);
  };
  expect(select("bold")).toContain("bold");
  expect(select("bold** plain **other")).not.toContain("bold");
  expect(select("Heading")).toContain("heading");
  expect(select("quote")).toContain("quote");
  expect(select("list")).toContain("list");
  expect(select("code")).toContain("code");
  expect(select("Note")).toContain("link");
});
it("toggles live formatting without remounting the editor or rewriting Markdown", () => {
  const props = {
    content: "# Heading\n\n**bold** and *italic*",
    onChange: vi.fn(),
    onSave: vi.fn(),
  };
  const { rerender } = render(<MarkdownEditor {...props} />);
  const dom = screen.getByRole("textbox", { name: "Markdown-редактор" });
  const view = EditorView.findFromDOM(dom);
  if (!view) throw new Error("missing editor");
  view.dispatch({ selection: { anchor: view.state.doc.length } });
  rerender(<MarkdownEditor {...props} live />);
  expect(EditorView.findFromDOM(dom)).toBe(view);
  expect(view.state.sliceDoc()).toBe(props.content);
  expect(props.onChange).not.toHaveBeenCalled();
  rerender(<MarkdownEditor {...props} live={false} />);
  expect(EditorView.findFromDOM(dom)).toBe(view);
});
it("format commands are one undoable edit, preserve CRLF and toggle selected wrappers", () => {
  const props = { content: "word\r\nline", onChange: vi.fn(), onSave: vi.fn() };
  render(<MarkdownEditor {...props} />);
  const view = EditorView.findFromDOM(
    screen.getByRole("textbox", { name: "Markdown-редактор" }),
  );
  if (!view) throw new Error("missing editor");
  view.dispatch({ selection: { anchor: 0, head: 4 } });
  formatSelection(view, "bold");
  expect(view.state.sliceDoc()).toBe("**word**\r\nline");
  formatSelection(view, "bold");
  expect(view.state.sliceDoc()).toBe(props.content);
  formatSelection(view, "heading");
  expect(view.state.sliceDoc()).toBe("## word\r\nline");
  undo(view);
  expect(view.state.sliceDoc()).toBe(props.content);
});
it("preserves CRLF and cursor/undo state when React echoes an edit", () => {
  const onChange = vi.fn();
  const props = { content: "# Привет\r\nТекст", onChange, onSave: vi.fn() };
  const { rerender } = render(<MarkdownEditor {...props} />);
  const content = screen.getByRole("textbox", { name: "Markdown-редактор" });
  const view = EditorView.findFromDOM(content);
  if (!view) throw new Error("CodeMirror view was not mounted");
  view.dispatch({
    changes: { from: 2, to: 8, insert: "Мир" },
    selection: { anchor: 5 },
  });
  expect(onChange).toHaveBeenLastCalledWith("# Мир\r\nТекст");
  expect(view.state.selection.main.anchor).toBe(5);
  rerender(<MarkdownEditor {...props} content={"# Мир\r\nТекст"} />);
  expect(EditorView.findFromDOM(content)).toBe(view);
  expect(view.state.selection.main.anchor).toBe(5);
  expect(view.state.sliceDoc()).toBe("# Мир\r\nТекст");
  undo(view);
  expect(view.state.sliceDoc()).toBe(props.content);
});

it("does not report an edit when a disk reload changes CRLF into LF", () => {
  const onChange = vi.fn();
  const onSave = vi.fn();
  const { rerender } = render(
    <MarkdownEditor content={"A\r\nB"} onChange={onChange} onSave={onSave} />,
  );
  rerender(
    <MarkdownEditor
      content={"С диска\nНовая строка"}
      onChange={onChange}
      onSave={onSave}
    />,
  );
  const view = EditorView.findFromDOM(
    screen.getByRole("textbox", { name: "Markdown-редактор" }),
  );
  expect(view?.state.sliceDoc()).toBe("С диска\nНовая строка");
  expect(view?.state.doc.lines).toBe(2);
  expect(onChange).not.toHaveBeenCalled();
});

it("repeated anchor jumps move the cursor without replacing text or resetting undo", () => {
  const props = {
    content: "# Header\ntext",
    onChange: vi.fn(),
    onSave: vi.fn(),
  };
  const { rerender } = render(<MarkdownEditor {...props} />);
  const view = EditorView.findFromDOM(
    screen.getByRole("textbox", { name: "Markdown-редактор" }),
  );
  if (!view) throw new Error("missing editor");
  view.dispatch({ changes: { from: view.state.doc.length, insert: "!" } });
  const content = view.state.sliceDoc();
  props.onChange.mockClear();
  rerender(
    <MarkdownEditor
      {...props}
      content={content}
      navigation={{ id: 1, from: 2, to: 8, line: 1 }}
    />,
  );
  expect(view.state.selection.main.anchor).toBe(2);
  rerender(
    <MarkdownEditor
      {...props}
      content={content}
      navigation={{ id: 2, from: 9, to: 13, line: 2 }}
    />,
  );
  expect(view.state.selection.main.anchor).toBe(9);
  expect(view.state.sliceDoc()).toBe(content);
  expect(props.onChange).not.toHaveBeenCalled();
  undo(view);
  expect(view.state.sliceDoc()).toBe(props.content);
});

it("waits until the editor is available before focusing a navigation request", () => {
  const props = {
    content: "# Heading\ntext",
    onChange: vi.fn(),
    onSave: vi.fn(),
    navigation: { id: 1, from: 10, to: 14, line: 2 },
  };
  const { rerender } = render(<MarkdownEditor {...props} ready={false} />);
  const view = EditorView.findFromDOM(
    screen.getByRole("textbox", { name: "Markdown-редактор" }),
  );
  if (!view) throw new Error("missing editor");
  expect(view.state.selection.main.anchor).toBe(0);
  rerender(<MarkdownEditor {...props} ready />);
  expect(view.state.selection.main.anchor).toBe(10);
  view.dispatch({ selection: { anchor: 4 } });
  rerender(<MarkdownEditor {...props} ready={false} />);
  rerender(<MarkdownEditor {...props} ready />);
  expect(view.state.selection.main.anchor).toBe(4);
});

it("reveals only the inline fragment under the caret, including nested markers", () => {
  const content = "**bold** and *italic* with `code`\n\nEnd";
  render(
    <MarkdownEditor
      content={content}
      onChange={vi.fn()}
      onSave={vi.fn()}
      live
    />,
  );
  const dom = screen.getByRole("textbox", { name: "Markdown-редактор" });
  const view = EditorView.findFromDOM(dom)!;
  view.dispatch({ selection: { anchor: content.length } });
  expect(dom.textContent).not.toContain("**");
  expect(dom.textContent).not.toContain("*italic*");
  view.dispatch({ selection: { anchor: 4 } });
  expect(dom.textContent).toContain("**bold**");
  expect(dom.textContent).not.toContain("*italic*");
  view.dispatch({ selection: { anchor: content.indexOf("italic") + 2 } });
  expect(dom.textContent).not.toContain("**bold**");
  expect(dom.textContent).toContain("*italic*");
  view.dispatch({ selection: { anchor: content.indexOf("code") + 1 } });
  expect(dom.textContent).toContain("`code`");
  expect(view.state.sliceDoc()).toBe(content);
});

it("handles both wiki brackets, aliases and regular link URLs as whole fragments", () => {
  const content = "[[Target|alias]] and [site](https://example.com)\n\nEnd";
  render(
    <MarkdownEditor
      content={content}
      onChange={vi.fn()}
      onSave={vi.fn()}
      live
    />,
  );
  const dom = screen.getByRole("textbox", { name: "Markdown-редактор" });
  const view = EditorView.findFromDOM(dom)!;
  view.dispatch({ selection: { anchor: content.length } });
  expect(dom.textContent).toContain("alias and site");
  expect(dom.textContent).not.toContain("[");
  expect(dom.textContent).not.toContain("https://");
  view.dispatch({ selection: { anchor: 5 } });
  expect(dom.querySelector(".live-wiki-link")?.textContent).toBe(
    "[[Target|alias]]",
  );
  expect(dom.textContent).not.toContain("https://");
  view.dispatch({ selection: { anchor: content.indexOf("site") + 1 } });
  expect(dom.textContent).not.toContain("[[");
  expect(dom.textContent).toContain("[site](https://example.com)");
});

it("leaves wiki-like text in inline code and escaped syntax unchanged", () => {
  const content = "`[[literal]]` and \\[[escaped]]\n\nEnd";
  render(
    <MarkdownEditor
      content={content}
      onChange={vi.fn()}
      onSave={vi.fn()}
      live
    />,
  );
  const dom = screen.getByRole("textbox", { name: "Markdown-редактор" });
  const view = EditorView.findFromDOM(dom)!;
  view.dispatch({ selection: { anchor: content.length } });
  expect(dom.querySelector(".live-wiki-link")).toBeNull();
  expect(view.state.sliceDoc()).toBe(content);
});

it("reveals strikethrough markers only while editing that fragment", () => {
  const content = "~~crossed~~ and normal\n\nEnd";
  render(
    <MarkdownEditor
      content={content}
      onChange={vi.fn()}
      onSave={vi.fn()}
      live
    />,
  );
  const dom = screen.getByRole("textbox", { name: "Markdown-редактор" });
  const view = EditorView.findFromDOM(dom)!;
  view.dispatch({ selection: { anchor: content.length } });
  expect(dom.textContent).not.toContain("~~");
  view.dispatch({ selection: { anchor: 4 } });
  expect(dom.textContent).toContain("~~crossed~~");
  expect(view.state.sliceDoc()).toBe(content);
});

it("automatically closes both wiki bracket pairs, skips closers and deletes an empty pair", () => {
  render(<MarkdownEditor content="" onChange={vi.fn()} onSave={vi.fn()} />);
  const view = EditorView.findFromDOM(
    screen.getByRole("textbox", { name: "Markdown-редактор" }),
  )!;
  const bracket = (character: string) => {
    const transaction = insertBracket(view.state, character);
    expect(transaction).not.toBeNull();
    view.dispatch(transaction!);
  };
  bracket("[");
  expect(view.state.sliceDoc()).toBe("[]");
  bracket("[");
  expect(view.state.sliceDoc()).toBe("[[]]");
  expect(view.state.selection.main.head).toBe(2);
  view.dispatch({
    changes: { from: 2, insert: "Цель" },
    selection: { anchor: 6 },
    userEvent: "input.type",
  });
  bracket("]");
  bracket("]");
  expect(view.state.sliceDoc()).toBe("[[Цель]]");
  expect(view.state.selection.main.head).toBe(8);
  view.dispatch({
    changes: { from: 0, to: 8, insert: "" },
    selection: { anchor: 0 },
  });
  bracket("[");
  expect(deleteBracketPair(view)).toBe(true);
  expect(view.state.sliceDoc()).toBe("");
});

it("completion produces exactly one closing pair, including partially typed links", () => {
  for (const content of ["[[", "[[]", "[[]]"]) {
    const { unmount } = render(
      <MarkdownEditor content={content} onChange={vi.fn()} onSave={vi.fn()} />,
    );
    const view = EditorView.findFromDOM(
      screen.getByRole("textbox", { name: "Markdown-редактор" }),
    )!;
    applyWikiCompletion(view, { label: "Папка/Заметка" }, 2, 2);
    expect(view.state.sliceDoc()).toBe("[[Папка/Заметка]]");
    expect(view.state.selection.main.head).toBe(view.state.doc.length);
    undo(view);
    expect(view.state.sliceDoc()).toBe(content);
    unmount();
  }
});

it("marks the complete wiki syntax in source and live modes without marking code", () => {
  const props = {
    content: "[[Цель]] and `[[код]]`",
    onChange: vi.fn(),
    onSave: vi.fn(),
  };
  const { rerender } = render(<MarkdownEditor {...props} />);
  const dom = screen.getByRole("textbox", { name: "Markdown-редактор" });
  expect(dom.querySelector(".wiki-link")?.textContent).toBe("[[Цель]]");
  expect(dom.querySelectorAll(".wiki-link")).toHaveLength(1);
  rerender(<MarkdownEditor {...props} live />);
  expect(dom.querySelector(".wiki-link")?.textContent).toBe("[[Цель]]");
});
