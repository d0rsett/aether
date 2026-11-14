import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { QuickCapture } from "../src/components/QuickCapture";

beforeEach(() => {
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: {
      configurable: true,
      value() {
        this.setAttribute("open", "");
      },
    },
    close: {
      configurable: true,
      value() {
        this.removeAttribute("open");
      },
    },
  });
});
afterEach(() => {
  cleanup();
  localStorage.clear();
});

it("retains a capture draft after closing and only clears it after a successful save", async () => {
  const save = vi
    .fn<(text: string) => Promise<string | undefined>>()
    .mockResolvedValue(undefined);
  const close = vi.fn();
  const view = render(
    <QuickCapture vaultId="vault" save={save} onClose={close} />,
  );
  fireEvent.change(screen.getByRole("textbox", { name: "Текст мысли" }), {
    target: { value: "Idea" },
  });
  view.unmount();
  render(<QuickCapture vaultId="vault" save={save} onClose={close} />);
  expect(
    (
      screen.getByRole("textbox", {
        name: "Текст мысли",
      }) as HTMLTextAreaElement
    ).value,
  ).toBe("Idea");
  fireEvent.click(
    screen.getByRole("button", { name: "Сохранить во входящие" }),
  );
  await waitFor(() => expect(save).toHaveBeenCalledWith("Idea"));
  expect(close).not.toHaveBeenCalled();
  save.mockResolvedValue("Входящие/idea.md");
  await waitFor(() =>
    expect(
      screen
        .getByRole("button", { name: "Сохранить во входящие" })
        .hasAttribute("disabled"),
    ).toBe(false),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Сохранить во входящие" }),
  );
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  expect(localStorage.getItem("aether.capture.v1:vault")).toBe("");
});

it("submits capture with the keyboard and keeps failed text available", async () => {
  const save = vi
    .fn<(text: string) => Promise<string | undefined>>()
    .mockRejectedValue(new Error("offline"));
  const close = vi.fn();
  render(<QuickCapture vaultId="vault" save={save} onClose={close} />);
  const text = screen.getByRole("textbox", { name: "Текст мысли" });
  fireEvent.change(text, { target: { value: "Keep this thought" } });
  fireEvent.keyDown(text, { key: "Enter", metaKey: true });
  await waitFor(() => expect(save).toHaveBeenCalledWith("Keep this thought"));
  await screen.findByRole("alert");
  expect(close).not.toHaveBeenCalled();
  expect(localStorage.getItem("aether.capture.v1:vault")).toBe(
    "Keep this thought",
  );
});
