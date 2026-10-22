"use client";

// Browser side of /api/v1/admin/** (N5a). Every answer is parsed with the shared schema before it
// is shown; nothing is cached (the endpoints answer private, no-store, and the service worker
// never stores /api/v1/admin).
import type { z } from "zod";
import {
  adminDashboardSchema,
  coverageSchema,
  createDraftResultSchema,
  publishResultSchema,
  revisionListSchema,
  validationReportSchema,
} from "@/domain/admin/schemas";
import { apiErrorSchema } from "@/domain/api/schemas";

export type AdminFailure = { ok: false; status: number; code: string | null; message: string };
export type AdminResult<T> = { ok: true; data: T } | AdminFailure;

const FAILED = "The request failed. Check the connection and try again.";

async function call<S extends z.ZodType>(url: string, schema: S, body?: unknown): Promise<AdminResult<z.infer<S>>> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: body === undefined ? "GET" : "POST",
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      credentials: "same-origin",
      cache: "no-store",
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    return { ok: false, status: 0, code: null, message: FAILED };
  }
  const raw: unknown = await res.json().catch(() => null);
  if (res.ok) {
    const parsed = schema.safeParse(raw);
    return parsed.success ? { ok: true, data: parsed.data } : { ok: false, status: res.status, code: null, message: "The server sent an answer this page cannot read. Reload." };
  }
  const err = apiErrorSchema.safeParse(raw);
  return { ok: false, status: res.status, code: err.success ? err.data.error.code : null, message: err.success ? err.data.error.message : FAILED };
}

export const fetchDashboard = () => call("/api/v1/admin/dashboard", adminDashboardSchema);
export const fetchRevisions = () => call("/api/v1/admin/revisions", revisionListSchema);
export const createDraft = () => call("/api/v1/admin/revisions", createDraftResultSchema, {});
export const validate = (id: string) => call(`/api/v1/admin/revisions/${encodeURIComponent(id)}/validate`, validationReportSchema, {});
export const publish = (id: string, mode: "publish" | "rollback", expectedPublishedId: string | null) =>
  call(`/api/v1/admin/revisions/${encodeURIComponent(id)}/${mode}`, publishResultSchema, { expectedPublishedId });
export const fetchCoverage = () => call("/api/v1/admin/coverage", coverageSchema);
