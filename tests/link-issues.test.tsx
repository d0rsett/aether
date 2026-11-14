import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { LinkIssues } from "../src/components/LinkIssues";
import { api } from "../src/services/api";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("navigates to the exact source and retains the unresolved link target", async () => {
  vi.spyOn(api, "linkIssues").mockResolvedValue({
    items: [
      {
        source: "Sources/Note.md",
        target: "Missing#Section|Alias",
        line: 14,
        kind: "missing",
        candidates: [],
      },
      {
        source: "Other/Note.md",
        target: "Ambiguous",
        line: 8,
        kind: "ambiguous",
        candidates: ["One/Ambiguous.md", "Two/Ambiguous.md"],
      },
    ],
    hasMore: false,
  });
  const open = vi.fn(),
    resolve = vi.fn();
  render(
    <LinkIssues
      vaultId="vault"
      revision={1}
      onOpen={open}
      onResolve={resolve}
    />,
  );
  fireEvent.click(
    await screen.findByRole("button", { name: "Missing#Section|Alias" }),
  );
  expect(open).toHaveBeenLastCalledWith("Sources/Note.md", 14);
  fireEvent.click(screen.getByRole("button", { name: "Создать заметку" }));
  expect(resolve).toHaveBeenCalledWith(
    "Sources/Note.md",
    "Missing#Section|Alias",
  );
  fireEvent.click(screen.getByText("Возможные заметки", { exact: false }));
  fireEvent.click(screen.getByRole("button", { name: "Two/Ambiguous.md" }));
  expect(open).toHaveBeenLastCalledWith("Two/Ambiguous.md", 1);
});

it("keeps failures recoverable without showing raw host errors", async () => {
  const request = vi
    .spyOn(api, "linkIssues")
    .mockRejectedValueOnce(new Error("internal database path"))
    .mockResolvedValue({ items: [], hasMore: false });
  render(
    <LinkIssues
      vaultId="vault"
      revision={1}
      onOpen={vi.fn()}
      onResolve={vi.fn()}
    />,
  );
  await screen.findByRole("alert");
  expect(screen.queryByText("internal database path")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Повторить" }));
  await screen.findByText("Все связи на месте");
  expect(request).toHaveBeenCalledTimes(2);
});
