import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export function TooltipLayer() {
  const id = useId();
  const [active, setActive] = useState<{
    target: HTMLElement;
    text: string;
  } | null>(null);
  const [position, setPosition] = useState<{
    left: number;
    top: number;
  } | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let target: HTMLElement | null = null;
    const hide = () => {
      clearTimeout(timer);
      target = null;
      setActive(null);
      setPosition(null);
    };
    const show = (event: Event) => {
      if (!(event.target instanceof Element)) return;
      const next = event.target.closest<HTMLElement>("[data-tooltip]");
      if (next === target) return;
      hide();
      const text = next?.dataset.tooltip?.trim();
      if (!next || !text) return;
      target = next;
      timer = setTimeout(
        () => {
          if (next.isConnected) setActive({ target: next, text });
        },
        event.type === "focusin" ? 200 : 450,
      );
    };
    const leave = (event: Event) => {
      const related = (event as MouseEvent | FocusEvent).relatedTarget;
      if (related instanceof Node && target?.contains(related)) return;
      hide();
    };
    document.addEventListener("pointerover", show);
    document.addEventListener("focusin", show);
    document.addEventListener("pointerout", leave);
    document.addEventListener("focusout", leave);
    document.addEventListener("pointerdown", hide, true);
    document.addEventListener("keydown", hide, true);
    document.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    window.addEventListener("blur", hide);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("pointerover", show);
      document.removeEventListener("focusin", show);
      document.removeEventListener("pointerout", leave);
      document.removeEventListener("focusout", leave);
      document.removeEventListener("pointerdown", hide, true);
      document.removeEventListener("keydown", hide, true);
      document.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
      window.removeEventListener("blur", hide);
    };
  }, []);
  useLayoutEffect(() => {
    if (!active || !panel.current) return;
    const anchor = active.target.getBoundingClientRect(),
      rect = panel.current.getBoundingClientRect();
    setPosition({
      left: Math.max(
        8,
        Math.min(
          innerWidth - rect.width - 8,
          anchor.left + (anchor.width - rect.width) / 2,
        ),
      ),
      top: Math.max(
        8,
        Math.min(
          innerHeight - rect.height - 8,
          anchor.top >= rect.height + 16
            ? anchor.top - rect.height - 8
            : anchor.bottom + 8,
        ),
      ),
    });
    const previous = active.target.getAttribute("aria-describedby");
    active.target.setAttribute(
      "aria-describedby",
      [previous, id].filter(Boolean).join(" "),
    );
    return () => {
      if (previous) active.target.setAttribute("aria-describedby", previous);
      else active.target.removeAttribute("aria-describedby");
    };
  }, [active, id]);
  if (!active) return null;
  const split = active.text.lastIndexOf(" · ");
  const hasShortcut =
    split >= 0 && /^(Ctrl|Alt|Shift|⌘)/.test(active.text.slice(split + 3));
  return createPortal(
    <div
      ref={panel}
      id={id}
      role="tooltip"
      className="app-tooltip"
      style={{
        left: position?.left ?? 0,
        top: position?.top ?? 0,
        visibility: position ? "visible" : "hidden",
      }}
    >
      <span>{hasShortcut ? active.text.slice(0, split) : active.text}</span>
      {hasShortcut && <kbd>{active.text.slice(split + 3)}</kbd>}
    </div>,
    active.target.closest("dialog") ?? document.body,
  );
}
