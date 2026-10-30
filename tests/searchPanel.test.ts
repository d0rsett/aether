import { afterEach, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { history, undo } from "@codemirror/commands";
import {
  getSearchQuery,
  openSearchPanel,
  searchKeymap,
  SearchQuery,
  setSearchQuery,
} from "@codemirror/search";
import { noteSearch } from "../src/editor/searchPanel";

let view: EditorView | undefined;
afterEach(() => {
  view?.destroy();
  document.body.replaceChildren();
});
function editor() {
  view = new EditorView({
    parent: document.body,
    state: EditorState.create({
      doc: "Thought thought thoughtful",
      extensions: [history(), noteSearch, keymap.of(searchKeymap)],
    }),
  });
  openSearchPanel(view);
  return view;
}
function input(name: string, value: string) {
  const element = document.querySelector<HTMLInputElement>(
    `.note-search input[name="${name}"]`,
  )!;
  element.value = value;
  element.dispatchEvent(new Event("input", { bubbles: true }));
  return element;
}
function click(name: string) {
  document
    .querySelector<HTMLButtonElement>(`.note-search button[name="${name}"]`)!
    .click();
}
it("searches immediately, applies options and replaces through undoable transactions", () => {
  const current = editor();
  input("search", "thought");
  input("replace", "idea");
  click("word");
  click("case");
  expect(getSearchQuery(current.state).wholeWord).toBe(true);
  expect(getSearchQuery(current.state).caseSensitive).toBe(true);
  click("replaceAll");
  expect(current.state.sliceDoc()).toBe("Thought idea thoughtful");
  undo(current);
  expect(current.state.sliceDoc()).toBe("Thought thought thoughtful");
  click("close");
  expect(document.querySelector(".note-search")).toBeNull();
});
it("tracks externally selected queries and prevents replacement with invalid regex", () => {
  const current = editor();
  current.dispatch({
    effects: setSearchQuery.of(
      new SearchQuery({
        search: "Thought",
        replace: "Idea",
        caseSensitive: true,
      }),
    ),
  });
  expect(
    document.querySelector<HTMLInputElement>('input[name="search"]')?.value,
  ).toBe("Thought");
  expect(
    document.querySelector('button[name="case"]')?.getAttribute("aria-pressed"),
  ).toBe("true");
  click("re");
  input("search", "[");
  expect(
    document
      .querySelector('input[name="search"]')
      ?.getAttribute("aria-invalid"),
  ).toBe("true");
  expect(
    document.querySelector<HTMLButtonElement>('button[name="replaceAll"]')
      ?.disabled,
  ).toBe(true);
  expect(current.state.sliceDoc()).toBe("Thought thought thoughtful");
});
