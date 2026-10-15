// Line-ending-proof migration checksums. A migration is hashed after normalizing CRLF to LF,
// so Windows (autocrlf) and Linux checkouts agree. Rows recorded before normalization hold
// the hash of the CRLF form (Neon main recorded 0000 that way); those are accepted as
// "legacy" and should be rewritten to the normalized hash.
import { createHash } from "node:crypto";

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

const normalize = (body: string) => body.replace(/\r\n/g, "\n");

export function migrationHash(body: string): string {
  return sha256(normalize(body));
}

export type HashCheck = "match" | "legacy" | "mismatch";

export function checkMigrationHash(body: string, stored: string): HashCheck {
  const normalized = normalize(body);
  if (sha256(normalized) === stored) return "match";
  if (sha256(normalized.replace(/\n/g, "\r\n")) === stored) return "legacy";
  return "mismatch";
}
