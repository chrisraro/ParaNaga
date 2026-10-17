import { z } from "zod";

export const MEDIA_PURPOSES = [
  "community_photo",
  "correction_evidence",
  "stop_photo",
  "complaint_evidence",
] as const;

export type MediaPurpose = (typeof MEDIA_PURPOSES)[number];

export const ALLOWED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "video/mp4",
  "video/webm",
] as const;

export type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number];

// Max file sizes: 10MB for photos, 25MB for complaint video (spec §3.9)
export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 25 * 1024 * 1024;

export const createMediaSlotPayloadSchema = z.object({
  purpose: z.enum(MEDIA_PURPOSES),
  expectedBytes: z.number().int().min(1).max(MAX_VIDEO_BYTES),
  mime: z.enum(ALLOWED_MIME_TYPES),
});

export type CreateMediaSlotPayload = z.infer<typeof createMediaSlotPayloadSchema>;

export const createMediaSlotResponseSchema = z.object({
  slot: z.object({
    id: z.string().uuid(),
    bucket: z.string(),
    objectKey: z.string(),
    uploadUrl: z.string().url(),
    maxBytes: z.number().int(),
  }),
});

export type CreateMediaSlotResponse = z.infer<typeof createMediaSlotResponseSchema>;

export const confirmMediaPayloadSchema = z.object({
  slotId: z.string().uuid(),
});

export type ConfirmMediaPayload = z.infer<typeof confirmMediaPayloadSchema>;

export const confirmMediaResponseSchema = z.object({
  media: z.object({
    id: z.string().uuid(),
    bucket: z.string(),
    objectKey: z.string(),
    status: z.enum(["verified", "rejected"]),
    bytes: z.number().int(),
    sha256: z.string(),
  }),
});

export type ConfirmMediaResponse = z.infer<typeof confirmMediaResponseSchema>;
