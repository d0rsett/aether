import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { NoteTitle } from "../src/components/NoteTitle";
afterEach(cleanup);
it("edits the inline title through rename while keeping folder and extension", async () => {
  const rename = vi.fn().mockResolvedValue(undefined);
  render(
    <NoteTitle
      path="Проект/Старая.markdown"
      disabled={false}
      rename={rename}
      onError={vi.fn()}
    />,
  );
  const input = screen.getByRole("textbox", { name: "Название заметки" });
  await userEvent.clear(input);
  await userEvent.type(input, "Новая{Enter}");
  expect(rename).toHaveBeenCalledWith(
    "Проект/Старая.markdown",
    "Проект/Новая.markdown",
  );
});
it("Escape cancels and invalid names do not rename", async () => {
  const rename = vi.fn(),
    error = vi.fn();
  render(
    <NoteTitle
      path="Старая.md"
      disabled={false}
      rename={rename}
      onError={error}
    />,
  );
  const input = screen.getByRole("textbox", { name: "Название заметки" });
  await userEvent.clear(input);
  await userEvent.type(input, "Новая{Escape}");
  expect((input as HTMLInputElement).value).toBe("Старая");
  expect(rename).not.toHaveBeenCalled();
  await userEvent.clear(input);
  await userEvent.type(input, "../Путь{Enter}");
  expect(error).toHaveBeenCalled();
  expect(rename).not.toHaveBeenCalled();
});
