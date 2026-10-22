// AC-11 (docs/spec/07-delivery.md §7.4): "Approved publish; spam/threat rejected; unclear/failure
// pending; edits re-reviewed". The policy matrix over RECORDED Jev answers (tests/fixtures/jev,
// no live key): each answer goes through the real adapter (wire parsing, pinned build) and the
// real policy, with auto-publish off (the launch setting) and on. The database half (stored
// states, edits as new pending versions, a moderator's decision) is in
// tests/integration/review-moderation-rls.test.ts.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { maskForAi } from "@/domain/moderation/mask";
import { DEFAULT_FLAGS, decideModeration, type ModerationFlags } from "@/domain/moderation/policy";
import { createInMemoryBudget, createJevClient } from "@/server/adapters/jev/client";

type Case = { name: string; text: string; http: number; body: unknown };
const FIX = JSON.parse(readFileSync("tests/fixtures/jev/recorded-responses.json", "utf8")) as { model: string; cases: Case[] };
const config = { url: "https://jev.test/decisions", apiKey: "test-key-not-real", modelId: FIX.model, policyVersion: "paranaga-community-v1", timeoutMs: 1000, dailyBudget: 100 };
const OFF: ModerationFlags = DEFAULT_FLAGS;
const ON: ModerationFlags = { ...DEFAULT_FLAGS, autoPublishEnabled: true };

async function run(c: Case, flags: ModerationFlags) {
  const sent: string[] = [];
  const fetchStub = (async (_url: string, init: RequestInit) => {
    sent.push(String(init.body));
    return new Response(JSON.stringify(c.body), { status: c.http });
  }) as unknown as typeof fetch;
  const client = createJevClient({ config, fetch: fetchStub, budget: createInMemoryBudget() });
  const jev = await client.classify({ kind: "community", text: maskForAi(c.text), flags });
  return { jev, decision: decideModeration({ kind: "community", jev, flags }), sent };
}

/** [case, auto-publish off, auto-publish on] → stored status. */
const MATRIX: [string, string, string][] = [
  ["helpful_tip", "pending", "published"],
  ["spam", "rejected", "rejected"],
  ["threat", "rejected", "rejected"],
  ["unclear", "pending", "pending"],
  ["low_confidence_reject", "pending", "pending"],
  ["low_confidence_publish", "pending", "pending"],
  ["server_error", "pending", "pending"],
  ["rate_limited", "pending", "pending"],
  ["no_credits", "pending", "pending"],
  ["malformed_extra_field", "pending", "pending"],
  ["missing_answer", "pending", "pending"],
  ["out_of_range", "pending", "pending"],
  ["other_build", "pending", "pending"],
];

describe("AC-11 policy matrix on recorded Jev answers", () => {
  it("covers every recorded case", () => {
    expect(MATRIX.map((m) => m[0]).sort()).toEqual(FIX.cases.map((c) => c.name).sort());
  });

  for (const [name, off, on] of MATRIX) {
    it(`${name}: ${off} with auto-publish off, ${on} with it on`, async () => {
      const c = FIX.cases.find((x) => x.name === name)!;
      expect((await run(c, OFF)).decision.status).toBe(off);
      expect((await run(c, ON)).decision.status).toBe(on);
    });
  }

  it("every failure is recorded as Jev being unavailable (evidence the moderator sees), never as a verdict", async () => {
    for (const name of ["server_error", "rate_limited", "no_credits", "malformed_extra_field", "missing_answer", "out_of_range", "other_build"]) {
      const { jev, decision } = await run(FIX.cases.find((x) => x.name === name)!, ON);
      expect(jev?.status, name).toBe("unavailable");
      expect(decision.reason, name).toBe("jev_unavailable");
    }
  });

  it("a missing key or a timeout keeps it pending too", async () => {
    const noKey = createJevClient({ config: { ...config, apiKey: undefined }, budget: createInMemoryBudget() });
    expect(decideModeration({ kind: "community", jev: await noKey.classify({ kind: "community", text: "x", flags: ON }), flags: ON }).status).toBe("pending");
    const slow = createJevClient({
      config: { ...config, timeoutMs: 10 },
      budget: createInMemoryBudget(),
      fetch: ((_u: string, init: RequestInit) =>
        new Promise<Response>((_r, reject) => init.signal!.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))))) as unknown as typeof fetch,
    });
    expect(decideModeration({ kind: "community", jev: await slow.classify({ kind: "community", text: "x", flags: ON }), flags: ON }).status).toBe("pending");
  });

  it("only masked text leaves the server", async () => {
    const c = { ...FIX.cases[0]!, text: "Call me at 0917 123 4567 or fixture@example.com about the ABC 1234 jeepney." };
    const { sent } = await run(c, OFF);
    expect(sent[0]).not.toContain("0917 123 4567");
    expect(sent[0]).not.toContain("fixture@example.com");
  });
});

describe("AC-11 edits are re-reviewed (the SQL the handlers call)", () => {
  const SQL = readFileSync("db/migrations/0017_community_hub.sql", "utf8").replace(/\r\n/g, "\n");
  const edit = SQL.match(/create or replace function community\.edit_post\([\s\S]*?\$\$([\s\S]*?)\$\$;/)![1]!;

  it("an edit is a new version with the policy's status; the live version is superseded only if the edit itself is published", () => {
    expect(edit).toContain("insert into community.post_version (post_id, n, author_id, client_request_id, title, body, tags, moderation_status");
    expect(edit).toMatch(/if p_status = 'published' then\s+update community\.post_version pv set moderation_status = 'superseded'\s+where pv\.post_id = p_post_id and pv\.moderation_status = 'published';/);
    expect(edit).not.toMatch(/update community\.post_version pv set (title|body)/);
  });

  it("the edit handler moderates the new text like a new post (and records Jev's answer for the moderator)", () => {
    const handlers = readFileSync("src/server/community/handlers.ts", "utf8");
    const editFn = handlers.slice(handlers.indexOf("export function editPost"), handlers.indexOf("export function deletePost"));
    expect(editFn).toContain("moderateCommunityText(`${input.title}\\n${input.body}`)");
    expect(editFn).toContain('recordJevEvidence(db, "post_version", edited.version_id, decision.jev)');
  });
});
