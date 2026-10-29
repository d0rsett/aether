import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { InlineProperties } from "../src/components/InlineProperties";
import { api } from "../src/services/api";

beforeEach(() => {
  vi.spyOn(api, "setPropertyType").mockImplementation(
    async (_vault, key, kind, expected) => ({ ...expected, [key]: kind }),
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it("edits current buffer properties and directs complex values to source", async () => {
  vi.spyOn(api, "propertyTypes").mockResolvedValue({});
  const props = {
    vaultId: "v1",
    path: "one.md",
    onApply: vi.fn((_action, _expected, done) => done()),
    onSource: vi.fn(),
  };
  const { rerender } = render(
    <InlineProperties
      {...props}
      content={"---\ntitle: Draft\nplugin: {nested: true}\n---\nBody"}
    />,
  );
  const title = await screen.findByLabelText("Значение title");
  expect(title).toHaveProperty("value", "Draft");
  fireEvent.change(title, { target: { value: "Changed" } });
  expect(props.onApply).toHaveBeenCalledWith(
    { key: "title", value: "Changed", create: false },
    expect.any(String),
    expect.any(Function),
  );
  fireEvent.click(screen.getByRole("button", { name: /Сложное значение/ }));
  expect(props.onSource).toHaveBeenCalledOnce();
  rerender(
    <InlineProperties {...props} content={"---\ntitle: Changed\n---\nBody"} />,
  );
  expect(screen.queryByRole("button", { name: /Сложное значение/ })).toBeNull();
});
it("ignores stale vault settings and preserves invalid drafts across remount", async () => {
  let finishOld: ((types: Record<string, string>) => void) | undefined;
  vi.spyOn(api, "propertyTypes").mockImplementation((vault) =>
    vault === "old"
      ? new Promise((done) => {
          finishOld = done;
        })
      : Promise.resolve({ created: "datetime", labels: "multitext" }),
  );
  const props = {
    path: "sample.md",
    content:
      '---\ncreated: "2026-10-28T14:30:00+03:00"\nlabels: [one, two]\n---\nBody',
    onApply: vi.fn(),
    onSource: vi.fn(),
  };
  const { rerender, unmount } = render(
    <InlineProperties {...props} vaultId="old" />,
  );
  rerender(<InlineProperties {...props} vaultId="new" />);
  const created = await screen.findByLabelText("Значение created");
  finishOld?.({ created: "text" });
  expect(created).toHaveProperty("value", "2026-10-28T14:30:00+03:00");
  fireEvent.focus(created);
  fireEvent.change(created, { target: { value: "2026-" } });
  expect(screen.getByRole("alert").textContent).toContain("дату и время");
  fireEvent.blur(created);
  unmount();
  render(<InlineProperties {...props} vaultId="new" />);
  expect(await screen.findByLabelText("Значение created")).toHaveProperty(
    "value",
    "2026-",
  );
  expect(props.onApply).not.toHaveBeenCalled();
});
it("blocks creation for malformed frontmatter and keeps source access", async () => {
  vi.spyOn(api, "propertyTypes").mockResolvedValue({});
  render(
    <InlineProperties
      vaultId="v3"
      path="broken.md"
      content={"---\ntitle: [bad\n---\nBody"}
      onApply={vi.fn()}
      onSource={vi.fn()}
    />,
  );
  expect((await screen.findByRole("alert")).textContent).toContain("исходнике");
  expect(
    screen.queryByRole("button", { name: "Добавить свойство" }),
  ).toBeNull();
  expect(
    screen.getByRole("button", { name: "Открыть свойства в исходнике" }),
  ).toBeTruthy();
});

it("changes an unconfigured property type through its row", async () => {
  vi.spyOn(api, "propertyTypes").mockResolvedValue({});
  const onApply = vi.fn((_action, _expected, done) => done());
  render(
    <InlineProperties
      vaultId="v4"
      path="types.md"
      content={'---\nscore: "12"\n---\nBody'}
      onApply={onApply}
      onSource={vi.fn()}
    />,
  );
  await screen.findByLabelText("Значение score");
  fireEvent.click(screen.getByRole("button", { name: "Тип свойства score" }));
  fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Число" }));
  await waitFor(() =>
    expect(onApply).toHaveBeenCalledWith(
      { key: "score", value: 12, create: false },
      expect.any(String),
      expect.any(Function),
    ),
  );
});

it("chooses a new property's type from the icon and keeps configured types protected", async () => {
  vi.spyOn(api, "propertyTypes").mockResolvedValue({ fixed: "number" });
  const apply = vi.fn((_action, _expected, done) => done());
  render(
    <InlineProperties
      vaultId="v5"
      path="new.md"
      content="Body"
      onApply={apply}
      onSource={vi.fn()}
    />,
  );
  fireEvent.click(
    await screen.findByRole("button", { name: "Добавить свойство" }),
  );
  fireEvent.change(screen.getByLabelText("Имя нового свойства"), {
    target: { value: "items" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Тип нового свойства" }));
  fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Список" }));
  await waitFor(() =>
    expect(screen.getByLabelText("Значение нового свойства").tagName).toBe(
      "TEXTAREA",
    ),
  );
  const value = screen.getByLabelText("Значение нового свойства");
  fireEvent.change(value, { target: { value: "one\ntwo" } });
  fireEvent.click(screen.getByRole("button", { name: /^Добавить$/ }));
  await waitFor(() =>
    expect(apply).toHaveBeenCalledWith(
      { key: "items", value: ["one", "two"], create: true },
      "",
      expect.any(Function),
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: "Добавить свойство" }));
  fireEvent.change(screen.getByLabelText("Имя нового свойства"), {
    target: { value: "fixed" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Тип нового свойства" }));
  expect(
    screen.getByRole("menuitemcheckbox", { name: "Число" }),
  ).toHaveProperty("disabled", false);
  expect(
    screen.getByRole("menuitemcheckbox", { name: "Текст" }),
  ).toHaveProperty("disabled", true);
});

it("persists a text assignment for a date-looking string", async () => {
  vi.spyOn(api, "propertyTypes").mockResolvedValue({});
  const apply = vi.fn();
  render(
    <InlineProperties
      vaultId="v6"
      path="date.md"
      content={"---\ndue: 2028-02-29\n---\nBody"}
      onApply={apply}
      onSource={vi.fn()}
    />,
  );
  await screen.findByLabelText("Значение due");
  fireEvent.click(screen.getByRole("button", { name: "Тип свойства due" }));
  fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Текст" }));
  await waitFor(() => expect(apply).toHaveBeenCalled());
  expect(api.setPropertyType).toHaveBeenCalledWith("v6", "due", "text", {});
});
