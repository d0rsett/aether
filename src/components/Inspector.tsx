import { t, useLocale } from "../i18n";
import { Link2 } from "lucide-react";
import type { useWorkspace } from "../app/useWorkspace";
import { NoteRelations } from "./NoteRelations";
import { NoteAttachments } from "./NoteAttachments";
import type { Inspection } from "../services/api";
import { api } from "../services/api";
import { useContextMenu } from "./ContextMenu";
type Controller = ReturnType<typeof useWorkspace>;
export function Inspector({
  app,
  inspection,
  knowledgeError,
}: {
  app: Pick<
    Controller,
    "active" | "open" | "openWiki" | "vault" | "setError" | "refresh"
  >;
  inspection: Inspection | null;
  knowledgeError: string;
}) {
  useLocale();
  const context = useContextMenu(app.setError);
  return (
    <aside className="inspector">
      <div className="inspector-header">
        <Link2 size={15} />
        <span>{t("Связи")}</span>
      </div>
      <div className="inspector-content">
        {app.active ? (
          <>
            {knowledgeError && (
              <p className="tree-error">
                {t(" Сведения индекса недоступны: ")}
                {knowledgeError}
              </p>
            )}
            <NoteRelations
              onContext={(event, path) =>
                context.show(event, t("Действия ссылки"), [
                  {
                    label: t("Открыть заметку"),
                    run: () => app.open(path),
                  },
                  {
                    label: t("Открыть в проводнике"),
                    disabled: !app.vault,
                    run: () => api.reveal(app.vault!.id, path),
                  },
                ])
              }
              data={inspection}
              onOpen={(path) => void app.open(path)}
              onWiki={(target) => {
                if (app.active) void app.openWiki(app.active.path, target);
              }}
            />
            {app.vault && (
              <NoteAttachments
                vaultId={app.vault.id}
                path={app.active.path}
                content={app.active.content}
                refresh={app.refresh}
                onOpen={(path) => void app.open(path)}
                onError={app.setError}
              />
            )}
          </>
        ) : (
          <p className="relations-hint">
            {t(" Откройте заметку, чтобы увидеть её связи. ")}
          </p>
        )}
      </div>
      {context.menu}
    </aside>
  );
}
