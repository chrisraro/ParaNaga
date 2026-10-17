import { describe, expect, it } from "vitest";
import { stripImageMetadata } from "@/domain/media/strip-metadata";

const ascii = (s: string) => Array.from(s, (c) => c.charCodeAt(0));
const has = (bytes: Uint8Array, s: string) => Buffer.from(bytes).includes(Buffer.from(s, "latin1"));

/** APP1 EXIF (little-endian) with Orientation=6 and a GPS IFD pointer tag. */
function exifApp1(): number[] {
  const tiff = [
    0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00,
    0x02, 0x00,
    0x12, 0x01, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00, 0x06, 0x00, 0x00, 0x00, // Orientation = 6
    0x25, 0x88, 0x04, 0x00, 0x01, 0x00, 0x00, 0x00, 0x26, 0x00, 0x00, 0x00, // GPSInfo pointer
    0x00, 0x00, 0x00, 0x00,
    ...ascii("GPSLAT13.62N"),
  ];
  const payload = [...ascii("Exif"), 0, 0, ...tiff];
  const len = payload.length + 2;
  return [0xff, 0xe1, len >> 8, len & 0xff, ...payload];
}

function jpeg(): Uint8Array {
  const app0 = [0xff, 0xe0, 0x00, 0x10, ...ascii("JFIF"), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0];
  const xmp = [0xff, 0xe1, 0x00, 0x0f, ...ascii("http://ns.xmp")]; // 13-byte payload
  const com = [0xff, 0xfe, 0x00, 0x07, ...ascii("hello")];
  const iptc = [0xff, 0xed, 0x00, 0x06, ...ascii("IPTC")];
  const dqt = [0xff, 0xdb, 0x00, 0x04, 0x00, 0x01];
  const sos = [0xff, 0xda, 0x00, 0x04, 0x01, 0x02, 0x11, 0x22, 0xff, 0xd9];
  return Uint8Array.from([0xff, 0xd8, ...app0, ...exifApp1(), ...xmp, ...com, ...iptc, ...dqt, ...sos]);
}

function pngChunk(type: string, data: number[]): number[] {
  const len = data.length;
  return [len >>> 24, (len >>> 16) & 0xff, (len >>> 8) & 0xff, len & 0xff, ...ascii(type), ...data, 0, 0, 0, 0];
}

function webpChunk(type: string, data: number[]): number[] {
  const len = data.length;
  return [...ascii(type), len & 0xff, (len >> 8) & 0xff, 0, 0, ...data, ...(len % 2 ? [0] : [])];
}

describe("stripImageMetadata", () => {
  it("JPEG: drops EXIF GPS, XMP, IPTC and comments, keeps JFIF, tables, scan data and orientation", () => {
    const out = stripImageMetadata(jpeg(), "image/jpeg")!;
    expect(out).not.toBeNull();
    expect(has(out, "GPSLAT")).toBe(false);
    expect(has(out, "http://ns.xmp")).toBe(false);
    expect(has(out, "hello")).toBe(false);
    expect(has(out, "IPTC")).toBe(false);
    expect(has(out, "JFIF")).toBe(true);
    expect([...out.subarray(0, 2)]).toEqual([0xff, 0xd8]);
    expect([...out.subarray(-10)]).toEqual([0xff, 0xda, 0x00, 0x04, 0x01, 0x02, 0x11, 0x22, 0xff, 0xd9]);
    // Orientation 6 survives in a minimal EXIF block right after JFIF.
    const exifAt = Buffer.from(out).indexOf(Buffer.from("Exif", "latin1"));
    expect(exifAt).toBeGreaterThan(0);
    expect(out.length).toBeLessThan(jpeg().length);
    const orientationTag = Buffer.from(out).indexOf(Buffer.from([0x01, 0x12, 0x00, 0x03]));
    expect(out[orientationTag + 9]).toBe(6);
  });

  it("JPEG: refuses a truncated segment", () => {
    expect(stripImageMetadata(Uint8Array.from([0xff, 0xd8, 0xff, 0xe1, 0x40, 0x00, 1, 2]), "image/jpeg")).toBeNull();
  });

  it("PNG: drops eXIf and text chunks, keeps image chunks", () => {
    const png = Uint8Array.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      ...pngChunk("IHDR", Array(13).fill(1)),
      ...pngChunk("eXIf", ascii("GPSLAT")),
      ...pngChunk("tEXt", ascii("Comment\0secret")),
      ...pngChunk("IDAT", [1, 2, 3]),
      ...pngChunk("IEND", []),
    ]);
    const out = stripImageMetadata(png, "image/png")!;
    expect(has(out, "GPSLAT")).toBe(false);
    expect(has(out, "secret")).toBe(false);
    expect(has(out, "IHDR")).toBe(true);
    expect(has(out, "IDAT")).toBe(true);
    expect(has(out, "IEND")).toBe(true);
  });

  it("WebP: drops EXIF and XMP chunks, clears the VP8X flags and fixes the RIFF size", () => {
    const body = [
      ...ascii("WEBP"),
      ...webpChunk("VP8X", [0x0c, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
      ...webpChunk("VP8 ", [1, 2, 3, 4]),
      ...webpChunk("EXIF", ascii("GPSLAT")),
      ...webpChunk("XMP ", ascii("xmp!x")),
    ];
    const webp = Uint8Array.from([...ascii("RIFF"), body.length & 0xff, (body.length >> 8) & 0xff, 0, 0, ...body]);
    const out = stripImageMetadata(webp, "image/webp")!;
    expect(has(out, "GPSLAT")).toBe(false);
    expect(has(out, "xmp!x")).toBe(false);
    const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
    expect(view.getUint32(4, true)).toBe(out.byteLength - 8);
    expect(out[20]! & 0x0c).toBe(0);
    expect(has(out, "VP8 ")).toBe(true);
  });
});
