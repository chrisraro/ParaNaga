import "server-only";
import { sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import { withRequestContext, type Db } from "@/server/db/context";
import { safeRequestId } from "@/server/request-id";
import { getStorage } from "@/server/storage/adapter";
import { sniffMagicBytes } from "@/domain/media/sniff";
import { stripImageMetadata } from "@/domain/media/strip-metadata";
import { serverEnv } from "@/server/env";
import type { MediaPurpose } from "@/domain/media/schemas";

export interface MediaSlotResult {
  id: string;
  bucket: string;
  objectKey: string;
  uploadUrl: string;
  maxBytes: number;
}

export interface MediaConfirmResult {
  id: string;
  bucket: string;
  objectKey: string;
  status: "verified" | "rejected";
  bytes: number;
  sha256: string;
}

/**
 * Creates an upload slot in quarantine bucket.
 */
export async function createMediaSlot(
  userId: string,
  purpose: MediaPurpose,
  expectedBytes: number,
  mime: string,
): Promise<MediaSlotResult> {
  const requestId = safeRequestId();
  const storage = getStorage();

  const slot = await withRequestContext({ userId, requestId }, async (db) => {
    const res = await db.execute<{
      id: string;
      bucket: string;
      object_key: string;
      expected_bytes: number;
    }>(sql`
      select id, bucket, object_key, expected_bytes
        from core.create_media_slot(${purpose}, ${expectedBytes}, ${mime})
    `);
    const row = res.rows[0];
    if (!row) throw new Error("Failed to create media slot");
    return row;
  });

  const presigned = await storage.createPresignedUpload(
    slot.bucket,
    slot.object_key,
    Number(slot.expected_bytes),
    mime,
    300, // spec 05 §5.8: 5-minute upload expiry
  );

  return {
    id: slot.id,
    bucket: slot.bucket,
    objectKey: slot.object_key,
    uploadUrl: presigned.url,
    maxBytes: Number(slot.expected_bytes),
  };
}

/** A confirm failure the route maps to a fixed message; `kind` never carries storage or DB text. */
export class MediaConfirmError extends Error {
  constructor(readonly kind: "not_found" | "rejected" | "failed") {
    super(kind);
    this.name = "MediaConfirmError";
  }
}

/**
 * Confirms uploaded slot:
 *  - Checks slot ownership & status (a slot that is not the caller's is "not found", like a missing one)
 *  - HEADs the quarantine object and refuses one over the expected size before reading it
 *  - Sniffs magic bytes and computes SHA-256
 *  - complaint_evidence: copies the original, untouched, to evidence-private
 *  - every other purpose (public-media): images only; EXIF/XMP/GPS stripped before storing
 *  - Stores under a per-slot key (two uploads of the same bytes never collide on object_key)
 *  - Promotes in the DB, then deletes the quarantine copy (a failed promote keeps the upload)
 */
export async function confirmMediaSlot(
  userId: string,
  slotId: string,
): Promise<MediaConfirmResult> {
  const requestId = safeRequestId();
  const storage = getStorage();
  const env = serverEnv();

  // 1. Fetch slot metadata from DB (RLS: only the caller's own rows are visible)
  const slot = await withRequestContext({ userId, requestId }, async (db) => {
    const res = await db.execute<{
      id: string;
      bucket: string;
      object_key: string;
      expected_bytes: number;
      owner_id: string;
      purpose: MediaPurpose;
      status: string;
    }>(sql`
      select id, bucket, object_key, expected_bytes, owner_id, purpose, status
        from core.media_object
       where id = ${slotId}::uuid and owner_id = ${userId}
    `);
    return res.rows[0] ?? null;
  });

  if (!slot || slot.owner_id !== userId || slot.status !== "slot") {
    throw new MediaConfirmError("not_found");
  }

  const reject = async (deleteQuarantine: boolean) => {
    if (deleteQuarantine) await storage.deleteObject(slot.bucket, slot.object_key);
    await withRequestContext({ userId, requestId }, async (db) => {
      await db.execute(sql`select core.reject_media(${slotId}::uuid)`);
    });
    return new MediaConfirmError("rejected");
  };

  // 2. Size check before buffering the object
  const head = await storage.headObject(slot.bucket, slot.object_key);
  if (!head || head.bytes === 0) throw await reject(false);
  if (head.bytes > Number(slot.expected_bytes)) throw await reject(true);

  const bytes = await storage.getObject(slot.bucket, slot.object_key);
  if (!bytes || bytes.byteLength === 0) throw await reject(false);
  if (bytes.byteLength > Number(slot.expected_bytes)) throw await reject(true);

  // 3. Verify magic bytes
  const sniffed = sniffMagicBytes(bytes);
  if (sniffed.kind === "unknown") throw await reject(true);

  const isEvidence = slot.purpose === "complaint_evidence";
  const destBucket = isEvidence ? env.STORAGE_BUCKET_EVIDENCE : env.STORAGE_BUCKET_PUBLIC;
  const ext = sniffed.mime.split("/")[1] ?? "bin";
  const destKey = `${slot.purpose}/${slot.id}.${ext}`;

  // 4. Store: evidence originals verbatim; anything bound for public-media stripped of metadata
  let stored: Uint8Array = bytes;
  if (isEvidence) {
    if (!(await storage.copyObject(slot.bucket, slot.object_key, destBucket, destKey))) {
      throw new MediaConfirmError("failed");
    }
  } else {
    if (sniffed.kind !== "image") throw await reject(true);
    const stripped = stripImageMetadata(bytes, sniffed.mime);
    if (!stripped) throw await reject(true);
    stored = stripped;
    if (!(await storage.putObject(destBucket, destKey, stored, sniffed.mime))) {
      throw new MediaConfirmError("failed");
    }
  }
  const sha256 = createHash("sha256").update(stored).digest("hex");

  // 5. Promote in DB, then delete the quarantine copy
  const promoted = await withRequestContext({ userId, requestId }, async (db) => {
    const res = await db.execute<{ ok: boolean }>(sql`
      select core.verify_and_promote_media(
        ${slotId}::uuid,
        ${destBucket},
        ${destKey},
        ${sha256},
        ${stored.byteLength},
        ${sniffed.mime}
      ) as ok
    `);
    return res.rows[0]?.ok === true;
  });
  if (!promoted) {
    await storage.deleteObject(destBucket, destKey);
    throw new MediaConfirmError("not_found");
  }
  await storage.deleteObject(slot.bucket, slot.object_key);

  return {
    id: slot.id,
    bucket: destBucket,
    objectKey: destKey,
    status: "verified",
    bytes: stored.byteLength,
    sha256,
  };
}
