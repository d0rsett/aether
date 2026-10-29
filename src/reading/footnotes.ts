const returns = new WeakMap<HTMLElement, HTMLElement>();
function scope(element: HTMLElement) {
  return element.closest<HTMLElement>(
    ".note-transclusion-body, .reading-document",
  );
}
export function followFootnote(
  button: HTMLElement,
  target: string,
  back = false,
) {
  const root = scope(button);
  if (!root) return;
  const destination = back
    ? (returns.get(root) ??
      [...root.querySelectorAll<HTMLElement>("[data-footnote-ref]")].find(
        (element) =>
          element.dataset.footnoteRef === target && scope(element) === root,
      ))
    : [...root.querySelectorAll<HTMLElement>("[data-footnote]")].find(
        (element) =>
          element.dataset.footnote === target && scope(element) === root,
      );
  if (!destination?.isConnected) return;
  if (!back) returns.set(root, button);
  destination.scrollIntoView({ block: "center" });
  destination.focus({ preventScroll: true });
}
