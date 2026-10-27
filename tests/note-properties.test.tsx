import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { NoteProperties } from "../src/components/NoteProperties";
afterEach(cleanup);
it("shows current buffer properties and directs complex values to source", () => {
  const props = { onApply: vi.fn(), onSource: vi.fn() };
  const { rerender } = render(
    <NoteProperties
      {...props}
      content={"---\ntitle: Draft\nplugin: {nested: true}\n---\nBody"}
    />,
  );
  expect(
    screen.getByRole("button", { name: "Изменить свойство title" }).textContent,
  ).toContain("Draft");
  fireEvent.click(
    screen.getByRole("button", { name: "Изменить свойство plugin" }),
  );
  expect(props.onSource).toHaveBeenCalledOnce();
  rerender(
    <NoteProperties {...props} content={"---\ntitle: Changed\n---\nBody"} />,
  );
  expect(
    screen.getByRole("button", { name: "Изменить свойство title" }).textContent,
  ).toContain("Changed");
  expect(
    screen.queryByRole("button", { name: "Изменить свойство plugin" }),
  ).toBeNull();
});
it("blocks form creation for malformed frontmatter and keeps source access", () => {
  render(
    <NoteProperties
      content={"---\ntitle: [bad\n---\nBody"}
      onApply={vi.fn()}
      onSource={vi.fn()}
    />,
  );
  expect(screen.getByRole("alert").textContent).toContain("исходнике");
  expect(
    screen.queryByRole("button", { name: "Добавить свойство" }),
  ).toBeNull();
  expect(
    screen.getByRole("button", { name: "Открыть свойства в исходнике" }),
  ).toBeTruthy();
});
