import { useRef, useState } from "react";

export function usePaneWidth(
  side: "left" | "right",
  fallback: number,
  min: number,
) {
  const [width, setWidth] = useState(() => {
    try {
      const stored = Number(localStorage.getItem(`aether.ui.${side}Width`));
      return Number.isFinite(stored) && stored >= min
        ? Math.min(420, stored)
        : fallback;
    } catch {
      return fallback;
    }
  });
  const update = (next: number) => {
    setWidth(next);
    try {
      localStorage.setItem(`aether.ui.${side}Width`, String(next));
    } catch {
      /* Optional persistence. */
    }
  };
  return [width, update] as const;
}

export function PaneResizeHandle({
  side,
  width,
  minimum,
  defaultWidth,
  onWidth,
  onCollapse,
}: {
  side: "left" | "right";
  width: number;
  minimum: number;
  defaultWidth: number;
  onWidth: (width: number) => void;
  onCollapse: () => void;
}) {
  const drag = useRef<{
    x: number;
    width: number;
    previous: number;
    candidate: number;
    maximum: number;
  } | null>(null);
  const [dragging, setDragging] = useState(false);
  const limit = (node: HTMLElement) => {
    const pane = node.parentElement!.getBoundingClientRect().width;
    const main = node
      .closest(".workspace-shell")!
      .querySelector(".main-pane")!
      .getBoundingClientRect().width;
    return Math.max(minimum, Math.min(420, pane + main - 320));
  };
  const finish = (cancel: boolean) => {
    const current = drag.current;
    if (!current) return;
    drag.current = null;
    setDragging(false);
    if (cancel || current.candidate < minimum) onWidth(current.previous);
    if (!cancel && current.candidate < minimum) onCollapse();
  };
  return (
    <div
      className={`pane-resizer ${side} ${dragging ? "dragging" : ""}`}
      role="separator"
      tabIndex={0}
      aria-orientation="vertical"
      aria-label={
        side === "left" ? "Ширина левой панели" : "Ширина правой панели"
      }
      aria-valuemin={minimum}
      aria-valuemax={420}
      aria-valuenow={Math.round(width)}
      data-tooltip="Потяните для изменения ширины; уменьшите до края, чтобы скрыть. Двойной щелчок — сброс."
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.focus();
        event.currentTarget.setPointerCapture(event.pointerId);
        const actual =
          event.currentTarget.parentElement!.getBoundingClientRect().width;
        drag.current = {
          x: event.clientX,
          width: actual,
          previous: width,
          candidate: actual,
          maximum: limit(event.currentTarget),
        };
        setDragging(true);
      }}
      onPointerMove={(event) => {
        if (!drag.current) return;
        const current = drag.current;
        current.candidate =
          current.width +
          (event.clientX - current.x) * (side === "left" ? 1 : -1);
        onWidth(
          Math.max(minimum, Math.min(current.maximum, current.candidate)),
        );
      }}
      onPointerUp={() => finish(false)}
      onPointerCancel={() => finish(true)}
      onLostPointerCapture={() => finish(true)}
      onDoubleClick={(event) =>
        onWidth(Math.min(defaultWidth, limit(event.currentTarget)))
      }
      onKeyDown={(event) => {
        if (event.key === "Escape" && drag.current) {
          event.preventDefault();
          finish(true);
          return;
        }
        if (event.key === "Home") {
          event.preventDefault();
          onCollapse();
          return;
        }
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        const actual =
          event.currentTarget.parentElement!.getBoundingClientRect().width;
        const delta =
          (event.key === "ArrowRight" ? 1 : -1) *
          (side === "left" ? 1 : -1) *
          (event.shiftKey ? 40 : 10);
        if (actual + delta < minimum) onCollapse();
        else onWidth(Math.min(limit(event.currentTarget), actual + delta));
      }}
    />
  );
}
