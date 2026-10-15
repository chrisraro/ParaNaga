import { createHash } from "node:crypto";

// Server-side only (node:crypto). compareCodeUnits lives in ../text/compare (crypto-free) and is
// re-exported here for the importer modules that already import it from this file.
export { compareCodeUnits } from "../text/compare";

/** sha256 of a UTF-8 string as lower-case hex (used for source identities and content hashes). */
export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}
