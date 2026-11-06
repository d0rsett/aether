import { useState } from "react";
import {
  cleanup,
  createEvent,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { api } from "../src/services/api";
import { canvasFileDragType } from "../src/services/canvasFiles";
import { NotePreviews } from "../src/services/notePreviews";
import { CanvasBoard } from "../src/components/CanvasBoard";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("moves a card without discarding JSON Canvas extensions or other nodes", () => {
  const card = {
    id: "a",
    type: "text",
    x: -10,
    y: 25,
    width: 150,
    height: 90,
    text: "Draft",
    extra: { pinned: true },
  };
  const unknown = { id: "b", type: "future" };
  const data = {
    nodes: [card, unknown],
    edges: [{ id: "edge", fromNode: "a", toNode: "b", label: "Next" }],
    metadata: { version: 1 },
  };
  const onChange = vi.fn();
  render(<CanvasBoard content={JSON.stringify(data)} onChange={onChange} />);
  fireEvent.keyDown(screen.getByText("Draft").parentElement!, {
    key: "ArrowRight",
    shiftKey: true,
  });
  expect(onChange).toHaveBeenCalledOnce();
  expect(JSON.parse(onChange.mock.calls[0][0])).toEqual({
    ...data,
    nodes: [{ ...card, x: 0 }, unknown],
  });
});

it("adds and edits cards, then saves their connection in JSON Canvas form", () => {
  const change = vi.fn<(content: string) => void>();
  function Board() {
    const [content, setContent] = useState("{}");
    return (
      <CanvasBoard
        content={content}
        onChange={(next) => {
          change(next);
          setContent(next);
        }}
      />
    );
  }
  render(<Board />);
  const add = () =>
    fireEvent.click(screen.getByRole("button", { name: "Добавить карточку" }));
  const write = (text: string) => {
    const editor = screen.getByRole("textbox", { name: "Текст карточки" });
    fireEvent.change(editor, { target: { value: text } });
    fireEvent.blur(editor);
  };
  add();
  write("First");
  fireEvent.doubleClick(screen.getByLabelText("Полотно доски"), {
    clientX: 480,
    clientY: 160,
  });
  write("Second");
  const first = screen.getByText("First").parentElement!;
  fireEvent.focus(first);
  fireEvent.click(
    screen.getByRole("button", { name: "Начать связь · Справа" }),
  );
  fireEvent.click(screen.getByText("Second"));
  fireEvent.change(screen.getByRole("textbox", { name: "Подпись связи" }), {
    target: { value: "Next" },
  });
  fireEvent.change(
    screen.getByRole("combobox", { name: "Направление связи" }),
    {
      target: { value: "both" },
    },
  );
  const saved = JSON.parse(change.mock.lastCall![0]);
  expect(saved.nodes.map((card: { text: string }) => card.text)).toEqual([
    "First",
    "Second",
  ]);
  expect(saved.edges).toEqual([
    expect.objectContaining({
      fromNode: saved.nodes[0].id,
      fromSide: "right",
      toNode: saved.nodes[1].id,
      label: "Next",
      fromEnd: "arrow",
      toEnd: "arrow",
    }),
  ]);
  cleanup();
  render(<CanvasBoard content={JSON.stringify(saved)} onChange={change} />);
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  fireEvent.click(screen.getByRole("button", { name: "Удалить связь" }));
  expect(JSON.parse(change.mock.lastCall![0]).edges).toEqual([]);
});

it("keeps the world position under the pointer fixed when zooming", () => {
  const onChange = vi.fn<(content: string) => void>();
  render(<CanvasBoard content="{}" onChange={onChange} />);
  const canvas = screen.getByLabelText("Полотно доски");
  fireEvent.wheel(canvas, {
    clientX: 200,
    clientY: 160,
    deltaY: -240,
    ctrlKey: true,
  });
  fireEvent.doubleClick(canvas, { clientX: 200, clientY: 160 });
  expect(JSON.parse(onChange.mock.lastCall![0]).nodes[0]).toMatchObject({
    x: 152,
    y: 112,
  });
});

it("adds a note by its exact vault path and previews the unsaved buffer", async () => {
  const path = "Projects/Meeting #1.md";
  const previews = new NotePreviews();
  previews.update(
    "current",
    [{ path, content: "Unsaved", savedContent: "Saved", revision: "r" }],
    0,
  );
  const read = vi.spyOn(api, "read");
  const fragment = vi.spyOn(api, "renderFragment").mockResolvedValue({
    nodes: [
      {
        kind: "text",
        text: "Draft preview",
        target: "",
        children: [],
        from: 0,
        to: 7,
        level: 0,
        line: 1,
        endLine: 1,
      },
    ],
    warning: null,
  });
  const open = vi.fn();
  const onError = vi.fn();
  const change = vi.fn<(content: string) => void>();
  function Board() {
    const [content, setContent] = useState("{}");
    return (
      <CanvasBoard
        content={content}
        onChange={(next) => {
          change(next);
          setContent(next);
        }}
        files={{
          context: {
            vaultId: "current",
            path: "Board.canvas",
            previews,
            onWiki: vi.fn(),
            onError,
          },
          open,
        }}
      />
    );
  }
  render(<Board />);
  const canvas = screen.getByLabelText("Полотно доски");
  const drop = (vaultId: string, file: string) => {
    const event = createEvent.drop(canvas, {
      dataTransfer: {
        types: [canvasFileDragType],
        getData: () => JSON.stringify({ vaultId, path: file }),
      },
    });
    Object.defineProperties(event, {
      clientX: { value: 220 },
      clientY: { value: 180 },
    });
    fireEvent(canvas, event);
  };
  drop("other", path);
  drop("current", "../Meeting.md");
  expect(onError).toHaveBeenCalledTimes(2);
  expect(change).not.toHaveBeenCalled();
  drop("current", path);
  expect(JSON.parse(change.mock.lastCall![0]).nodes).toEqual([
    expect.objectContaining({ type: "file", file: path }),
  ]);
  expect(await screen.findByText("Draft preview")).toBeTruthy();
  expect(fragment).toHaveBeenCalledWith("current", path, "Unsaved", "");
  expect(read).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("button", { name: "Открыть оригинал: Meeting #1.md" }),
  );
  expect(open).toHaveBeenCalledWith(path, undefined);
});

it("moves only the cards inside a group and undoes and redoes the whole gesture", () => {
  const nodes = [
    {
      id: "g",
      type: "group",
      label: "Group",
      x: 0,
      y: 0,
      width: 300,
      height: 250,
    },
    {
      id: "a",
      type: "text",
      text: "Inside",
      x: 20,
      y: 40,
      width: 100,
      height: 80,
    },
    {
      id: "b",
      type: "text",
      text: "Outside",
      x: 260,
      y: 40,
      width: 100,
      height: 80,
    },
  ];
  const original = JSON.stringify({ nodes, edges: [], extension: "preserve" });
  const change = vi.fn<(content: string) => void>();
  function Board() {
    const [content, setContent] = useState(original);
    return (
      <CanvasBoard
        content={content}
        onChange={(next) => {
          change(next);
          setContent(next);
        }}
      />
    );
  }
  render(<Board />);
  const group = screen.getByText("Group").parentElement!;
  const pointer = (kind: string, x: number, y: number) => {
    const event = new MouseEvent(kind, {
      bubbles: true,
      button: 0,
      clientX: x,
      clientY: y,
    });
    Object.defineProperty(event, "pointerId", { value: 1 });
    fireEvent(group, event);
  };
  pointer("pointerdown", 100, 100);
  pointer("pointermove", 130, 120);
  expect(change).not.toHaveBeenCalled();
  pointer("pointerup", 130, 120);
  expect(change).toHaveBeenCalledOnce();
  const moved = change.mock.lastCall![0];
  expect(JSON.parse(moved).nodes).toEqual([
    { ...nodes[0], x: 30, y: 20 },
    { ...nodes[1], x: 50, y: 60 },
    nodes[2],
  ]);
  fireEvent.click(screen.getByRole("button", { name: "Отменить" }));
  expect(change.mock.lastCall![0]).toBe(original);
  fireEvent.click(screen.getByRole("button", { name: "Повторить" }));
  expect(change.mock.lastCall![0]).toBe(moved);

  fireEvent.focus(screen.getByText("Inside").parentElement!);
  fireEvent.keyDown(
    screen.getByRole("button", { name: "Изменить размер · Снизу справа" }),
    { key: "ArrowRight", shiftKey: true },
  );
  expect(JSON.parse(change.mock.lastCall![0]).nodes[1]).toMatchObject({
    x: 50,
    width: 110,
  });
  fireEvent.click(screen.getByRole("button", { name: "Отменить" }));
  expect(change.mock.lastCall![0]).toBe(moved);
});

it("creates a group behind the selected cards and coalesces renaming", () => {
  const nodes = [
    {
      id: "a",
      type: "text",
      text: "First",
      x: 0,
      y: 0,
      width: 100,
      height: 80,
    },
    {
      id: "b",
      type: "text",
      text: "Second",
      x: 120,
      y: 0,
      width: 100,
      height: 80,
    },
  ];
  const change = vi.fn<(content: string) => void>();
  function Board() {
    const [content, setContent] = useState(JSON.stringify({ nodes }));
    return (
      <CanvasBoard
        content={content}
        onChange={(next) => {
          change(next);
          setContent(next);
        }}
      />
    );
  }
  render(<Board />);
  fireEvent.focus(screen.getByText("First").parentElement!);
  fireEvent(
    screen.getByText("Second"),
    new MouseEvent("pointerdown", {
      bubbles: true,
      cancelable: true,
      shiftKey: true,
      button: 0,
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Создать группу" }));
  const added = JSON.parse(change.mock.lastCall![0]).nodes;
  expect(added).toEqual([
    expect.objectContaining({
      type: "group",
      x: -24,
      y: -42,
      width: 268,
      height: 146,
    }),
    ...nodes,
  ]);
  const title = screen.getByRole("textbox", { name: "Название группы" });
  fireEvent.change(title, { target: { value: "Pro" } });
  fireEvent.change(title, { target: { value: "Projects" } });
  fireEvent.blur(title);
  fireEvent.click(screen.getByRole("button", { name: "Отменить" }));
  expect(JSON.parse(change.mock.lastCall![0]).nodes).toEqual(added);
  fireEvent.click(screen.getByRole("button", { name: "Отменить" }));
  expect(JSON.parse(change.mock.lastCall![0]).nodes).toEqual(nodes);
});

it("copies a framed selection and remaps the connection endpoints on paste", () => {
  const source = {
    nodes: [
      {
        id: "a",
        type: "text",
        text: "First",
        x: 0,
        y: 0,
        width: 100,
        height: 80,
      },
      {
        id: "b",
        type: "text",
        text: "Second",
        x: 120,
        y: 0,
        width: 100,
        height: 80,
      },
      {
        id: "c",
        type: "text",
        text: "Outside",
        x: 420,
        y: 0,
        width: 100,
        height: 80,
      },
    ],
    edges: [{ id: "e", fromNode: "a", toNode: "b", label: "Together" }],
  };
  const change = vi.fn<(content: string) => void>();
  render(<CanvasBoard content={JSON.stringify(source)} onChange={change} />);
  const canvas = screen.getByLabelText("Полотно доски");
  for (const [type, x, y] of [
    ["pointerdown", 20, 20],
    ["pointermove", 310, 155],
    ["pointerup", 310, 155],
  ] as const) {
    const event = new MouseEvent(type, {
      bubbles: true,
      button: 0,
      clientX: x,
      clientY: y,
    });
    Object.defineProperty(event, "pointerId", { value: 1 });
    fireEvent(canvas, event);
  }
  const clipboard = new Map<string, string>();
  fireEvent.copy(canvas, {
    clipboardData: {
      setData: (type: string, value: string) => clipboard.set(type, value),
    },
  });
  fireEvent.paste(canvas, {
    clipboardData: { getData: (type: string) => clipboard.get(type) ?? "" },
  });
  const pasted = JSON.parse(change.mock.lastCall![0]);
  expect(pasted.nodes).toHaveLength(5);
  expect(
    pasted.nodes.slice(3).map((card: { text: string }) => card.text),
  ).toEqual(["First", "Second"]);
  expect(pasted.edges[1]).toMatchObject({
    fromNode: pasted.nodes[3].id,
    toNode: pasted.nodes[4].id,
    label: "Together",
  });
  expect(pasted.edges[1].id).not.toBe("e");
});
