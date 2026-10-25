import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { EditorView } from "@codemirror/view";
import { undo } from "@codemirror/commands";
import { MarkdownEditor } from "../src/editor/MarkdownEditor";
import {
  formatSelection,
  applyWikiCompletion,
} from "../src/editor/enhancements";
import { insertBracket, deleteBracketPair } from "@codemirror/autocomplete";

afterEach(cleanup);
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
