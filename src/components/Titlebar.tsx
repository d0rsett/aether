import { t, useLocale } from "../i18n";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Copy, Minus, Square, X } from "lucide-react";
import { desktop, errorMessage } from "../services/api";
import { platform } from "../services/platform";
interface Props {
  leading?: ReactNode;
  children?: ReactNode;
  onError: (message: string) => void;
}
/** Window chrome uses the normal close request so workspace draft protection runs. */
export function Titlebar({ leading, children, onError }: Props) {
  useLocale();
  const nativeMac = platform.macOS;
  const [appWindow] = useState(() => (desktop ? getCurrentWindow() : null));
  const [maximized, setMaximized] = useState(false);
  const pending = useRef(false);
  useEffect(() => {
    if (!appWindow || nativeMac) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    const sync = async () => {
      try {
        const value = await appWindow.isMaximized();
        if (!disposed) setMaximized(value);
      } catch (error) {
        if (!disposed) onError(errorMessage(error));
      }
    };
    void sync();
    void appWindow
      .onResized(() => {
        void sync();
      })
      .then((cleanup) => {
        if (disposed) cleanup();
        else unlisten = cleanup;
      })
      .catch((error) => {
        if (!disposed) onError(errorMessage(error));
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [appWindow, nativeMac, onError]);
  const run = async (action: "minimize" | "maximize" | "close") => {
    if (!appWindow || pending.current) return;
    pending.current = true;
    try {
      if (action === "minimize") await appWindow.minimize();
      if (action === "maximize") {
        await appWindow.toggleMaximize();
        setMaximized(await appWindow.isMaximized());
      }
      if (action === "close") await appWindow.close();
    } catch (error) {
      onError(errorMessage(error));
    } finally {
      pending.current = false;
    }
  };
  return (
    <header
      className={`app-header titlebar${nativeMac ? " titlebar-macos" : ""}`}
      data-tauri-drag-region
    >
      <div className="titlebar-leading" data-tauri-drag-region>
        {leading}
      </div>
      {children ?? (
        <div className="titlebar-drag-space" data-tauri-drag-region />
      )}
      {!nativeMac && (
        <div
          className="window-controls"
          role="group"
          aria-label={t("Управление окном")}
        >
          <button
            className="window-control"
            disabled={!desktop}
            aria-label={t("Свернуть окно")}
            data-tooltip={t("Свернуть")}
            onClick={() => void run("minimize")}
          >
            <Minus size={15} strokeWidth={1.5} />
          </button>
          <button
            className="window-control"
            disabled={!desktop}
            aria-label={
              maximized ? t("Восстановить размер окна") : t("Развернуть окно")
            }
            data-tooltip={
              maximized ? t("Восстановить размер") : t("Развернуть")
            }
            onClick={() => void run("maximize")}
          >
            {maximized ? (
              <Copy size={13} strokeWidth={1.5} />
            ) : (
              <Square size={13} strokeWidth={1.5} />
            )}
          </button>
          <button
            className="window-control window-close"
            disabled={!desktop}
            aria-label={t("Закрыть окно")}
            data-tooltip={t("Закрыть")}
            onClick={() => void run("close")}
          >
            <X size={17} strokeWidth={1.5} />
          </button>
        </div>
      )}
    </header>
  );
}
