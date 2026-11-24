// The correction a guest has filled in, kept only while they sign in: signing in reloads the app,
// which would lose it. This tab's sessionStorage, read back once, ignored after 30 minutes, and
// never the location (coordinates are personal data; the wizard asks to add it again).

import { z } from "zod";
import { isCorrectionCategory, isEntityType, type CorrectionCategory, type EntityType } from "@/domain/corrections/categories";
import { DESCRIPTION_MAX } from "@/domain/corrections/schemas";

const KEY = "paranaga.reportDraft";
const MAX_AGE_MS = 30 * 60_000;

const draftSchema = z.object({
  /** Which report it belongs to (the wizard's key): never restored into another one. */
  report: z.string(),
  savedAt: z.number(),
  category: z.custom<CorrectionCategory>((v) => typeof v === "string" && isCorrectionCategory(v)).nullable(),
  entityType: z.custom<EntityType>((v) => typeof v === "string" && isEntityType(v)).nullable(),
  entityText: z.string().max(120),
  description: z.string().max(DESCRIPTION_MAX),
  hadLocation: z.boolean(),
});
export type ReportDraft = Omit<z.infer<typeof draftSchema>, "report" | "savedAt">;

/** Storage may be blocked (private mode): then there is simply no draft. */
function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

export function saveReportDraft(report: string, draft: ReportDraft, now = Date.now()): void {
  try {
    storage()?.setItem(KEY, JSON.stringify({ ...draft, report, savedAt: now }));
  } catch {
    // Full or blocked storage: the report still works, it just will not survive signing in.
  }
}

export function readReportDraft(report: string, now = Date.now()): ReportDraft | null {
  try {
    const parsed = draftSchema.safeParse(JSON.parse(storage()?.getItem(KEY) ?? "null"));
    if (!parsed.success) return null;
    const { report: savedFor, savedAt, ...draft } = parsed.data;
    return savedFor === report && now >= savedAt && now - savedAt < MAX_AGE_MS ? draft : null;
  } catch {
    return null;
  }
}

export function clearReportDraft(): void {
  try {
    storage()?.removeItem(KEY);
  } catch {
    // Blocked storage holds no draft.
  }
}
