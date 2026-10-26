import {
  useEffect,
  useLayoutEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
export function Popover({
  label,
  title,
  icon,
  children,
  disabled = false,
  className = "",
  triggerClassName = "icon-button",
  above = false,
}: {
  label: string;
  title?: string;
  icon: ReactNode;
  children: ReactNode;
  disabled?: boolean;
  className?: string;
  triggerClassName?: string;
  above?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      if (!trigger.current || !layer.current) return;
      const anchor = trigger.current.getBoundingClientRect();
      const popup = layer.current.getBoundingClientRect();
      const below = innerHeight - anchor.bottom - 5;
      const over = anchor.top - 5;
      const upwards = above
        ? over >= popup.height || over > below
        : below < popup.height && over > below;
      setPosition({
        left: Math.max(
          8,
          Math.min(
            innerWidth - popup.width - 8,
            above ? anchor.left : anchor.right - popup.width,
          ),
        ),
        top: Math.max(
          8,
          Math.min(
            innerHeight - popup.height - 8,
            upwards ? anchor.top - popup.height - 5 : anchor.bottom + 5,
          ),
        ),
      });
    };
    place();
    const observer =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(place) : null;
    if (layer.current) observer?.observe(layer.current);
    if (trigger.current) observer?.observe(trigger.current);
    window.addEventListener("resize", place);
    document.addEventListener("scroll", place, true);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", place);
      document.removeEventListener("scroll", place, true);
    };
  }, [open, above]);
  useEffect(() => {
    if (!open) return;
    document.dispatchEvent(new CustomEvent("aether:menu-open", { detail: id }));
    const other = (event: Event) => {
      if ((event as CustomEvent).detail !== id) setOpen(false);
    };
    const outside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !root.current?.contains(event.target) &&
        !layer.current?.contains(event.target)
      )
        setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !document.querySelector("dialog[open]")) {
        event.preventDefault();
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    document.addEventListener("aether:menu-open", other);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
      document.removeEventListener("aether:menu-open", other);
    };
  }, [open, id]);
  return (
    <div
      className={`popover ${above ? "popover-above" : ""} ${className}`}
      ref={root}
    >
      <button
        ref={trigger}
        className={triggerClassName}
        aria-label={label}
        data-tooltip={title ?? label}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (open && event.key === "Tab" && !event.shiftKey) {
            event.preventDefault();
            layer.current
              ?.querySelector<HTMLButtonElement>("button:not(:disabled)")
              ?.focus();
          }
        }}
      >
        {icon}
      </button>
      {open &&
        createPortal(
          <div
            className={`popover-layer ${className}`}
            ref={layer}
            style={position}
          >
            <div
              className="popover-panel"
              id={id}
              role="group"
              aria-label={label}
              onClick={(event) => {
                if (
                  event.target instanceof Element &&
                  event.target.closest("button")
                )
                  setOpen(false);
              }}
            >
              {children}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
