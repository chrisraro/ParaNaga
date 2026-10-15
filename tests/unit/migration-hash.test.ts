import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { checkMigrationHash, migrationHash } from "../../scripts/lib/migration-hash";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const lf = "create table a (id int);\n-- note\nselect 1;\n";
const crlf = lf.replace(/\n/g, "\r\n");

describe("migrationHash", () => {
  it("hashes the LF-normalized body", () => {
    expect(migrationHash(lf)).toBe(sha(lf));
  });

  it("gives LF and CRLF checkouts the same hash", () => {
    expect(migrationHash(crlf)).toBe(migrationHash(lf));
  });
});

describe("checkMigrationHash", () => {
  it("matches a stored normalized hash from either checkout", () => {
    expect(checkMigrationHash(lf, sha(lf))).toBe("match");
    expect(checkMigrationHash(crlf, sha(lf))).toBe("match");
  });

  it("accepts the legacy hash of the CRLF form (Neon main recorded 0000 that way) and asks for an update", () => {
    expect(checkMigrationHash(lf, sha(crlf))).toBe("legacy");
    expect(checkMigrationHash(crlf, sha(crlf))).toBe("legacy");
  });

  it("rejects a changed body", () => {
    expect(checkMigrationHash(`${lf}select 2;\n`, sha(lf))).toBe("mismatch");
    expect(checkMigrationHash(`${lf}select 2;\n`, sha(crlf))).toBe("mismatch");
  });
});
