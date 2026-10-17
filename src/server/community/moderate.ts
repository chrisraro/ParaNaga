import "server-only";
import { maskForAi } from "@/domain/moderation/mask";
import { decideModeration } from "@/domain/moderation/policy";
import { createJevClient } from "@/server/adapters/jev/client";
import { serverEnv } from "@/server/env";

export type CommunityModeration = { status: "published" | "pending" | "rejected"; reason: string };

/**
 * Every new post, comment and edit goes through here. Jev is advisory: AUTO_PUBLISH_ENABLED is
 * false by default, so content normally lands 'pending' for a person; any Jev failure (including
 * a missing configuration) also keeps it pending and never blocks the submission. Only masked
 * text (no emails, phone numbers or plate-like codes) leaves the server.
 */
export async function moderateCommunityText(text: string): Promise<CommunityModeration> {
  try {
    const env = serverEnv();
    const flags = { autoPublishEnabled: env.AUTO_PUBLISH_ENABLED, complaintsEnabled: false, complaintsLegalClearance: false };
    const jev = await createJevClient().classify({ kind: "community", text: maskForAi(text), flags });
    const decision = decideModeration({ kind: "community", jev, flags });
    return { status: decision.status, reason: decision.reason };
  } catch {
    return { status: "pending", reason: "jev_unavailable" };
  }
}
