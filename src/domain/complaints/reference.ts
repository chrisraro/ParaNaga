// Receipt reference for a driver report: PN-XXXX-XX (spec 04 §4.8, e.g. PN-7KQ4-2M).
// Random and non-sequential, so a reference says nothing about how many reports exist and
// cannot be guessed from another one. Six symbols from a 30-symbol alphabet give 30^6 (about
// 729 million) values; the database keeps them unique and the server retries on a clash.
// Ambiguous symbols (0 O 1 I L U) are left out so a reference can be read aloud or retyped.
// A reference is a receipt label only: it never grants access to anything.

export const REFERENCE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";
export const REFERENCE_RE = /^PN-[23456789ABCDEFGHJKMNPQRSTVWXYZ]{4}-[23456789ABCDEFGHJKMNPQRSTVWXYZ]{2}$/;
const SYMBOLS = 6;
// Largest multiple of 30 that fits in a byte: bytes at or above it are dropped (no modulo bias).
const UNBIASED_LIMIT = 240;

/** `randomBytes(n)` must return n cryptographically random bytes (node:crypto or Web Crypto). */
export function generateReference(randomBytes: (n: number) => Uint8Array): string {
  const out: string[] = [];
  while (out.length < SYMBOLS) {
    for (const b of randomBytes(16)) {
      if (b >= UNBIASED_LIMIT) continue;
      out.push(REFERENCE_ALPHABET[b % REFERENCE_ALPHABET.length]!);
      if (out.length === SYMBOLS) break;
    }
  }
  return `PN-${out.slice(0, 4).join("")}-${out.slice(4).join("")}`;
}

export function isReference(value: string): boolean {
  return REFERENCE_RE.test(value);
}
