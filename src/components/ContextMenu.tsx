import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Check } from "lucide-react";

export interface ContextAction {
  label: string;
  run: () => void | Promise<unknown>;
  disabled?: boolean;
  danger?: boolean;
  shortcut?: string;
  icon?: ReactNode;
  divider?: boolean;
  heading?: string;
  checked?: boolean;
}

export function useContextMenu(onError?: (message: string) => void) {
  const id = useId();
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    label: string;
    actions: ContextAction[];
    origin: HTMLElement | null;
  } | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const close = (restore = false) => {
    if (restore) menu?.origin?.focus({ preventScroll: true });
    setMenu(null);
  };
  const show = (
    event: MouseEvent<HTMLElement>,
    label: string,
    actions: ContextAction[],
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    const origin = event.currentTarget.matches(
      "button, input, textarea, [tabindex]",
    )
      ? event.currentTarget
      : (document.activeElement as HTMLElement | null);
    document.dispatchEvent(new CustomEvent("aether:menu-open", { detail: id }));
    setMenu({
      x: event.clientX || rect.left + 12,
      y: event.clientY || rect.top + 12,
      label,
      actions,
      origin,
    });
  };
  useLayoutEffect(() => {
    if (!menu || !panel.current) return;
    const rect = panel.current.getBoundingClientRect();
    setPosition({
      left: Math.max(8, Math.min(menu.x, innerWidth - rect.width - 8)),
      top: Math.max(8, Math.min(menu.y, innerHeight - rect.height - 8)),
    });
    panel.current
      .querySelector<HTMLButtonElement>("button:not(:disabled)")
      ?.focus({ preventScroll: true });
  }, [menu]);
  useEffect(() => {
    if (!menu) return;
    const outside = (event: Event) => {
      if (
        event.target instanceof Node &&
        !panel.current?.contains(event.target)
      )
        setMenu(null);
    };
    const other = (event: Event) => {
      if ((event as CustomEvent).detail !== id) setMenu(null);
    };
    const dismiss = () => setMenu(null);
    document.addEventListener("pointerdown", outside);
    document.addEventListener("scroll", outside, true);
    document.addEventListener("aether:menu-open", other);
    window.addEventListener("resize", dismiss);
    window.addEventListener("blur", dismiss);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("scroll", outside, true);
      document.removeEventListener("aether:menu-open", other);
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("blur", dismiss);
    };
  }, [menu, id]);
  return {
    show,
    menu:
      menu &&
      createPortal(
        <div className="popover-layer context-menu-layer" style={position}>
          <div
            className="popover-panel"
            ref={panel}
            role="menu"
            aria-label={menu.label}
            onContextMenu={(event) => event.preventDefault()}
            onKeyDown={(event) => {
              if (event.key === "Escape" || event.key === "Tab") {
                event.preventDefault();
                event.stopPropagation();
                close(true);
                return;
              }
              if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key))
                return;
              event.preventDefault();
              const buttons = Array.from(
                panel.current!.querySelectorAll<HTMLButtonElement>(
                  "button:not(:disabled)",
                ),
              );
              if (!buttons.length) return;
              const current = buttons.indexOf(
                document.activeElement as HTMLButtonElement,
              );
              const next =
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? buttons.length - 1
                    : (current +
                        (event.key === "ArrowDown" ? 1 : -1) +
                        buttons.length) %
                      buttons.length;
              buttons[next].focus();
            }}
          >
            {menu.actions.map((action) => (
              <ContextMenuItem
                key={action.label}
                action={action}
                select={() => {
                  close(true);
                  Promise.resolve()
                    .then(action.run)
                    .catch((error) =>
                      onError?.(
                        error instanceof Error ? error.message : String(error),
                      ),
                    );
                }}
              />
            ))}
          </div>
        </div>,
        document.body,
      ),
  };
}

function ContextMenuItem({
  action,
  select,
}: {
  action: ContextAction;
  select: () => void;
}) {
  return (
    <>
      {action.divider && <hr role="separator" />}
      {action.heading && (
        <div className="context-menu-heading">{action.heading}</div>
      )}
      <button
        role={action.checked === undefined ? "menuitem" : "menuitemcheckbox"}
        aria-checked={action.checked}
        className={action.danger ? "danger-action" : undefined}
        disabled={action.disabled}
        onClick={select}
      >
        {action.icon}
        <span>{action.label}</span>
        {action.checked && <Check size={13} />}
        {action.shortcut && <kbd>{action.shortcut}</kbd>}
      </button>
    </>
  );
}
