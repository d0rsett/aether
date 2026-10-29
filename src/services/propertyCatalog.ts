import { api } from "./api";

let cached:
  | {
      vaultId: string;
      until: number;
      result: Promise<Record<string, string[]>>;
    }
  | undefined;
export function propertyCatalog(vaultId: string) {
  if (cached?.vaultId === vaultId && cached.until > Date.now())
    return cached.result;
  const result = api.propertyCatalog(vaultId);
  cached = { vaultId, until: Date.now() + 30000, result };
  void result.catch(() => {
    if (cached?.result === result) cached = undefined;
  });
  return result;
}
