import { createHash } from "node:crypto";

/** sha256 of a UTF-8 string as lower-case hex (used for source identities and content hashes). */
export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/** Plain code-unit ordering, which equals byte order for the ASCII hex identities we sort. */
export function compareCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
