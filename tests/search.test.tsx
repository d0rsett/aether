import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { Highlighted, SearchPanel } from "../src/search/SearchPanel";
import { api } from "../src/services/api";

vi.mock("../src/services/api", () => ({
  api: { search: vi.fn() },
  errorMessage: String,
}));

it("shows pagination only when needed and keeps access to the previous page", async () => {
  const hit = { path: "Note.md", title: "Note", snippet: "text" };
  vi.mocked(api.search).mockResolvedValue({ hits: [hit], hasMore: false });
  const { rerender } = render(
    <SearchPanel vaultId="one" status={null} onOpen={() => {}} />,
  );
  await screen.findByText("text");
  expect(screen.queryByRole("button", { name: "Далее" })).toBeNull();
  vi.mocked(api.search).mockResolvedValueOnce({
    hits: Array.from({ length: 50 }, (_, index) => ({
      ...hit,
      path: `${index}.md`,
    })),
    hasMore: true,
  });
  rerender(<SearchPanel vaultId="two" status={null} onOpen={() => {}} />);
  await screen.findByText("1–50");
  await userEvent.click(screen.getByRole("button", { name: "Далее" }));
  await screen.findByText("51–51");
  expect(
    (screen.getByRole("button", { name: "Назад" }) as HTMLButtonElement)
      .disabled,
  ).toBe(false);
  await userEvent.click(screen.getByRole("button", { name: "Назад" }));
  await waitFor(() =>
    expect(screen.queryByRole("button", { name: "Далее" })).toBeNull(),
  );
});

afterEach(cleanup);
it("renders SQLite highlights as text without executing note HTML", () => {
  const { container } = render(
    <Highlighted
      text={"Before \u0001<img src=x onerror=alert(1)>\u0002 after"}
    />,
  );
  expect(container.querySelector("img")).toBeNull();
  expect(container.querySelector("mark")?.textContent).toBe(
    "<img src=x onerror=alert(1)>",
  );
  expect(container.textContent).toBe(
    "Before <img src=x onerror=alert(1)> after",
  );
});
