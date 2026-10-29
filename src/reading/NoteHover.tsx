import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { NoteEmbed } from "./NoteEmbed";
import type { RenderContext } from "./ReadingView";

export function NoteHover({
  target,
  wiki,
  context,
  children,
}: {
  target: string;
  wiki: boolean;
  context: RenderContext;
  children: ReactNode;
}) {
  const host = useRef<HTMLSpanElement>(null);
  const popup = useRef<HTMLElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [position, setPosition] = useState<{
    left: number;
    top: number;
  } | null>(null);
  const close = () => {
    clearTimeout(timer.current);
    setPosition(null);
  };
  const show = () => {
    clearTimeout(timer.current);
    if (position) return;
    timer.current = setTimeout(() => {
      const rect = host.current?.getBoundingClientRect();
      if (rect)
        setPosition({
          left: Math.max(8, Math.min(rect.left, window.innerWidth - 408)),
          top: Math.max(8, Math.min(rect.bottom + 6, window.innerHeight - 320)),
        });
    }, 450);
  };
  const leave = (event: { relatedTarget: EventTarget | null }) => {
    clearTimeout(timer.current);
    if (
      event.relatedTarget instanceof Node &&
      (host.current?.contains(event.relatedTarget) ||
        popup.current?.contains(event.relatedTarget))
    )
      return;
    timer.current = setTimeout(() => setPosition(null), 180);
  };
  useEffect(() => {
    if (!position || !popup.current) return;
    const place = () => {
      const anchor = host.current?.getBoundingClientRect(),
        card = popup.current?.getBoundingClientRect();
      if (!anchor || !card) return;
      const left = Math.max(
        12,
        Math.min(anchor.left, window.innerWidth - card.width - 12),
      );
      const below = anchor.bottom + 8;
      const top =
        below + card.height <= window.innerHeight - 12
          ? below
          : Math.max(12, anchor.top - card.height - 8);
      setPosition((previous) =>
        previous?.left === left && previous.top === top
          ? previous
          : { left, top },
      );
    };
    const observer = new ResizeObserver(place);
    observer.observe(popup.current);
    place();
    return () => observer.disconnect();
  }, [!!position, target, context.path]);
  useEffect(() => {
    setPosition(null);
    return () => clearTimeout(timer.current);
  }, [target, context.path]);
  useEffect(() => {
    if (!position) return;
    const key = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", key);
    window.addEventListener("resize", close);
    const scroll = (event: Event) => {
      if (!(
        event.target instanceof Element && event.target.closest(".note-hover")
      ))
        close();
    };
    window.addEventListener("scroll", scroll, true);
    return () => {
      clearTimeout(timer.current);
      window.removeEventListener("keydown", key);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", scroll, true);
    };
  }, [!!position, target, context.path]);
  return (
    <span
      ref={host}
      onPointerEnter={show}
      onPointerLeave={leave}
      onFocus={show}
      onBlur={leave}
    >
      {children}
      {position &&
        createPortal(
          <section
            ref={popup}
            role="region"
            aria-label="Предпросмотр ссылки"
            className="note-hover"
            style={position}
            onPointerEnter={() => clearTimeout(timer.current)}
            onPointerLeave={leave}
            onFocus={() => clearTimeout(timer.current)}
            onBlur={leave}
          >
            <NoteEmbed
              preview
              target={target}
              label={target}
              wiki={wiki}
              context={{
                ...context,
                onTask: undefined,
                table: undefined,
                tableFor: undefined,
              }}
            />
          </section>,
          document.body,
        )}
    </span>
  );
}
