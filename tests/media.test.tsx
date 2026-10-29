import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { LocalMedia } from "../src/reading/LocalMedia";
import { api } from "../src/services/api";
const context = {
  vaultId: "v",
  path: "Note.md",
  onWiki: vi.fn(),
  onError: vi.fn(),
};
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it("loads visible media and releases object URLs on hide", async () => {
  const read = vi
    .spyOn(api, "readMedia")
    .mockResolvedValue({ mime: "audio/wav", data: btoa("RIFF0000WAVE") });
  const create = vi.fn(() => "blob:local-media"),
    revoke = vi.fn();
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: create,
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: revoke,
  });
  render(<LocalMedia target="sound.wav" wiki context={context} />);
  await waitFor(() =>
    expect(screen.getByLabelText("Аудио: sound.wav").getAttribute("src")).toBe(
      "blob:local-media",
    ),
  );
  expect(read).toHaveBeenCalledWith("v", "Note.md", "sound.wav", true);
  fireEvent.click(screen.getByRole("button", { name: "Скрыть просмотр" }));
  expect(revoke).toHaveBeenCalledWith("blob:local-media");
});
it("ignores late reads after the source changes and reports failures", async () => {
  let complete: ((value: { mime: string; data: string }) => void) | undefined;
  vi.spyOn(api, "readMedia")
    .mockImplementationOnce(
      () =>
        new Promise((done) => {
          complete = done;
        }),
    )
    .mockRejectedValueOnce(new Error("Вложение не найдено."));
  const { rerender, container } = render(
    <LocalMedia target="old.wav" wiki context={context} />,
  );
  rerender(<LocalMedia target="new.wav" wiki context={context} />);
  await screen.findByRole("alert");
  complete?.({ mime: "audio/wav", data: btoa("RIFF0000WAVE") });
  await waitFor(() => expect(container.querySelector("audio")).toBeNull());
  expect(screen.getByRole("alert").textContent).toContain(
    "Вложение не найдено",
  );
});
