/**
 * Removes embedded metadata (EXIF incl. GPS, XMP, IPTC, comments, text chunks) from JPEG, PNG and
 * WebP bytes without decoding pixels (spec 05 §5.8: no EXIF GPS in public-media). Pure, no deps.
 * A JPEG keeps only its EXIF orientation, rewritten as a minimal EXIF block, so phone photos do not
 * turn sideways. Returns null when the container is malformed (the caller rejects the upload).
 */
export function stripImageMetadata(bytes: Uint8Array, mime: "image/jpeg" | "image/png" | "image/webp"): Uint8Array | null {
  try {
    if (mime === "image/jpeg") return stripJpeg(bytes);
    if (mime === "image/png") return stripPng(bytes);
    return stripWebp(bytes);
  } catch {
    return null;
  }
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.byteLength;
  }
  return out;
}

// ---------------------------------------------------------------- JPEG
const APP0 = 0xe0;
const APP1 = 0xe1;
const APP2 = 0xe2; // ICC colour profile: kept (no location data)
const APP14 = 0xee; // Adobe colour transform: kept (needed to decode some JPEGs)
const SOS = 0xda;
const COM = 0xfe;

/** EXIF orientation (1-8) from an APP1 payload, or null. */
function exifOrientation(payload: Uint8Array): number | null {
  // "Exif\0\0" then a TIFF header.
  if (payload.byteLength < 14 || String.fromCharCode(...payload.subarray(0, 4)) !== "Exif") return null;
  const tiff = payload.subarray(6);
  const view = new DataView(tiff.buffer, tiff.byteOffset, tiff.byteLength);
  const little = tiff[0] === 0x49 && tiff[1] === 0x49;
  if (!little && !(tiff[0] === 0x4d && tiff[1] === 0x4d)) return null;
  const ifd = view.getUint32(4, little);
  if (ifd + 2 > tiff.byteLength) return null;
  const count = view.getUint16(ifd, little);
  for (let i = 0; i < count; i++) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > tiff.byteLength) return null;
    if (view.getUint16(entry, little) === 0x0112) {
      const value = view.getUint16(entry + 8, little);
      return value >= 1 && value <= 8 ? value : null;
    }
  }
  return null;
}

/** A minimal APP1 segment: big-endian TIFF, IFD0 with the Orientation tag only. */
function orientationSegment(orientation: number): Uint8Array {
  const tiff = [
    0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08, // MM, 42, IFD0 at 8
    0x00, 0x01, // one entry
    0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, orientation, 0x00, 0x00, // Orientation SHORT 1
    0x00, 0x00, 0x00, 0x00, // no next IFD
  ];
  const payload = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, ...tiff];
  const length = payload.length + 2;
  return Uint8Array.from([0xff, APP1, length >> 8, length & 0xff, ...payload]);
}

function stripJpeg(bytes: Uint8Array): Uint8Array | null {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  const kept: Uint8Array[] = [bytes.subarray(0, 2)];
  let orientation: number | null = null;
  let at = 2;
  while (at < bytes.byteLength) {
    if (bytes[at] !== 0xff) return null;
    const marker = bytes[at + 1];
    if (marker === undefined) return null;
    if (marker === 0xff) {
      at += 1; // fill byte
      continue;
    }
    if (marker === SOS) {
      kept.push(bytes.subarray(at)); // entropy-coded data and EOI, verbatim
      break;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      kept.push(bytes.subarray(at, at + 2)); // standalone markers carry no length
      at += 2;
      continue;
    }
    if (at + 4 > bytes.byteLength) return null;
    const length = (bytes[at + 2]! << 8) | bytes[at + 3]!;
    if (length < 2 || at + 2 + length > bytes.byteLength) return null;
    const segment = bytes.subarray(at, at + 2 + length);
    const isApp = marker >= APP0 && marker <= 0xef;
    if (marker === APP1) {
      orientation ??= exifOrientation(segment.subarray(4));
    } else if (marker === COM || (isApp && marker !== APP0 && marker !== APP2 && marker !== APP14)) {
      // dropped: comments, IPTC (APP13) and any other application block
    } else {
      kept.push(segment);
    }
    at += 2 + length;
  }
  if (orientation !== null && orientation !== 1) {
    // After SOI and an optional JFIF APP0.
    const app0 = kept[1] && kept[1][1] === APP0 ? 2 : 1;
    kept.splice(app0, 0, orientationSegment(orientation));
  }
  return concat(kept);
}

// ---------------------------------------------------------------- PNG
const PNG_DROP = new Set(["eXIf", "tEXt", "zTXt", "iTXt", "tIME"]);

function stripPng(bytes: Uint8Array): Uint8Array | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const kept: Uint8Array[] = [bytes.subarray(0, 8)];
  let at = 8;
  while (at < bytes.byteLength) {
    if (at + 12 > bytes.byteLength) return null;
    const length = view.getUint32(at);
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    const end = at + 12 + length;
    if (end > bytes.byteLength) return null;
    if (!PNG_DROP.has(type)) kept.push(bytes.subarray(at, end));
    at = end;
    if (type === "IEND") break;
  }
  return concat(kept);
}

// ---------------------------------------------------------------- WebP
function stripWebp(bytes: Uint8Array): Uint8Array | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 12) return null;
  const kept: Uint8Array[] = [];
  let at = 12;
  while (at < bytes.byteLength) {
    if (at + 8 > bytes.byteLength) return null;
    const type = String.fromCharCode(...bytes.subarray(at, at + 4));
    const size = view.getUint32(at + 4, true);
    const end = at + 8 + size + (size % 2);
    if (at + 8 + size > bytes.byteLength) return null;
    const chunk = bytes.slice(at, Math.min(end, bytes.byteLength));
    if (type === "VP8X" && chunk.byteLength > 8) {
      chunk[8] = chunk[8]! & ~0x0c; // clear the EXIF (0x08) and XMP (0x04) flags
      kept.push(chunk);
    } else if (type !== "EXIF" && type !== "XMP ") {
      kept.push(chunk);
    }
    at = end;
  }
  const body = concat(kept);
  const header = new Uint8Array(12);
  header.set(bytes.subarray(0, 4), 0);
  new DataView(header.buffer).setUint32(4, body.byteLength + 4, true);
  header.set(bytes.subarray(8, 12), 8);
  return concat([header, body]);
}
