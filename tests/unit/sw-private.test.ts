// The service worker never caches private data (task B8, spec §5.8/§5.10): driver reports, the
// caller's own account data, media slots and anything in the evidence-private bucket. Checked
// before every other rule, for every method, mode and origin, and the page handoff refuses them.
import { describe, expect, it } from "vitest";
import { acceptHandoff, classifyRequest, isCacheableResponse, isPrivateRequest, type SwRequestInfo } from "@/domain/pwa/sw-routes";

const ORIGIN = "https://paranaga.example";
const ID = "6f1c1c7e-6f0a-4a39-9d62-0d0f5f2a8a99";

const req = (url: string, init: { method?: string; mode?: string } = {}): SwRequestInfo => ({
  method: init.method ?? "GET",
  url: new URL(url, ORIGIN),
  origin: ORIGIN,
  mode: init.mode ?? "cors",
  headers: new Headers(),
});

const PRIVATE_URLS = [
  "/api/v1/complaints",
  "/api/v1/complaints/",
  "/api/v1/me/complaints",
  `/api/v1/me/complaints/${ID}/evidence/${ID}`,
  "/api/v1/me",
  "/api/v1/me/corrections",
  `/api/v1/me/corrections/${ID}`,
  `/api/v1/me/complaints/${ID}`,
  `/api/v1/me/reports/complaint/${ID}/mynaga`,
  "/api/v1/me/reports",
  "/api/v1/me/saved-trips",
  "/api/v1/media/slots",
  "/api/v1/media/confirm",
  `https://storage.example.net/evidence-private/complaint_evidence/ab/${"a".repeat(64)}.jpg?X-Amz-Expires=60`,
  `https://evidence-private.storage.example.net/complaint_evidence/ab/${"a".repeat(64)}.jpg`,
];

describe("isPrivateRequest", () => {
  it("matches every private endpoint and the private bucket on any host", () => {
    for (const url of PRIVATE_URLS) expect(isPrivateRequest(new URL(url, ORIGIN)), url).toBe(true);
  });

  it("does not catch public data", () => {
    for (const url of ["/api/v1/routes", "/api/v1/network/head", "/api/v1/community", "/api/v1/mediator", "/app/report-driver"]) {
      expect(isPrivateRequest(new URL(url, ORIGIN)), url).toBe(false);
    }
  });
});

describe("classifyRequest never routes private data to a cache", () => {
  it("is network-only for every method and mode", () => {
    for (const url of PRIVATE_URLS) {
      for (const method of ["GET", "POST", "HEAD"]) {
        for (const mode of ["cors", "no-cors", "same-origin", "navigate"]) {
          expect(classifyRequest(req(url, { method, mode })), `${method} ${mode} ${url}`).toEqual({ kind: "network-only" });
        }
      }
    }
  });

  it("serves the report screen itself from the network (no runtime HTML cache)", () => {
    expect(classifyRequest(req("/app/report-driver", { mode: "navigate" }))).toEqual({ kind: "navigate" });
  });

  it("refuses private URLs handed over by a page", () => {
    for (const url of PRIVATE_URLS) {
      expect(acceptHandoff({ url, body: "{}", cacheControl: "public, max-age=60" }, ORIGIN), url).toBeNull();
    }
  });

  it("would not store a private, no-store response even if one reached a strategy", () => {
    const res = (cc: string) => ({ status: 200, headers: { get: (n: string) => (n.toLowerCase() === "cache-control" ? cc : null) } });
    expect(isCacheableResponse(res("private, no-store"))).toBe(false);
    expect(isCacheableResponse(res("no-store"))).toBe(false);
  });
});
