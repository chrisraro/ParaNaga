import { describe, expect, it } from "vitest";
import { sniffMagicBytes } from "@/domain/media/sniff";
import {
  createMediaSlotPayloadSchema,
  confirmMediaPayloadSchema,
  MAX_PHOTO_BYTES,
  MAX_VIDEO_BYTES,
} from "@/domain/media/schemas";

describe("media magic bytes sniffer", () => {
  it("detects JPEG files", () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
    expect(sniffMagicBytes(bytes)).toEqual({ kind: "image", mime: "image/jpeg" });
  });

  it("detects PNG files", () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
    expect(sniffMagicBytes(bytes)).toEqual({ kind: "image", mime: "image/png" });
  });

  it("detects WebP files", () => {
    const bytes = new Uint8Array([
      0x52, 0x49, 0x46, 0x46, // RIFF
      0x24, 0x00, 0x00, 0x00,
      0x57, 0x45, 0x42, 0x50, // WEBP
    ]);
    expect(sniffMagicBytes(bytes)).toEqual({ kind: "image", mime: "image/webp" });
  });

  it("detects MP4 files", () => {
    const bytes = new Uint8Array([
      0x00, 0x00, 0x00, 0x18,
      0x66, 0x74, 0x79, 0x70, // ftyp
      0x69, 0x73, 0x6f, 0x6d,
    ]);
    expect(sniffMagicBytes(bytes)).toEqual({ kind: "video", mime: "video/mp4" });
  });

  it("detects WebM files", () => {
    const bytes = new Uint8Array([
      0x1a, 0x45, 0xdf, 0xa3, // EBML
      0x9f, 0x42, 0x86, 0x81,
      0x01, 0x42, 0xf7, 0x81,
    ]);
    expect(sniffMagicBytes(bytes)).toEqual({ kind: "video", mime: "video/webm" });
  });

  it("rejects unknown and executable formats", () => {
    const exe = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00, 0x04, 0x00, 0x00, 0x00]);
    expect(sniffMagicBytes(exe)).toEqual({ kind: "unknown" });

    const tooShort = new Uint8Array([0xff, 0xd8]);
    expect(sniffMagicBytes(tooShort)).toEqual({ kind: "unknown" });
  });
});

describe("media upload schemas", () => {
  it("validates slot creation payload within size constraints", () => {
    const valid = createMediaSlotPayloadSchema.parse({
      purpose: "community_photo",
      expectedBytes: 1024 * 500,
      mime: "image/jpeg",
    });
    expect(valid.purpose).toBe("community_photo");

    expect(() =>
      createMediaSlotPayloadSchema.parse({
        purpose: "community_photo",
        expectedBytes: MAX_VIDEO_BYTES + 1,
        mime: "image/jpeg",
      }),
    ).toThrow();
  });

  it("validates confirm media payload", () => {
    const slotId = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";
    const valid = confirmMediaPayloadSchema.parse({ slotId });
    expect(valid.slotId).toBe(slotId);

    expect(() => confirmMediaPayloadSchema.parse({ slotId: "invalid-uuid" })).toThrow();
  });
});
