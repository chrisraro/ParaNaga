// Candidate review (A3), stops and curbs (A6), reconciliation (A7) and imports (A2): the shapes
// shared by /api/v1/admin/** and the browser (N5b), plus the promotion rules the screens show.
// Pure and browser-safe (zod only). The database repeats every rule (migration 0024); this file
// only decides what the screens offer.
import { z } from "zod";

export const STOP_STATUSES = [
  "candidate",
  "documentary",
  "installed",
  "field_verified",
  "published",
  "temporary",
  "relocated",
  "retired",
] as const;
export type StopStatus = (typeof STOP_STATUSES)[number];

/** What a promotion may move a stop to here. `published` needs the navigation checklist (later). */
export const PROMOTION_TARGETS = ["documentary", "installed", "field_verified"] as const;
export type PromotionTarget = (typeof PROMOTION_TARGETS)[number];

export const STOP_CLAIMS = ["legal_designation", "sign_installed", "operating_observed", "curb_position"] as const;
export type StopClaim = (typeof STOP_CLAIMS)[number];

export const EVIDENCE_KINDS = ["document", "photo", "gps_log", "field_survey", "operator_statement"] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

export const CURB_SIDES = ["left_of_travel", "right_of_travel", "terminal_bay", "unknown"] as const;
export type CurbSide = (typeof CURB_SIDES)[number];

/** Each promotion needs evidence of the claimed kind on the stop's current version (spec 06 A3). */
export const REQUIRED_CLAIMS: Readonly<Record<PromotionTarget, readonly StopClaim[]>> = {
  documentary: ["legal_designation"],
  installed: ["sign_installed"],
  field_verified: ["operating_observed", "curb_position"],
};

const RANK: Readonly<Record<StopStatus, number | null>> = {
  candidate: 0,
  temporary: 0,
  relocated: 0,
  documentary: 1,
  installed: 2,
  field_verified: 3,
  published: 4,
  retired: null,
};

/** Same order as transit.stop_status_rank (0024); null for retired (terminal). */
export const statusRank = (s: StopStatus): number | null => RANK[s];

/** Candidates in the review queue: not reviewed beyond the documentary step, not retired. */
export const isCandidate = (s: StopStatus) => s === "candidate" || s === "documentary" || s === "temporary" || s === "relocated";

export type PromotionOption = { status: PromotionTarget; allowed: boolean; reason: string | null };

/** The promotions a stop can take now, and why the others cannot. */
export function promotionOptions(stop: { status: StopStatus; evidence: { claim: StopClaim }[] }): PromotionOption[] {
  const rank = statusRank(stop.status);
  const claims = new Set(stop.evidence.map((e) => e.claim));
  return PROMOTION_TARGETS.map((status) => {
    if (rank === null) return { status, allowed: false, reason: "Retired stops stay retired." };
    if (rank >= statusRank(status)!) return { status, allowed: false, reason: `Already ${label(stop.status)}.` };
    const need = REQUIRED_CLAIMS[status];
    if (!need.some((c) => claims.has(c))) return { status, allowed: false, reason: `Needs evidence for ${need.map(label).join(" or ")}.` };
    return { status, allowed: true, reason: null };
  });
}

/** "field_verified" → "field verified". */
export const label = (s: string) => s.replace(/_/g, " ");

/** Codes in reading order: A2 before A10. */
export function compareCodes(a: string | null, b: string | null): number {
  return (a ?? "").localeCompare(b ?? "", "en", { numeric: true, sensitivity: "base" });
}

// ---------------------------------------------------------------- stops (A3, A6)

const uuid = z.uuid();
const iso = z.iso.datetime();
const revisionRef = z.object({ id: uuid, label: z.string(), kind: z.enum(["provisional", "verified"]), status: z.string() });

export const stopEvidenceSchema = z.object({
  id: uuid,
  kind: z.enum(EVIDENCE_KINDS),
  claim: z.enum(STOP_CLAIMS),
  note: z.string().nullable(),
  observedOn: z.string().nullable(),
  sourceCode: z.string().nullable(),
  hasMedia: z.boolean(),
  createdAt: iso,
});

export const stopRowSchema = z.object({
  stopPointId: uuid,
  versionId: uuid,
  name: z.string(),
  aliases: z.array(z.string()),
  status: z.enum(STOP_STATUSES),
  layer: z.string().nullable(),
  code: z.string().nullable(),
  labelRaw: z.string().nullable(),
  lat: z.number(),
  lng: z.number(),
  curbSide: z.enum(CURB_SIDES).nullable(),
  boardingAllowed: z.boolean().nullable(),
  alightingAllowed: z.boolean().nullable(),
  navigationApproved: z.boolean(),
  editNote: z.string().nullable(),
  isSynthetic: z.boolean(),
  /** Public codes of the routes whose stop order uses this version. */
  sequences: z.array(z.string()),
  pins: z.array(
    z.object({ layer: z.string(), code: z.string().nullable(), label: z.string(), description: z.string().nullable(), lat: z.number(), lng: z.number() }),
  ),
  evidence: z.array(stopEvidenceSchema),
});
export type StopRow = z.infer<typeof stopRowSchema>;

export const stopListSchema = z.object({
  revision: revisionRef.nullable(),
  /** True when the revision shown is the open draft (the only one that can be edited). */
  editable: z.boolean(),
  stops: z.array(stopRowSchema),
});
export type StopList = z.infer<typeof stopListSchema>;

const note = (max: number) => z.string().trim().max(max);
const reason = z.string().trim().min(3, "Give a reason (3 to 500 characters).").max(500);
const lat = z.number().min(13.45).max(13.8);
const lng = z.number().min(123.05).max(123.4);
const base = { expectedVersionId: uuid };

export const stopActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("promote"), ...base, status: z.enum(PROMOTION_TARGETS), note: note(500).optional() }).strict(),
  z
    .object({
      action: z.literal("evidence"),
      ...base,
      kind: z.enum(EVIDENCE_KINDS),
      claim: z.enum(STOP_CLAIMS),
      note: note(1000).optional(),
      observedOn: z.iso.date().optional(),
      sourceCode: z.string().regex(/^[A-Z][A-Z0-9-]{1,30}$/).optional(),
      mediaObjectId: uuid.optional(),
    })
    .strict(),
  z.object({ action: z.literal("retire"), ...base, reason }).strict(),
  z.object({ action: z.literal("relocate"), ...base, lat, lng, reason }).strict(),
  z
    .object({
      action: z.literal("edit"),
      ...base,
      changes: z
        .object({
          name: z.string().trim().min(1).max(120).optional(),
          aliases: z.array(z.string().trim().min(1).max(80)).max(10).optional(),
          curbSide: z.enum(CURB_SIDES).nullable().optional(),
          curbLat: lat.optional(),
          curbLng: lng.optional(),
          boardingAllowed: z.boolean().nullable().optional(),
          alightingAllowed: z.boolean().nullable().optional(),
          note: note(500).optional(),
        })
        .strict()
        .refine((c) => (c.curbLat === undefined) === (c.curbLng === undefined), "A curb point needs both coordinates.")
        .refine((c) => Object.keys(c).length > 0, "Nothing to change."),
    })
    .strict(),
]);
export type StopAction = z.infer<typeof stopActionSchema>;

export const stopActionResultSchema = z.object({ stopPointId: uuid, versionId: uuid });
export type StopActionResult = z.infer<typeof stopActionResultSchema>;

// ---------------------------------------------------------------- reconciliation (A7)

const pairStop = z.object({
  stopPointId: uuid,
  versionId: uuid,
  name: z.string(),
  status: z.enum(STOP_STATUSES),
  layer: z.string().nullable(),
  code: z.string().nullable(),
  lat: z.number(),
  lng: z.number(),
});

export const reconciliationSchema = z.object({
  revision: revisionRef.nullable(),
  editable: z.boolean(),
  pairs: z.array(z.object({ a: pairStop, b: pairStop, distanceM: z.number(), similarNames: z.boolean() })),
  /** A stop and one of its source pins: far apart, or named differently. Read-only. */
  mismatches: z.array(
    z.object({
      stopPointId: uuid,
      name: z.string(),
      status: z.enum(STOP_STATUSES),
      pinLayer: z.string(),
      pinCode: z.string().nullable(),
      pinLabel: z.string(),
      distanceM: z.number(),
      far: z.boolean(),
      nameDiffers: z.boolean(),
    }),
  ),
  decisions: z.array(
    z.object({
      id: uuid,
      decision: z.enum(["link", "keep_separate"]),
      distanceM: z.number(),
      a: z.string(),
      b: z.string(),
      kept: z.string().nullable(),
      note: z.string().nullable(),
      decidedAt: iso,
    }),
  ),
});
export type Reconciliation = z.infer<typeof reconciliationSchema>;

/** Pins farther than this from their stop are listed (the near_duplicate radius, spec 04 §4.7). */
export const PIN_MISMATCH_M = 15;

const side = z.object({ stopPointId: uuid, expectedVersionId: uuid });
export const reconcilePayloadSchema = z
  .object({
    a: side,
    b: side,
    decision: z.enum(["link", "keep_separate"]),
    keepStopPointId: uuid.optional(),
    note: note(500).optional(),
  })
  .strict()
  .refine((p) => p.a.stopPointId !== p.b.stopPointId, "Pick two different stops.")
  .refine(
    (p) => p.decision !== "link" || p.keepStopPointId === p.a.stopPointId || p.keepStopPointId === p.b.stopPointId,
    "Say which stop to keep.",
  );
export type ReconcilePayload = z.infer<typeof reconcilePayloadSchema>;

export const reconcileResultSchema = z.object({
  decision: z.enum(["link", "keep_separate"]),
  keptVersionId: uuid.nullable(),
  retiredVersionId: uuid.nullable(),
});

// ---------------------------------------------------------------- imports (A2)

export const IMPORT_FORMATS = ["kml", "csv"] as const;
export type ImportFormat = (typeof IMPORT_FORMATS)[number];
/** The upload travels as text in the JSON body; the research KML is about 44 KB. */
export const IMPORT_MAX_CHARS = 1_000_000;

export const importUploadSchema = z
  .object({
    format: z.enum(IMPORT_FORMATS),
    fileName: z.string().trim().min(1).max(200),
    text: z.string().min(1).max(IMPORT_MAX_CHARS),
    /** The My Maps export date; part of the snapshot version (mymaps:<map>:<date>). */
    retrievedOn: z.iso.date(),
  })
  .strict();
export type ImportUpload = z.infer<typeof importUploadSchema>;

export const importCommitSchema = importUploadSchema.extend({ expectedBaselineBatchId: uuid }).strict();

const changeCounts = z.object({ added: z.number().int(), changed: z.number().int(), unchanged: z.number().int(), missing: z.number().int() });

export const importDryRunSchema = z.object({
  snapshotVersion: z.string().nullable(),
  mapId: z.string().nullable(),
  fileName: z.string(),
  sha256: z.string(),
  bytes: z.number().int(),
  baseline: z.object({ batchId: uuid, snapshotVersion: z.string() }).nullable(),
  counts: z.object({ total: z.number().int(), byLayer: z.record(z.string(), z.number().int()), expectedTotal: z.number().int(), expectedByLayer: z.record(z.string(), z.number().int()) }),
  changes: changeCounts,
  rows: z.array(
    z.object({
      kind: z.enum(["added", "changed", "missing"]),
      layer: z.string(),
      code: z.string().nullable(),
      label: z.string(),
      fromLabel: z.string().nullable(),
      movedM: z.number().nullable(),
    }),
  ),
  conflicts: z.array(
    z.object({ kind: z.string(), meters: z.number().nullable(), records: z.array(z.object({ layer: z.string(), code: z.string(), label: z.string() })) }),
  ),
  problems: z.array(z.string()),
  canCommit: z.boolean(),
});
export type ImportDryRun = z.infer<typeof importDryRunSchema>;

export const importCommitResultSchema = z.object({
  outcome: z.enum(["committed", "unchanged"]),
  batchId: uuid,
  snapshotVersion: z.string(),
  revisionId: uuid.nullable(),
  counts: z.record(z.string(), z.union([z.number(), z.string()])),
});
export type ImportCommitResult = z.infer<typeof importCommitResultSchema>;

export const importListSchema = z.object({
  baseline: z.object({ batchId: uuid, snapshotVersion: z.string(), mapId: z.string(), finishedAt: iso.nullable() }).nullable(),
  batches: z.array(
    z.object({
      id: uuid,
      snapshotVersion: z.string(),
      mode: z.string(),
      status: z.string(),
      startedBy: z.string(),
      startedAt: iso,
      finishedAt: iso.nullable(),
      fileName: z.string().nullable(),
      changes: changeCounts,
      conflicts: z.number().int(),
    }),
  ),
});
export type ImportList = z.infer<typeof importListSchema>;
