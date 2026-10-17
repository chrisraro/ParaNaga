export type SniffedMedia =
  | { kind: "image"; mime: "image/jpeg" | "image/png" | "image/webp" }
  | { kind: "video"; mime: "video/mp4" | "video/webm" }
  | { kind: "unknown" };

/**
 * Validates file magic bytes to prevent file extension spoofing attacks (spec §3.9).
 */
export function sniffMagicBytes(bytes: Uint8Array): SniffedMedia {
  if (bytes.length < 12) return { kind: "unknown" };

  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { kind: "image", mime: "image/jpeg" };
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return { kind: "image", mime: "image/png" };
  }

  // WebP: RIFF .... WEBP
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return { kind: "image", mime: "image/webp" };
  }

  // MP4: .... ftyp
  if (
    bytes[4] === 0x66 &&
    bytes[5] === 0x74 &&
    bytes[6] === 0x79 &&
    bytes[7] === 0x70
  ) {
    return { kind: "video", mime: "video/mp4" };
  }

  // WebM: 1A 45 DF A3 (EBML Header)
  if (
    bytes[0] === 0x1a &&
    bytes[1] === 0x45 &&
    bytes[2] === 0xdf &&
    bytes[3] === 0xa3
  ) {
    return { kind: "video", mime: "video/webm" };
  }

  return { kind: "unknown" };
}
