// Who may enter /admin (N5a): the pure rule, the nav (no dead links), the server guard behind the
// layout, the proxy's 404 for signed-out visitors, and the e2e-only shell switch (never on in a
// deployment, never from a cookie without the switch).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { adminNavFor, canEnterAdmin } from "@/domain/admin/access";
import { e2eAdminShellEnabled, testOnlyEnvProblem } from "@/domain/pwa/build-guard";
import { ROLES } from "@/domain/auth/permissions";

const state = vi.hoisted(() => ({
  user: null as { id: string; name: string; roles: string[] } | null,
  cookie: undefined as string | undefined,
}));

vi.mock("@/server/auth/session", () => ({ getCurrentUser: async () => state.user }));
vi.mock("@/server/auth/neon", () => ({ neonAuth: () => null }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (name === "pn-e2e-admin-roles" && state.cookie !== undefined ? { value: state.cookie } : undefined) }),
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw Object.assign(new Error("NEXT_HTTP_ERROR_FALLBACK;404"), { digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
  },
}));

const { getStaffUser, requireStaffPage } = await import("@/server/admin/access");
const { proxy } = await import("@/proxy");

beforeEach(() => {
  state.user = null;
  state.cookie = undefined;
});
afterEach(() => {
  vi.unstubAllEnvs();
});

const FULL_NAV = ["/admin", "/admin/imports", "/admin/candidates", "/admin/stops", "/admin/reconciliation", "/admin/revisions", "/admin/coverage"];

describe("canEnterAdmin / adminNavFor", () => {
  it("only admins and transport reviewers enter", () => {
    for (const role of ROLES) expect(canEnterAdmin([role]), role).toBe(role === "admin" || role === "transport_reviewer");
    expect(canEnterAdmin([])).toBe(false);
  });

  it("the nav lists only built screens the roles allow, and nothing for others", () => {
    expect(adminNavFor(["commuter", "admin"]).map((i) => i.href)).toEqual(FULL_NAV);
    expect(adminNavFor(["transport_reviewer"]).map((i) => i.href)).toEqual(FULL_NAV);
    expect(adminNavFor(["community_moderator", "complaint_reviewer"])).toEqual([]);
  });
});

describe("server guard", () => {
  it("returns staff and 404s everyone else", async () => {
    state.user = { id: "a", name: "A", roles: ["commuter", "admin"] };
    expect((await getStaffUser())?.id).toBe("a");
    for (const user of [null, { id: "c", name: "C", roles: ["commuter"] }, { id: "m", name: "M", roles: ["community_moderator"] }, { id: "s", name: "S", roles: [] }]) {
      state.user = user;
      expect(await getStaffUser()).toBeNull();
      await expect(requireStaffPage()).rejects.toThrow(/404/);
    }
  });

  it("ignores the e2e roles cookie unless the test-only switch is on", async () => {
    state.cookie = "admin";
    expect(await getStaffUser()).toBeNull();
  });

  it("with the switch on (e2e build only), takes the roles from the cookie; never in a deployment", async () => {
    vi.stubEnv("PARANAGA_E2E_ADMIN_SHELL", "1");
    state.cookie = "commuter,transport_reviewer,bogus";
    expect((await getStaffUser())?.roles).toEqual(["commuter", "transport_reviewer"]);
    state.cookie = "commuter";
    expect(await getStaffUser()).toBeNull();
    state.cookie = "admin";
    vi.stubEnv("VERCEL", "1");
    expect(await getStaffUser()).toBeNull();
  });
});

describe("build guard", () => {
  it("refuses the admin shell switch in a deployment build and at runtime there", () => {
    expect(testOnlyEnvProblem({ PARANAGA_E2E_ADMIN_SHELL: "1", VERCEL_ENV: "preview" })).toMatch(/PARANAGA_E2E_ADMIN_SHELL is test-only/);
    expect(testOnlyEnvProblem({ PARANAGA_E2E_ADMIN_SHELL: "1" })).toBeNull();
    expect(e2eAdminShellEnabled({ PARANAGA_E2E_ADMIN_SHELL: "1" })).toBe(true);
    expect(e2eAdminShellEnabled({ PARANAGA_E2E_ADMIN_SHELL: "true" })).toBe(false);
    expect(e2eAdminShellEnabled({ PARANAGA_E2E_ADMIN_SHELL: "1", VERCEL_URL: "x.vercel.app" })).toBe(false);
  });
});

describe("proxy", () => {
  it("answers a plain 404 on /admin when nobody can be signed in, and still redirects /account", async () => {
    for (const path of ["/admin", "/admin/revisions"]) {
      const res = await proxy(new NextRequest(`http://localhost${path}`));
      expect(res.status, path).toBe(404);
      expect(res.headers.get("cache-control")).toBe("private, no-store");
    }
    const account = await proxy(new NextRequest("http://localhost/account"));
    expect(account.status).toBe(307);
  });

  it("lets the e2e shell through only with the test-only switch and a roles cookie (none: the signed-out 404)", async () => {
    vi.stubEnv("PARANAGA_E2E_ADMIN_SHELL", "1");
    expect((await proxy(new NextRequest("http://localhost/admin"))).status).toBe(404);
    const res = await proxy(new NextRequest("http://localhost/admin", { headers: { cookie: "pn-e2e-admin-roles=commuter" } }));
    expect(res.status).toBe(200);
    expect(res.headers.get("x-middleware-next")).toBe("1");
    vi.stubEnv("VERCEL", "1");
    expect((await proxy(new NextRequest("http://localhost/admin", { headers: { cookie: "pn-e2e-admin-roles=admin" } }))).status).toBe(404);
  });
});
