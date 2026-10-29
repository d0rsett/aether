import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { InlineFootnote } from "../src/reading/InlineFootnote";

afterEach(cleanup);
it("opens formatted inline footnote text and closes with focus on Escape", () => {
  render(
    <p>
      Text{" "}
      <InlineFootnote number={2}>
        Пример <strong>важного</strong> текста
      </InlineFootnote>
    </p>,
  );
  const trigger = screen.getByRole("button", {
    name: "Показать встроенную сноску 2",
  });
  expect(screen.queryByRole("note")).toBeNull();
  fireEvent.click(trigger);
  expect(screen.getByRole("note").querySelector("strong")?.textContent).toBe(
    "важного",
  );
  expect(trigger.getAttribute("aria-expanded")).toBe("true");
  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.queryByRole("note")).toBeNull();
  expect(document.activeElement).toBe(trigger);
});
