// AC-12 (docs/spec/07-delivery.md §7.4): "Criticism vs threats distinguished; appeals/overrides
// audited". The labelled-sample eval half: a human-labelled set of criticism and threats
// (tests/fixtures/jev/labelled-sample.json) with Jev's RECORDED answer for each, run through the
// real adapter and policy. What must hold whatever Jev answers:
//   - criticism of service or policy is never rejected by the policy (it can only be published
//     or wait for a person), so harsh criticism is never removed automatically;
//   - a threat is never published automatically;
//   - with these recorded answers, most threats are rejected automatically (recall reported).
// The audit half (overrides and appeals write audit rows) is in
// tests/integration/review-moderation-rls.test.ts.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { maskForAi } from "@/domain/moderation/mask";
import { DEFAULT_FLAGS, decideModeration, type ModerationFlags } from "@/domain/moderation/policy";
import { createInMemoryBudget, createJevClient } from "@/server/adapters/jev/client";

type Item = { id: string; label: "criticism" | "threat"; text: string; recorded: { recommendation: string; confidence: number } };
const SAMPLE = JSON.parse(readFileSync("tests/fixtures/jev/labelled-sample.json", "utf8")) as { model: string; items: Item[] };
const config = { url: "https://jev.test/decisions", apiKey: "test-key-not-real", modelId: SAMPLE.model, policyVersion: "paranaga-community-v1", timeoutMs: 1000, dailyBudget: 100 };

async function outcome(item: Item, flags: ModerationFlags) {
  const fetchStub = (async () =>
    new Response(JSON.stringify({ id: `rec-${item.id}`, model: SAMPLE.model, ...item.recorded }), { status: 200 })) as unknown as typeof fetch;
  const jev = await createJevClient({ config, fetch: fetchStub, budget: createInMemoryBudget() }).classify({ kind: "community", text: maskForAi(item.text), flags });
  return decideModeration({ kind: "community", jev, flags }).status;
}

describe("AC-12 labelled sample: criticism versus threats", () => {
  const criticism = SAMPLE.items.filter((i) => i.label === "criticism");
  const threats = SAMPLE.items.filter((i) => i.label === "threat");

  it("has both labels in useful numbers, including criticism Jev over-moderates", () => {
    expect(criticism.length).toBeGreaterThanOrEqual(6);
    expect(threats.length).toBeGreaterThanOrEqual(5);
    expect(criticism.some((c) => c.recorded.recommendation === "reject")).toBe(true);
  });

  for (const flags of [DEFAULT_FLAGS, { ...DEFAULT_FLAGS, autoPublishEnabled: true }]) {
    const mode = flags.autoPublishEnabled ? "auto-publish on" : "auto-publish off";

    it(`${mode}: no criticism is rejected automatically`, async () => {
      for (const c of criticism) expect(await outcome(c, flags), c.id).not.toBe("rejected");
    });

    it(`${mode}: no threat is published automatically`, async () => {
      for (const t of threats) expect(await outcome(t, flags), t.id).not.toBe("published");
    });

    it(`${mode}: most threats are rejected automatically; the rest wait for a person`, async () => {
      const results = await Promise.all(threats.map((t) => outcome(t, flags)));
      const recall = results.filter((r) => r === "rejected").length / threats.length;
      expect(recall).toBeGreaterThanOrEqual(0.8);
      expect(results.every((r) => r === "rejected" || r === "pending")).toBe(true);
    });
  }
});
