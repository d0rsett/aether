import { t, useLocale } from "../i18n";
import { useEffect, useRef, useState, type MouseEvent } from "react";
import {
  ChevronDown,
  ChevronRight,
  FileText,
  PanelsTopLeft,
  Folder,
  FolderOpen,
  LoaderCircle,
  Image as ImageIcon,
} from "lucide-react";
import { api, errorMessage, type FileEntry } from "../services/api";
import { imageDragType, imageExtension } from "../services/images";
import {
  canvasFileDragType,
  markdownFile,
  mediaFile,
} from "../services/canvasFiles";
import { entryIconChoices, type EntryIcons } from "./entryIcons";
interface Props {
  vaultId: string;
  path?: string;
  active: string | null;
  refresh: number;
  onOpen: (path: string) => void;
  onFolder: (path: string) => void;
  icons?: EntryIcons;
  includeFile?: (path: string) => boolean;
  onContext?: (event: MouseEvent<HTMLElement>, entry: FileEntry) => void;
  dragged?: string | null;
  onDrag?: (path: string | null) => void;
  onMove?: (source: string, directory: string) => void;
  editPath?: string | null;
  busy?: boolean;
  onRename?: (
    path: string,
    name: string,
    directory: boolean,
  ) => Promise<boolean>;
  onCancelRename?: () => void;
  onError?: (message: string) => void;
}
export function FileTree({
  vaultId,
  path = "",
  active,
  refresh,
  onOpen,
  onFolder,
  icons,
  includeFile,
  onContext,
  dragged,
  onDrag,
  onMove,
  editPath,
  busy,
  onRename,
  onCancelRename,
  onError,
}: Props) {
  useLocale();
  const [entries, setEntries] = useState<FileEntry[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    void api
      .list(vaultId, path)
      .then((result) => {
        if (!cancelled) {
          setEntries(result);
          setError("");
        }
      })
      .catch((e) => {
        if (!cancelled) setError(errorMessage(e));
      });
    return () => {
      cancelled = true;
    };
  }, [vaultId, path, refresh]);
  if (error)
    return (
      <p className="tree-error" role="alert">
        {t(error)}
      </p>
    );
  if (!entries)
    return (
      <div className="tree-loading">
        <LoaderCircle size={14} className="spin" />
        {t(" Загрузка\u2026 ")}
      </div>
    );
  const listed = includeFile
    ? entries.filter((entry) => entry.isDirectory || includeFile(entry.path))
    : entries;
  if (!listed.length)
    return (
      <p className="tree-empty">
        {path ? t("Папка пуста") : t("Пока нет заметок")}
      </p>
    );
  return (
    <ul className="file-tree">
      {listed.map((entry) => (
        <TreeEntry
          key={entry.path}
          {...{
            entry,
            vaultId,
            active,
            refresh,
            onOpen,
            onFolder,
            icons,
            includeFile,
            onContext,
            dragged,
            onDrag,
            onMove,
            editPath,
            busy,
            onRename,
            onCancelRename,
            onError,
          }}
        />
      ))}
    </ul>
  );
}
function TreeEntry({
  entry,
  ...props
}: Omit<Props, "path"> & {
  entry: FileEntry;
}) {
  useLocale();
  const [expanded, setExpanded] = useState(false);
  const [over, setOver] = useState(false);
  const imageType = !entry.isDirectory ? imageExtension(entry.path) : null;
  const canvasType = !entry.isDirectory && /\.canvas$/i.test(entry.path);
  const customIcon = props.icons?.get(entry.path);
  const CustomIcon = customIcon ? entryIconChoices[customIcon][0] : undefined;
  const badge = imageType ?? (canvasType ? "CANVAS" : null);
  const displayName = entry.isDirectory
    ? entry.name
    : entry.name.replace(/\.(md|markdown|canvas)$/i, "");
  const noteType = !entry.isDirectory && markdownFile.test(entry.path);
  const mediaType = !entry.isDirectory && mediaFile.test(entry.path);
  const directory = entry.isDirectory
    ? entry.path
    : entry.path.split("/").slice(0, -1).join("/");
  const canDrop =
    !!props.dragged &&
    props.dragged !== entry.path &&
    props.dragged.split("/").slice(0, -1).join("/") !== directory;
  useEffect(() => {
    if (!over || !entry.isDirectory || expanded) return;
    const timer = window.setTimeout(() => setExpanded(true), 600);
    return () => window.clearTimeout(timer);
  }, [over, entry.isDirectory, expanded]);
  useEffect(() => {
    if (!props.dragged) setOver(false);
  }, [props.dragged]);
  useEffect(() => {
    if (entry.isDirectory && props.editPath?.startsWith(`${entry.path}/`))
      setExpanded(true);
  }, [props.editPath, entry.path, entry.isDirectory]);
  return (
    <li>
      {props.editPath === entry.path ? (
        <EntryNameEditor entry={entry} {...props} />
      ) : (
        <button
          className={`tree-item ${(props.editPath ?? props.active) === entry.path ? "selected" : ""} ${over && canDrop ? "drop-target" : ""} ${props.dragged === entry.path ? "is-dragging" : ""}`}
          draggable={!!props.onDrag && (noteType || !!imageType || mediaType)}
          aria-label={entry.isDirectory ? undefined : displayName}
          onDragStart={(event) => {
            if (entry.isDirectory) {
              event.preventDefault();
              return;
            }
            event.dataTransfer.setData(
              canvasFileDragType,
              JSON.stringify({ vaultId: props.vaultId, path: entry.path }),
            );
            if (imageType) {
              event.dataTransfer.setData(
                imageDragType,
                JSON.stringify({ vaultId: props.vaultId, path: entry.path }),
              );
              event.dataTransfer.effectAllowed = "copy";
              return;
            }
            if (mediaType) {
              event.dataTransfer.effectAllowed = "copy";
              return;
            }
            if (!noteType) return;
            event.dataTransfer.setData("application/x-aether-note", entry.path);
            event.dataTransfer.effectAllowed = "copyMove";
            props.onDrag?.(entry.path);
          }}
          onDragEnd={() => props.onDrag?.(null)}
          onDragOver={(event) => {
            if (!props.dragged) return;
            event.preventDefault();
            event.stopPropagation();
            event.dataTransfer.dropEffect = canDrop ? "move" : "none";
            setOver(canDrop);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(event) => {
            if (!props.dragged) return;
            event.preventDefault();
            event.stopPropagation();
            setOver(false);
            if (canDrop) props.onMove?.(props.dragged, directory);
            else props.onDrag?.(null);
          }}
          data-tooltip={entry.path}
          aria-expanded={entry.isDirectory ? expanded : undefined}
          onContextMenu={(event) => props.onContext?.(event, entry)}
          onClick={() => {
            if (entry.isDirectory) {
              setExpanded(!expanded);
              props.onFolder(entry.path);
            } else props.onOpen(entry.path);
          }}
        >
          {entry.isDirectory ? (
            <>
              {expanded ? (
                <ChevronDown size={13} />
              ) : (
                <ChevronRight size={13} />
              )}
              {CustomIcon ? (
                <CustomIcon className="tree-custom-icon" size={15} />
              ) : expanded ? (
                <FolderOpen size={15} />
              ) : (
                <Folder size={15} />
              )}
            </>
          ) : (
            <>
              <span className="tree-spacer" />
              {CustomIcon ? (
                <CustomIcon className="tree-custom-icon" size={15} />
              ) : imageType ? (
                <ImageIcon size={15} />
              ) : canvasType ? (
                <PanelsTopLeft size={15} />
              ) : (
                <FileText size={15} />
              )}
            </>
          )}
          <span className="tree-entry-name">{displayName}</span>
          {badge && (
            <span className="tree-file-type" aria-hidden="true">
              {badge}
            </span>
          )}
        </button>
      )}
      {entry.isDirectory && expanded && (
        <div
          className="tree-children"
          onDragOver={(event) => {
            if (!props.dragged) return;
            event.preventDefault();
            event.stopPropagation();
            const allowed =
              props.dragged.split("/").slice(0, -1).join("/") !== entry.path;
            event.dataTransfer.dropEffect = allowed ? "move" : "none";
            setOver(allowed);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(event) => {
            if (!props.dragged) return;
            event.preventDefault();
            event.stopPropagation();
            setOver(false);
            if (props.dragged.split("/").slice(0, -1).join("/") !== entry.path)
              props.onMove?.(props.dragged, entry.path);
            else props.onDrag?.(null);
          }}
        >
          <FileTree {...props} path={entry.path} />
        </div>
      )}
    </li>
  );
}
function EntryNameEditor({
  entry,
  busy,
  onRename,
  onCancelRename,
  onError,
}: Omit<Props, "path"> & {
  entry: FileEntry;
}) {
  useLocale();
  const original = entry.isDirectory
    ? entry.name
    : entry.name.replace(/\.[^./]+$/, "");
  const [name, setName] = useState(original);
  const input = useRef<HTMLInputElement>(null);
  const pending = useRef(false),
    cancelled = useRef(false);
  useEffect(() => {
    if (busy) return;
    const frame = requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.select();
    });
    return () => cancelAnimationFrame(frame);
  }, [busy]);
  const commit = () => {
    if (cancelled.current || pending.current || busy) return;
    if (name.trim() === original) {
      onCancelRename?.();
      return;
    }
    if (!name.trim() || /[\\/]/.test(name)) {
      onError?.(t("Введите имя без полного пути и разделителей папок."));
      return;
    }
    pending.current = true;
    void onRename?.(entry.path, name.trim(), entry.isDirectory).finally(() => {
      pending.current = false;
    });
  };
  return (
    <div className="tree-item is-editing">
      <span className="tree-spacer" />
      {entry.isDirectory ? <Folder size={15} /> : <FileText size={15} />}
      <input
        className="tree-name-input"
        ref={input}
        value={name}
        disabled={busy}
        aria-label={entry.isDirectory ? t("Имя папки") : t("Имя файла")}
        size={Math.min(32, Math.max(16, name.length + 1))}
        onChange={(event) => setName(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === "Enter") {
            event.preventDefault();
            commit();
          }
          if (event.key === "Escape") {
            event.preventDefault();
            cancelled.current = true;
            onCancelRename?.();
          }
        }}
      />
    </div>
  );
}
