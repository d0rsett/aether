import {
  cleanup,
  fireEvent,
  render,
  screen,
  act,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { PdfView } from "../src/reading/PdfView";

const mocks = vi.hoisted(() => ({
  task: {
    promise: new Promise(() => {}),
    destroy: vi.fn(async () => {}),
    onPassword: (_update: (password: string) => void, _reason: number) => {},
  },
}));
vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: {},
  getDocument: () => mocks.task,
  TextLayer: class {},
}));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("requests a PDF password, clears submitted secrets and ignores callbacks after disposal", async () => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  const update = vi.fn();
  const view = render(
    <PdfView data={btoa("%PDF-fixture")} target="protected.pdf" />,
  );
  act(() => mocks.task.onPassword(update, 1));
  const input = screen.getByLabelText("Пароль PDF");
  fireEvent.change(input, { target: { value: "wrong" } });
  fireEvent.click(screen.getByRole("button", { name: "Открыть PDF" }));
  expect(update).toHaveBeenCalledWith("wrong");
  expect(input).toHaveProperty("value", "");
  act(() => mocks.task.onPassword(update, 2));
  expect(screen.getByRole("alert").textContent).toContain("Неверный пароль");
  const callback = mocks.task.onPassword;
  view.unmount();
  expect(mocks.task.destroy).toHaveBeenCalled();
  act(() => callback(update, 2));
  expect(screen.queryByLabelText("Пароль PDF")).toBeNull();
});
