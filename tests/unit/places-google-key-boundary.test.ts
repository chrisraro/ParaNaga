// The browser key (NEXT_PUBLIC_GOOGLE_MAPS_EMBED_API_KEY) ships in the JS bundle and, per the
// owner, has many APIs enabled. The Places proxy must never read it or fall back to it: only the
// server-only GOOGLE_PLACES_API_KEY. This scans the server side of the proxy for the name.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

async function files(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(entries.map((e) => (e.isDirectory() ? files(path.join(dir, e.name)) : [path.join(dir, e.name)])));
  return nested.flat().filter((f) => /\.(ts|tsx)$/.test(f));
}

describe("Google Places key boundary", () => {
  it("no server code and no Places route references the public embed key", async () => {
    const roots = ["src/server", "src/app/api", "src/domain/places", "src/client/places"].map((r) => path.resolve(r));
    const hits: string[] = [];
    for (const root of roots) {
      for (const file of await files(root)) {
        if ((await readFile(file, "utf8")).includes("NEXT_PUBLIC_GOOGLE_MAPS_EMBED_API_KEY")) hits.push(path.relative(process.cwd(), file));
      }
    }
    expect(hits).toEqual([]);
  });

  it("the proxy reads its key from GOOGLE_PLACES_API_KEY only", async () => {
    const source = await readFile(path.resolve("src/server/places/google-places.ts"), "utf8");
    expect(source).toContain("GOOGLE_PLACES_API_KEY");
    expect(source).not.toMatch(/process\.env/);
  });
});
