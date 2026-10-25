import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { Highlighted } from "../src/search/SearchPanel";

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
