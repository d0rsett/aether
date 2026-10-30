import {
  closeSearchPanel,
  findNext,
  findPrevious,
  getSearchQuery,
  replaceAll,
  replaceNext,
  search,
  SearchQuery,
  selectMatches,
  setSearchQuery,
} from "@codemirror/search";
import {
  runScopeHandlers,
  type EditorView,
  type Panel,
} from "@codemirror/view";
import { subscribeLocale } from "../i18n";

// Paths follow the Lucide icons used by the rest of the workspace.
function icon(path: string) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  for (const [name, value] of Object.entries({
    viewBox: "0 0 24 24",
    width: "16",
    height: "16",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": "1.8",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    "aria-hidden": "true",
  }))
    svg.setAttribute(name, value);
  const shape = document.createElementNS(svg.namespaceURI, "path");
  shape.setAttribute("d", path);
  svg.append(shape);
  return svg;
}

function createPanel(view: EditorView): Panel {
  const dom = document.createElement("div");
  dom.className = "note-search";
  dom.setAttribute("role", "search");
  const labels: (() => void)[] = [];
  const searchRow = document.createElement("div");
  searchRow.className = "note-search-row";
  const replaceRow = document.createElement("div");
  replaceRow.className = "note-search-row note-search-replace";
  dom.append(searchRow);
  if (!view.state.readOnly) dom.append(replaceRow);

  function field(row: HTMLElement, name: string, phrase: string, path: string) {
    const wrapper = document.createElement("div");
    wrapper.className = "note-search-field";
    const input = document.createElement("input");
    input.type = "text";
    input.name = name;
    input.autocomplete = "off";
    input.spellcheck = false;
    labels.push(() => {
      input.placeholder = view.state.phrase(phrase);
      input.setAttribute("aria-label", view.state.phrase(phrase));
    });
    wrapper.append(icon(path), input);
    row.append(wrapper);
    return { wrapper, input };
  }
  const find = field(
    searchRow,
    "search",
    "Find",
    "m21 21-4.34-4.34M19 11a8 8 0 1 1-16 0 8 8 0 0 1 16 0",
  );
  find.input.setAttribute("main-field", "true");
  const replacement = field(
    replaceRow,
    "replace",
    "Replace",
    "m3 3 6 6-6 6M9 9h6a6 6 0 0 1 0 12h-3",
  );
  function button(
    parent: HTMLElement,
    name: string,
    phrase: string,
    action: () => void,
    path?: string,
    text?: string,
  ) {
    const element = document.createElement("button");
    element.type = "button";
    element.name = name;
    element.className =
      path || text ? "note-search-icon" : "note-search-action";
    if (path) element.append(icon(path));
    else if (text) element.textContent = text;
    labels.push(() => {
      const label = view.state.phrase(phrase);
      element.setAttribute("aria-label", label);
      element.setAttribute("data-tooltip", label);
      if (!path && !text) element.textContent = label;
    });
    element.onclick = action;
    parent.append(element);
    return element;
  }
  const options = document.createElement("div");
  options.className = "note-search-options";
  find.wrapper.append(options);
  const caseButton = button(
    options,
    "case",
    "match case",
    () => toggle("caseSensitive"),
    undefined,
    "Aa",
  );
  const wordButton = button(
    options,
    "word",
    "by word",
    () => toggle("wholeWord"),
    undefined,
    "ab",
  );
  const regexpButton = button(
    options,
    "re",
    "regexp",
    () => toggle("regexp"),
    undefined,
    ".*",
  );
  wordButton.classList.add("note-search-word");
  const actions = document.createElement("div");
  actions.className = "note-search-navigation";
  searchRow.append(actions);
  button(
    actions,
    "prev",
    "previous",
    () => findPrevious(view),
    "m18 15-6-6-6 6",
  );
  button(actions, "next", "next", () => findNext(view), "m6 9 6 6 6-6");
  button(
    actions,
    "select",
    "all",
    () => selectMatches(view),
    "M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3M8 8h8v8H8z",
  );
  button(
    actions,
    "close",
    "close",
    () => {
      closeSearchPanel(view);
      view.focus();
    },
    "m18 6-12 12M6 6l12 12",
  );
  const replaceActions = document.createElement("div");
  replaceActions.className = "note-search-replacements";
  replaceRow.append(replaceActions);
  const replaceButton = button(replaceActions, "replace", "replace", () =>
    replaceNext(view),
  );
  const replaceAllButton = button(
    replaceActions,
    "replaceAll",
    "replace all",
    () => replaceAll(view),
  );
  function commit() {
    const current = getSearchQuery(view.state);
    view.dispatch({
      effects: setSearchQuery.of(
        new SearchQuery({
          ...current,
          search: find.input.value,
          replace: replacement.input.value,
        }),
      ),
    });
  }
  function toggle(key: "caseSensitive" | "wholeWord" | "regexp") {
    const current = getSearchQuery(view.state);
    view.dispatch({
      effects: setSearchQuery.of(
        new SearchQuery({ ...current, [key]: !current[key] }),
      ),
    });
  }
  find.input.oninput = replacement.input.oninput = commit;
  dom.onkeydown = (event) => {
    if (runScopeHandlers(view, event, "search-panel")) event.preventDefault();
    else if (event.key === "Enter" && !event.isComposing) {
      if (event.target === find.input) {
        event.preventDefault();
        (event.shiftKey ? findPrevious : findNext)(view);
      } else if (event.target === replacement.input) {
        event.preventDefault();
        replaceNext(view);
      }
    }
  };
  function update() {
    dom.setAttribute("aria-label", view.state.phrase("Find"));
    const query = getSearchQuery(view.state);
    if (find.input.value !== query.search) find.input.value = query.search;
    if (replacement.input.value !== query.replace)
      replacement.input.value = query.replace;
    for (const [control, checked] of [
      [caseButton, query.caseSensitive],
      [wordButton, query.wholeWord],
      [regexpButton, query.regexp],
    ] as const)
      control.setAttribute("aria-pressed", String(checked));
    find.input.setAttribute(
      "aria-invalid",
      String(!!query.search && !query.valid),
    );
    replaceButton.disabled = replaceAllButton.disabled =
      !query.valid || view.state.readOnly;
    replaceRow.hidden = view.state.readOnly;
    labels.forEach((refresh) => refresh());
  }
  update();
  let disposed = false;
  const release = subscribeLocale(() =>
    queueMicrotask(() => {
      if (!disposed) update();
    }),
  );
  return {
    dom,
    top: true,
    mount: () => find.input.select(),
    update,
    destroy: () => {
      disposed = true;
      release();
    },
  };
}

export const noteSearch = search({ top: true, createPanel });
