import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { ACTIONS, ROLES, can, decide, type Role } from "@/domain/auth/permissions";

const user = (roles: Role[], id = "user-a") => ({ id, roles });

describe("permission matrix (spec §5.3)", () => {
  it("guests are never allowed anything", () => {
    for (const action of ACTIONS) {
      expect(decide(null, action)).toEqual({ allowed: false, reason: "unauthenticated" });
    }
  });

  it("a commuter is not an editor", () => {
    const commuter = user(["commuter"]);
    expect(decide(commuter, "transit.revision.edit").allowed).toBe(false);
    expect(decide(commuter, "correction.review").allowed).toBe(false);
    expect(decide(commuter, "correction.submit").allowed).toBe(true);
    expect(decide(commuter, "community.post").allowed).toBe(true);
  });

  it("community moderators get no access to private complaints", () => {
    const mod = user(["commuter", "community_moderator"]);
    expect(can(mod.roles, "complaint.review")).toBe(false);
    expect(can(mod.roles, "complaint.evidence.read")).toBe(false);
  });

  it("admins do not read complaint evidence through the normal path", () => {
    expect(can(["admin"], "complaint.evidence.read")).toBe(false);
    expect(can(["admin"], "complaint.review")).toBe(false);
  });

  it("only complaint reviewers read complaint evidence", () => {
    for (const role of ROLES) {
      expect(can([role], "complaint.evidence.read")).toBe(role === "complaint_reviewer");
    }
  });

  it("only admins grant roles", () => {
    for (const role of ROLES) expect(can([role], "roles.grant")).toBe(role === "admin");
  });

  it("N7: only admins see jobs and run the live Jev diagnostic; moderators and admins read provider status", () => {
    for (const role of ROLES) {
      expect(can([role], "ops.manage"), role).toBe(role === "admin");
      expect(can([role], "ops.jev.diagnose"), role).toBe(role === "admin" || role === "community_moderator");
      expect(can([role], "complaint.review"), role).toBe(role === "complaint_reviewer");
    }
  });

  it("nobody reviews their own submission", () => {
    const reviewer = user(["transport_reviewer"], "rev-1");
    expect(decide(reviewer, "correction.review", { ownerId: "rev-1" })).toEqual({
      allowed: false,
      reason: "self_review",
    });
    expect(decide(reviewer, "correction.review", { ownerId: "someone-else" }).allowed).toBe(true);
  });

  it("roles are additive: adding a role never removes a permission", () => {
    const roleArb = fc.constantFrom(...ROLES);
    const actionArb = fc.constantFrom(...ACTIONS);
    fc.assert(
      fc.property(fc.array(roleArb, { maxLength: 4 }), roleArb, actionArb, (roles, extra, action) => {
        if (can(roles, action)) expect(can([...roles, extra], action)).toBe(true);
      }),
    );
  });
});
