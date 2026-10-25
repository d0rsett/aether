import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  api,
  desktop,
  errorMessage,
  type IndexStatus,
  type Inspection,
} from "../services/api";

export function useKnowledge(
  vaultId: string | undefined,
  path: string | undefined,
  revision: string | undefined,
) {
  const [status, setStatus] = useState<IndexStatus | null>(null);
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    setStatus(null);
    setError("");
    if (!desktop || !vaultId) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen<{ vaultId: string; status: IndexStatus }>(
      "knowledge:changed",
      (event) => {
        if (!disposed && event.payload.vaultId === vaultId)
          setStatus((previous) =>
            previous && previous.revision > event.payload.status.revision
              ? previous
              : event.payload.status,
          );
      },
    )
      .then((cleanup) => {
        if (disposed) cleanup();
        else unlisten = cleanup;
      })
      .catch((e) => {
        if (!disposed) setError(errorMessage(e));
      });
    void api
      .indexStatus(vaultId)
      .then((value) => {
        if (!disposed)
          setStatus((previous) =>
            previous && previous.revision > value.revision ? previous : value,
          );
      })
      .catch((e) => {
        if (!disposed) setError(errorMessage(e));
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [vaultId]);
  useEffect(() => {
    setInspection(null);
    if (!vaultId || !path || status?.running) return;
    let disposed = false;
    void api
      .inspect(vaultId, path)
      .then((value) => {
        if (!disposed) {
          setInspection(value);
          setError("");
        }
      })
      .catch((e) => {
        if (!disposed) setError(errorMessage(e));
      });
    return () => {
      disposed = true;
    };
  }, [vaultId, path, revision, status?.revision, status?.running]);
  return { status, inspection, error };
}
