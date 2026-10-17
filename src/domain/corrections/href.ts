import { isEntityType, type EntityType } from "./categories";

export type ReportEntity = { entityType: EntityType; entityId: string; entityLabel?: string };

/** /app/report with the entity prefilled. Only ids and names go in the URL, never coordinates or text. */
export function reportHref(entity: ReportEntity): string {
  const q = new URLSearchParams({ type: entity.entityType, id: entity.entityId });
  if (entity.entityLabel) q.set("label", entity.entityLabel);
  return `/app/report?${q.toString()}`;
}

/** Reads the prefilled entity back; anything missing or malformed is ignored (the wizard asks instead). */
export function parseReportEntity(params: { get(name: string): string | null }): ReportEntity | null {
  const type = params.get("type");
  const id = params.get("id")?.trim();
  if (!isEntityType(type) || !id || id.length > 120) return null;
  const label = params.get("label")?.trim().slice(0, 120);
  return { entityType: type, entityId: id, ...(label ? { entityLabel: label } : {}) };
}
