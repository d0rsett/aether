import { Link2 } from "lucide-react";
import type { useWorkspace } from "../app/useWorkspace";
import { NoteRelations } from "./NoteRelations";
import { NoteAttachments } from "./NoteAttachments";
import type { Inspection } from "../services/api";
import { api } from "../services/api";
import { useContextMenu } from "./ContextMenu";
import { NoteProperties, type ApplyProperty } from "./NoteProperties";
type Controller = ReturnType<typeof useWorkspace>;
export function Inspector({
  app,
  inspection,
  knowledgeError,
  onProperty,
  onSource,
}: {
  app: Pick<
    Controller,
    "active" | "open" | "openWiki" | "vault" | "setError" | "refresh"
  >;
  inspection: Inspection | null;
  knowledgeError: string;
  onProperty: ApplyProperty;
  onSource: () => void;
}) {
  const context = useContextMenu(app.setError);
  return (
    <aside className="inspector">
      <div className="inspector-header">
        <Link2 size={15} />
        <span>Связи и свойства</span>
      </div>
      <div className="inspector-content">
        {app.active ? (
          <>
            <NoteProperties
              key={`${app.vault?.id}:${app.active.path}`}
              content={app.active.content}
              onApply={onProperty}
              onSource={onSource}
            />
            {knowledgeError && (
              <p className="tree-error">
                Сведения индекса недоступны: {knowledgeError}
              </p>
            )}
            <NoteRelations
              onContext={(event, path) =>
                context.show(event, "Действия ссылки", [
                  { label: "Открыть заметку", run: () => app.open(path) },
                  {
                    label: "Открыть в проводнике",
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
            Откройте заметку, чтобы увидеть её связи.
          </p>
        )}
      </div>
      {context.menu}
    </aside>
  );
}
