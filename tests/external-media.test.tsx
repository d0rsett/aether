import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { api, type RenderNode } from "../src/services/api";
import { renderNode } from "../src/reading/ReadingView";
import { renderHtmlNodes } from "../src/reading/html";
import { externalKind } from "../src/reading/ExternalMedia";

const context = {
  vaultId: "v",
  path: "Note.md",
  onWiki: vi.fn(),
  onError: vi.fn(),
};
const node = (kind: string, text = "", target = ""): RenderNode => ({
  kind,
  text,
  target,
  from: 0,
  to: 1,
  line: 1,
  endLine: 1,
  level: 0,
  children: [],
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("loads an external image only when requested and clears it on hide", async () => {
  const read = vi
    .spyOn(api, "readExternalMedia")
    .mockResolvedValue({ mime: "image/png", data: "iVBORw0KGgo=" });
  const image = {
    ...node("image", "", "https://example.org/image?id=4"),
    children: [node("text", "250")],
  };
  const { container } = render(<>{renderNode(image, context)}</>);
  expect(read).not.toHaveBeenCalled();
  expect(container.querySelector("img")).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: "Загрузить изображение" }),
  );
  const picture = await screen.findByRole("img");
  expect(picture.getAttribute("src")).toBe(
    "data:image/png;base64,iVBORw0KGgo=",
  );
  expect(picture.style.width).toBe("250px");
  expect(read).toHaveBeenCalledWith(
    "v",
    "https://example.org/image?id=4",
    "image",
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Скрыть внешнее вложение" }),
  );
  expect(container.querySelector("img")).toBeNull();
});
it("ignores late responses after the vault, URL or component changes", async () => {
  let finish: ((value: { mime: string; data: string }) => void) | undefined;
  vi.spyOn(api, "readExternalMedia").mockImplementation(
    () =>
      new Promise((done) => {
        finish = done;
      }),
  );
  const image = node("image", "", "https://example.org/old.png");
  const { rerender, container } = render(<>{renderNode(image, context)}</>);
  fireEvent.click(
    screen.getByRole("button", { name: "Загрузить изображение" }),
  );
  rerender(
    <>
      {renderNode(node("image", "", "https://example.org/new.png"), context)}
    </>,
  );
  finish?.({ mime: "image/png", data: "iVBORw0KGgo=" });
  await waitFor(() => expect(container.querySelector("img")).toBeNull());
});
it("handles direct audio/video/PDF urls and leaves remote pages inert", async () => {
  expect(externalKind("https://host/file.mp4?token=x")).toBe("video");
  expect(externalKind("https://host/file.ogg?token=x")).toBe("audio");
  expect(externalKind("https://host/file.pdf#page=2")).toBe("pdf");
  const open = vi.spyOn(api, "openExternal").mockResolvedValue(undefined);
  const read = vi
    .spyOn(api, "readExternalMedia")
    .mockResolvedValue({ mime: "video/webm", data: "GkXfoA==" });
  const html = node(
    "literalHtml",
    '<iframe src="https://example.org/page"></iframe><video src="https://example.org/a.webm" autoplay></video>',
  );
  const { container } = render(<>{renderHtmlNodes([html], context)}</>);
  expect(container.querySelector("iframe,video")).toBeNull();
  expect(open).not.toHaveBeenCalled();
  expect(read).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Открыть в браузере" }));
  expect(open).toHaveBeenCalledWith("https://example.org/page");
  fireEvent.click(screen.getByRole("button", { name: "Загрузить видео" }));
  await waitFor(() =>
    expect(read).toHaveBeenCalledWith(
      "v",
      "https://example.org/a.webm",
      "video",
    ),
  );
  const video = await screen.findByLabelText(
    "Видео: https://example.org/a.webm",
  );
  expect(video.hasAttribute("autoplay")).toBe(false);
});
