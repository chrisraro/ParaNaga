import catalog from "./rights-catalog.json";

export const SOURCE_RIGHTS = catalog;
export const SOURCE_RIGHTS_BLOCKERS = catalog.filter((s) => s.status === "permission_required" || s.status === "reuse_unconfirmed");
export function rightsForSource(code: string) {
  return catalog.find((source) => source.code === code) ?? null;
}
