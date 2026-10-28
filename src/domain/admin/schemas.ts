// Admin API shapes (N5a): /api/v1/admin/**. Shared by the route handlers (responses are parsed
// before they leave) and the browser (responses are parsed again before they are shown).
import { z } from "zod";
import { DEFERRED_RULES, RULES, type RuleId } from "./validation";

const iso = z.iso.datetime();
const kind = z.enum(["provisional", "verified"]);
const status = z.enum(["draft", "validating", "published", "superseded"]);
const count = z.number().int().nonnegative();

// ---------------------------------------------------------------- facts (database → server)

export const validationFactsSchema = z.object({
  revision: z.object({ id: z.uuid(), label: z.string(), kind, status, isSynthetic: z.boolean() }),
  membershipHash: z.string().regex(/^[0-9a-f]{64}$/),
  dbCheck: z.union([
    z.object({ ok: z.literal(true) }),
    z.object({ ok: z.literal(false), code: z.string(), message: z.string() }),
  ]),
  members: z.array(z.object({ kind: z.string(), code: z.string(), isSynthetic: z.boolean().nullable() })),
  stops: z.array(
    z.object({
      stopPointId: z.uuid(),
      layer: z.string().nullable(),
      code: z.string().nullable(),
      name: z.string(),
      lat: z.number(),
      lng: z.number(),
      // 0024 (N5b); the defaults read facts of a database still on 0023.
      status: z.string().default("candidate"),
      curbSide: z.string().nullable().default(null),
      evidenceClaims: z.array(z.string()).default([]),
      movedM: z.coerce.number().nullable().default(null),
      inSequence: z.boolean().default(false),
    }),
  ),
  terminals: z.array(z.object({ code: z.string(), lat: z.number(), lng: z.number() })),
  variants: z.array(
    z.object({
      ref: z.string(),
      kind: z.string(),
      trialStatus: z.string().nullable(),
      effectiveFrom: z.string().nullable(),
      trialDurationDays: z.number().int().nullable(),
      evidenceLevel: z.string(),
      hasFareEvidence: z.boolean(),
    }),
  ),
  routeStops: z.array(z.object({ variantRef: z.string(), seq: z.number().int(), distAlongM: z.coerce.number() })),
  shapes: z.array(
    z.object({
      variantRef: z.string(),
      traceStatus: z.string(),
      untracedReason: z.string().nullable(),
      measures: z.array(z.object({ seq: z.unknown(), measureM: z.unknown() })),
    }),
  ),
  // 0029 (IC1); the defaults read facts of a database still on 0028.
  regionalServices: z
    .array(
      z.object({
        code: z.string(),
        status: z.string(),
        mode: z.string(),
        terminalCode: z.string().nullable(),
        asOf: z.string().nullable(),
        reviewBy: z.string().nullable(),
        statusNoteCode: z.string().nullable(),
        destinationCodes: z.array(z.string()),
        sourceEvidenceTypes: z.array(z.string()),
        departureCount: z.coerce.number().int(),
        observationCount: z.coerce.number().int(),
        observationsWithoutMonth: z.coerce.number().int(),
      }),
    )
    .default([]),
  regionalDestinations: z.array(z.object({ code: z.string(), serviceCount: z.coerce.number().int() })).default([]),
});

// ---------------------------------------------------------------- responses (server → browser)

const ruleId = z.enum(Object.keys(RULES) as [RuleId, ...RuleId[]]);
const severity = z.enum(["error", "warning"]);

export const validationReportSchema = z.object({
  revisionId: z.uuid(),
  label: z.string(),
  kind,
  ok: z.boolean(),
  errorCount: count,
  warningCount: count,
  issues: z.array(z.object({ rule: ruleId, severity, ref: z.string(), message: z.string() })),
  rules: z.array(z.object({ id: ruleId, title: z.string(), severity, count })),
  deferred: z.array(z.object({ id: z.enum(DEFERRED_RULES.map((d) => d.id) as [string, ...string[]]), title: z.string(), reason: z.string() })),
  validatedAt: iso,
});
export type StoredValidationReport = z.infer<typeof validationReportSchema>;

const validationSummary = z.object({ ok: z.boolean(), validatedAt: iso, errorCount: count, warningCount: count, current: z.boolean() });
export type ValidationSummary = z.infer<typeof validationSummary>;

export const adminDashboardSchema = z.object({
  published: z.object({ id: z.uuid(), seq: z.number().int(), label: z.string(), kind, publishedAt: iso.nullable() }).nullable(),
  drafts: count,
  latestDraft: z
    .object({ id: z.uuid(), label: z.string(), createdAt: iso, validationOk: z.boolean().nullable(), validatedAt: iso.nullable(), validationCurrent: z.boolean().nullable() })
    .nullable(),
  stopsTotal: count,
  stopCandidates: count,
  openCorrections: count,
  lastImport: z
    .object({ snapshotVersion: z.string(), mode: z.string(), status: z.string(), startedAt: iso, finishedAt: iso.nullable() })
    .nullable(),
});
export type AdminDashboard = z.infer<typeof adminDashboardSchema>;

export const revisionRowSchema = z.object({
  id: z.uuid(),
  seq: z.number().int(),
  label: z.string(),
  kind,
  status,
  createdAt: iso,
  publishedAt: iso.nullable(),
  parentId: z.uuid().nullable(),
  isSynthetic: z.boolean(),
  memberCount: count,
  isPublished: z.boolean(),
  validation: validationSummary.nullable(),
});
export type RevisionRow = z.infer<typeof revisionRowSchema>;

export const revisionListSchema = z.object({ publishedId: z.uuid().nullable(), revisions: z.array(revisionRowSchema) });
export type RevisionList = z.infer<typeof revisionListSchema>;

export const createDraftResultSchema = z.object({ revisionId: z.uuid() });

export const publishPayloadSchema = z.object({ expectedPublishedId: z.uuid().nullable() }).strict();
export type PublishPayload = z.infer<typeof publishPayloadSchema>;

export const publishResultSchema = z.object({
  mode: z.enum(["publish", "rollback"]),
  revisionId: z.uuid(),
  previousRevisionId: z.uuid().nullable(),
  /** What GET /api/v1/network/head now answers (CDN copies refresh within s-maxage=30). */
  head: z.object({ revisionId: z.uuid(), label: z.string(), kind, publishedAt: iso.nullable() }),
});
export type PublishResult = z.infer<typeof publishResultSchema>;

export const coverageSchema = z.object({
  revisionId: z.uuid().nullable(),
  label: z.string().nullable(),
  rows: z.array(z.object({ barangay: z.string(), surveyStatus: z.string(), exactBoardingPointsVerified: z.boolean().nullable() })),
});
export type Coverage = z.infer<typeof coverageSchema>;
