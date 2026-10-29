import { t } from "../i18n";
import { Facet, type Extension } from "@codemirror/state";
import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { api, errorMessage } from "../services/api";
import { imageDragType, imageExtension } from "../services/images";
interface Config {
  vaultId: string;
  path: string;
  onError: (message: string) => void;
  onImported?: () => void;
}
const configuration = Facet.define<Config, Config>({
  combine: (values) => values[0],
});
const mimeExtensions: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/bmp": "bmp",
  "image/svg+xml": "svg",
};
function pastedName(file: File) {
  return t`Новое изображение.${mimeExtensions[file.type] ?? imageExtension(file.name)?.toLowerCase() ?? "png"}`;
}
function base64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = () =>
      reject(new Error(t`Не удалось прочитать ${file.name}`));
    reader.readAsDataURL(file);
  });
}
class AttachmentInput {
  destroyed = false;
  pending = new Set<{
    from: number;
    to: number;
    text: string;
  }>();
  queue: Promise<void> = Promise.resolve();
  constructor(readonly view: EditorView) {}
  update(update: ViewUpdate) {
    if (update.docChanged)
      for (const mark of this.pending) {
        mark.from = update.changes.mapPos(mark.from, -1);
        mark.to = update.changes.mapPos(mark.to, 1);
      }
  }
  destroy() {
    this.destroyed = true;
    this.pending.clear();
  }
  insert(
    files: File[],
    clipboard: boolean,
    position?: number,
    existing?: string,
  ) {
    const view = this.view,
      config = view.state.facet(configuration);
    if (view.state.readOnly || (!files.length && !existing)) return;
    const selected = view.state.selection.main;
    const mark = {
      from: position ?? selected.from,
      to: position ?? selected.to,
      text:
        position === undefined
          ? view.state.sliceDoc(selected.from, selected.to)
          : "",
    };
    this.pending.add(mark);
    this.queue = this.queue
      .then(async () => {
        if (this.destroyed) return;
        if (
          files.length > 20 ||
          files.reduce((total, file) => total + file.size, 0) > 50 * 1024 * 1024
        )
          throw new Error(
            t(
              "За один раз можно вставить до 20 файлов общим размером до 50 МБ.",
            ),
          );
        for (const file of files) {
          const limit = file.type.startsWith("image/") ? 8 : 25;
          if (file.size > limit * 1024 * 1024)
            throw new Error(t`${file.name}: размер превышает ${limit} МБ.`);
        }
        const uploads = await Promise.all(
          files.map(async (file) => ({
            name:
              clipboard &&
              (file.type.startsWith("image/") || imageExtension(file.name))
                ? pastedName(file)
                : file.name,
            data: await base64(file),
          })),
        );
        if (this.destroyed) return;
        const imported = existing
          ? await api.attachmentLinks(config.vaultId, config.path, [existing])
          : await api.importAttachments(
              config.vaultId,
              config.path,
              uploads,
              clipboard,
            );
        if (this.destroyed) return;
        // Keep edits made while files were being copied. Replace the original selection
        // only if its mapped contents still match the text selected at paste time.
        let { from, to } = mark;
        if (view.state.sliceDoc(from, to) !== mark.text) from = to;
        const insert = imported.map((entry) => entry.link).join("\n");
        this.pending.delete(mark);
        view.dispatch({
          changes: { from, to, insert },
          selection: { anchor: from + insert.length },
          userEvent: "input.paste",
          scrollIntoView: view.hasFocus,
        });
        config.onImported?.();
      })
      .catch((error) => {
        if (!this.destroyed) config.onError(errorMessage(error));
      })
      .finally(() => this.pending.delete(mark));
  }
}
const plugin = ViewPlugin.fromClass(AttachmentInput, {
  eventHandlers: {
    paste(event: ClipboardEvent) {
      const files = Array.from(event.clipboardData?.files ?? []);
      if (!files.length) return false;
      event.preventDefault();
      this.insert(files, true);
      return true;
    },
    dragover(event: DragEvent) {
      const types = Array.from(event.dataTransfer?.types ?? []);
      if (!types.includes("Files") && !types.includes(imageDragType))
        return false;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
      return true;
    },
    drop(event: DragEvent) {
      const internal = event.dataTransfer?.getData(imageDragType);
      const files = Array.from(event.dataTransfer?.files ?? []);
      if (!files.length && !internal) return false;
      event.preventDefault();
      event.stopPropagation();
      const position =
        this.view.posAtCoords({ x: event.clientX, y: event.clientY }) ??
        this.view.state.selection.main.head;
      if (internal) {
        const config = this.view.state.facet(configuration);
        try {
          const payload: {
            vaultId?: string;
            path?: string;
          } = JSON.parse(internal);
          if (
            payload.vaultId !== config.vaultId ||
            typeof payload.path !== "string" ||
            !imageExtension(payload.path)
          )
            throw new Error(t("Перетащите изображение из текущего хранилища."));
          this.insert([], false, position, payload.path);
        } catch (error) {
          config.onError(errorMessage(error));
        }
      } else this.insert(files, false, position);
      this.view.focus();
      return true;
    },
  },
});
export function attachmentInput(config: Config): Extension {
  return [configuration.of(config), plugin];
}
export async function pasteClipboard(view: EditorView): Promise<boolean> {
  if (!view.plugin(plugin) || !navigator.clipboard.read) return false;
  let items: ClipboardItem[];
  const original = view.state.doc,
    selected = view.state.selection.main;
  try {
    items = await navigator.clipboard.read();
  } catch {
    return false;
  }
  const files: File[] = [];
  for (const item of items) {
    const type = Object.keys(mimeExtensions).find((type) =>
      item.types.includes(type),
    );
    if (type) {
      const blob = await item.getType(type);
      files.push(new File([blob], `image.${mimeExtensions[type]}`, { type }));
    }
  }
  if (!files.length) return false;
  if (view.state.doc !== original)
    throw new Error(t("Текст изменился. Откройте меню вставки ещё раз."));
  view.dispatch({
    selection: { anchor: selected.anchor, head: selected.head },
  });
  view.plugin(plugin)!.insert(files, true);
  return true;
}
