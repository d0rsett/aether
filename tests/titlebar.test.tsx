import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Titlebar } from "../src/components/Titlebar";

const native = vi.hoisted(() => ({
  maximized: false,
  resize: null as (() => void) | null,
  minimize: vi.fn(),
  close: vi.fn(),
  destroy: vi.fn(),
  toggleMaximize: vi.fn(),
  isMaximized: vi.fn(),
  onResized: vi.fn(),
}));
vi.mock("../src/services/api", () => ({
  desktop: true,
  errorMessage: (error: unknown) =>
    error instanceof Error ? error.message : String(error),
}));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => native }));
const props = {
  onError: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  native.maximized = false;
  native.resize = null;
  native.minimize.mockResolvedValue(undefined);
  native.close.mockResolvedValue(undefined);
  native.isMaximized.mockImplementation(async () => native.maximized);
  native.toggleMaximize.mockImplementation(async () => {
    native.maximized = !native.maximized;
  });
  native.onResized.mockImplementation(async (callback: () => void) => {
    native.resize = callback;
    return vi.fn();
  });
});
afterEach(cleanup);

it("uses a close request, preserving the workspace unsaved-change guard", async () => {
  render(<Titlebar {...props} />);
  await userEvent.click(screen.getByRole("button", { name: "Закрыть окно" }));
  expect(native.close).toHaveBeenCalledOnce();
  expect(native.destroy).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "Свернуть окно" }));
  expect(native.minimize).toHaveBeenCalledOnce();
});

it("tracks maximize/restore, including resize events from native window management", async () => {
  render(<Titlebar {...props} />);
  await userEvent.click(
    screen.getByRole("button", { name: "Развернуть окно" }),
  );
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Восстановить размер окна" }),
    ).toBeTruthy(),
  );
  native.maximized = false;
  await act(async () => native.resize?.());
  expect(screen.getByRole("button", { name: "Развернуть окно" })).toBeTruthy();
});

it("reports native window command failures without crashing", async () => {
  native.minimize.mockRejectedValue(new Error("Window command denied"));
  render(<Titlebar {...props} />);
  await userEvent.click(screen.getByRole("button", { name: "Свернуть окно" }));
  await waitFor(() =>
    expect(props.onError).toHaveBeenCalledWith("Window command denied"),
  );
});
