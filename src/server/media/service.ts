import "server-only";
import { sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import { withRequestContext, type Db } from "@/server/db/context";
import { safeRequestId } from "@/server/request-id";
import { getStorage } from "@/server/storage/adapter";
import { sniffMagicBytes } from "@/domain/media/sniff";
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
    900,
  );

  return {
    id: slot.id,
    bucket: slot.bucket,
    objectKey: slot.object_key,
    uploadUrl: presigned.url,
    maxBytes: Number(slot.expected_bytes),
  };
}

/**
 * Confirms uploaded slot:
 *  - Checks slot ownership & status
 *  - HEADs and reads object from quarantine
 *  - Checks size cap and sniffs magic bytes
 *  - Calculates SHA-256
 *  - Copies to server-owned destination bucket (public-media or evidence-private)
 *  - Deletes quarantine copy
 *  - Updates core.media_object with status = 'verified'
 */
export async function confirmMediaSlot(
  userId: string,
  slotId: string,
): Promise<MediaConfirmResult> {
  const requestId = safeRequestId();
  const storage = getStorage();
  const env = serverEnv();

  // 1. Fetch slot metadata from DB
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
       where id = ${slotId}::uuid
    `);
    return res.rows[0] ?? null;
  });

  if (!slot) {
    throw new Error("Media slot not found.");
  }
  if (slot.owner_id !== userId) {
    throw new Error("Forbidden: not media slot owner.");
  }
  if (slot.status !== "slot") {
    throw new Error(`Media slot already processed with status: ${slot.status}`);
  }

  // 2. Read object from quarantine
  const bytes = await storage.getObject(slot.bucket, slot.object_key);
  if (!bytes || bytes.byteLength === 0) {
    await withRequestContext({ userId, requestId }, async (db) => {
      await db.execute(sql`select core.reject_media(${slotId}::uuid)`);
    });
    throw new Error("Quarantine object not found or empty.");
  }

  if (bytes.byteLength > Number(slot.expected_bytes)) {
    await storage.deleteObject(slot.bucket, slot.object_key);
    await withRequestContext({ userId, requestId }, async (db) => {
      await db.execute(sql`select core.reject_media(${slotId}::uuid)`);
    });
    throw new Error("Uploaded media exceeded expected bytes.");
  }

  // 3. Verify magic bytes
  const sniffed = sniffMagicBytes(bytes);
  if (sniffed.kind === "unknown") {
    await storage.deleteObject(slot.bucket, slot.object_key);
    await withRequestContext({ userId, requestId }, async (db) => {
      await db.execute(sql`select core.reject_media(${slotId}::uuid)`);
    });
    throw new Error("Unsupported or corrupted file magic bytes.");
  }

  // 4. Compute SHA-256
  const sha256 = createHash("sha256").update(bytes).digest("hex");

  // 5. Determine destination bucket and server-owned object key
  const destBucket =
    slot.purpose === "complaint_evidence"
      ? env.STORAGE_BUCKET_EVIDENCE
      : env.STORAGE_BUCKET_PUBLIC;

  const ext = sniffed.mime.split("/")[1] ?? "bin";
  const destKey = `${slot.purpose}/${sha256.slice(0, 2)}/${sha256}.${ext}`;

  // 6. Copy to destination bucket
  const copied = await storage.copyObject(slot.bucket, slot.object_key, destBucket, destKey);
  if (!copied) {
    throw new Error("Failed to copy media to destination bucket.");
  }

  // 7. Delete from quarantine
  await storage.deleteObject(slot.bucket, slot.object_key);

  // 8. Promote in DB
  await withRequestContext({ userId, requestId }, async (db) => {
    await db.execute(sql`
      select core.verify_and_promote_media(
        ${slotId}::uuid,
        ${destBucket},
        ${destKey},
        ${sha256},
        ${bytes.byteLength},
        ${sniffed.mime}
      )
    `);
  });

  return {
    id: slot.id,
    bucket: destBucket,
    objectKey: destKey,
    status: "verified",
    bytes: bytes.byteLength,
    sha256,
  };
}
