import "server-only";
import { sql } from "drizzle-orm";
import { maskForAi } from "@/domain/moderation/mask";
import { decideModeration, type JevOutcome } from "@/domain/moderation/policy";
import { createJevClient } from "@/server/adapters/jev/client";
import type { Db } from "@/server/db/context";
import { serverEnv } from "@/server/env";

export type CommunityModeration = { status: "published" | "pending" | "rejected"; reason: string; jev: JevOutcome };

/**
 * Every new post, comment and edit goes through here. Jev is advisory: AUTO_PUBLISH_ENABLED is
 * false by default, so content normally lands 'pending' for a person; any Jev failure (including
 * a missing configuration) also keeps it pending and never blocks the submission. Only masked
 * text (no emails, phone numbers or plate-like codes) leaves the server.
 */
export async function moderateCommunityText(text: string): Promise<CommunityModeration> {
  let jev: JevOutcome = null;
  try {
    const env = serverEnv();
    const flags = { autoPublishEnabled: env.AUTO_PUBLISH_ENABLED, complaintsEnabled: false, complaintsLegalClearance: false };
    jev = await createJevClient().classify({ kind: "community", text: maskForAi(text), flags });
    const decision = decideModeration({ kind: "community", jev, flags });
    return { status: decision.status, reason: decision.reason, jev };
  } catch {
    return { status: "pending", reason: "jev_unavailable", jev };
  }
}

/**
 * Stores Jev's typed answer next to the content, in the same transaction (N6): the moderation
 * queue shows the probability, and a moderator's decision against it is an audited override.
 * Never the text, never prose. A retry of the same submission is a no-op in the database.
 */
export async function recordJevEvidence(db: Db, targetType: "post_version" | "comment", targetId: string, jev: JevOutcome): Promise<void> {
  const env = serverEnv();
  const c = jev?.status === "ok" ? jev.verdict.confidence : Number.NaN;
  const verdict = jev?.status === "ok" && Number.isFinite(c) && c >= 0 && c <= 1 ? jev.verdict : null;
  const unavailable = verdict ? null : jev === null ? "not_asked" : jev.status === "unavailable" ? jev.reason : "malformed";
  // A savepoint: evidence is a reviewer aid and must never undo the submission it describes.
  await db.execute(sql`savepoint jev_evidence`);
  try {
    await db.execute(sql`
      select community.record_jev_evidence(${targetType}, ${targetId}::uuid, ${verdict?.recommendation ?? null},
        ${verdict?.confidence ?? null}::numeric, ${unavailable}, ${env.JEV_POLICY_VERSION}, ${env.JEV_MODEL_ID})
    `);
    await db.execute(sql`release savepoint jev_evidence`);
  } catch {
    await db.execute(sql`rollback to savepoint jev_evidence`);
  }
}
