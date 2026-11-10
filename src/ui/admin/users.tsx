"use client";

import { useCallback, useEffect, useState } from "react";
import { changeRole, fetchStaff, findUser, type AdminResult } from "@/client/admin/api";
import { GRANTABLE_ROLES, ROLE_LABELS, wouldRemoveLastAdmin, type FoundUser, type GrantableRole, type StaffList, type UserCard } from "@/domain/admin/system";
import type { Role } from "@/domain/auth/permissions";
import { btnPrimary, btnRowDanger, btnSecondary, cardCls, Chip, ErrorNote, Field, inputCls, Muted, OkNote, PageTitle, Panel, when, Loading } from "./parts";
import { AdminStepUp } from "./step-up";

// A18 Users & roles (N7, C12), admins only. Find an account by its full email address (no list of
// all users, no partial search), then grant or revoke a role with a reason. Every change needs a
// fresh code, is audited with its reason, and the database refuses changes to your own roles and
// removing the last admin. Roles are read from the database on every request, so a revoked role
// stops working on the person's next request.

type Pending = { userId: string; name: string; role: Role; change: "grant" | "revoke"; reason: string };
/** One role change at a time: the request, then the step-up that request asked for (with its change). */
type Flow = { step: "idle" } | { step: "applying" | "stepUp"; change: Pending };
const IDLE: Flow = { step: "idle" };
/** The person on the card, with the address that found them (the input may have changed since). */
type Lookup = { email: string; user: FoundUser | null };

export function UsersScreen() {
  const [staff, setStaff] = useState<AdminResult<StaffList> | null>(null);
  const [email, setEmail] = useState("");
  const [lookedUp, setLookedUp] = useState<Lookup | null>(null);
  const [lookupError, setLookupError] = useState("");
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [flow, setFlow] = useState<Flow>(IDLE);
  const found = lookedUp?.user;

  const loadStaff = useCallback(async () => setStaff(await fetchStaff()), []);
  useEffect(() => {
    let live = true;
    void fetchStaff().then((r) => live && setStaff(r));
    return () => {
      live = false;
    };
  }, []);

  const lookup = async (e: React.FormEvent) => {
    e.preventDefault();
    setLookupError("");
    setLookedUp(null);
    const address = email.trim();
    const r = await findUser(address);
    if (!r.ok) return setLookupError(r.message);
    setLookedUp({ email: address, user: r.data.user });
  };

  const apply = async (p: Pending) => {
    setNotice(null);
    setFlow({ step: "applying", change: p });
    const r = await changeRole({ userId: p.userId, role: p.role as GrantableRole, change: p.change, reason: p.reason });
    if (!r.ok && r.code === "step_up_required") return setFlow({ step: "stepUp", change: p });
    if (!r.ok) {
      setFlow(IDLE);
      return setNotice({ ok: false, text: r.message });
    }
    setNotice({ ok: true, text: `${p.change === "grant" ? "Granted" : "Revoked"} ${ROLE_LABELS[p.role]} ${p.change === "grant" ? "to" : "from"} ${p.name}.` });
    // Still applying until both cards are fresh: a second click would act on roles that are gone.
    await loadStaff();
    if (lookedUp?.user?.userId === p.userId) {
      const again = await findUser(lookedUp.email);
      if (again.ok) setLookedUp((now) => (now?.email === lookedUp.email ? { email: lookedUp.email, user: again.data.user } : now));
    }
    setFlow(IDLE);
  };

  const staffList = staff?.ok ? staff.data.staff : [];

  return (
    <div data-testid="admin-users">
      <PageTitle lead="Find a person by their full email address, then grant or revoke a role with a reason. Each change needs a fresh code and is recorded in the audit log. You cannot change your own roles, and the last admin cannot be removed.">
        Users and roles
      </PageTitle>
      {notice ? <div className="mb-4">{notice.ok ? <OkNote testId="users-notice">{notice.text}</OkNote> : <ErrorNote testId="users-notice">{notice.text}</ErrorNote>}</div> : null}
      {flow.step === "stepUp" ? <AdminStepUp action={`${flow.change.change} a role`} onVerified={() => void apply(flow.change)} onCancel={() => setFlow(IDLE)} /> : null}

      <div className="mt-4 grid gap-6">
        <Panel title="Find a person" testId="users-lookup">
          <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => void lookup(e)}>
            <div className="w-80">
              <Field label="Full email address">
                <input className={inputCls} type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} data-testid="users-email" />
              </Field>
            </div>
            <button type="submit" className={btnPrimary} disabled={!email.includes("@")} data-testid="users-find">
              Find
            </button>
          </form>
          {lookupError ? <div className="mt-3"><ErrorNote testId="users-lookup-error">{lookupError}</ErrorNote></div> : null}
          {found === null ? <div className="mt-3"><Muted>No account uses that address. They need to sign in to Lunad once first.</Muted></div> : null}
          {found ? (
            <div className="mt-4">
              {!found.hasProfile ? (
                <Muted>This account has not opened Lunad yet; roles can be given after their first sign-in.</Muted>
              ) : (
                <UserRoles user={found} staff={staffList} busy={flow.step === "applying"} onChange={(p) => void apply(p)} />
              )}
            </div>
          ) : null}
        </Panel>

        <Panel title={`Staff (${staffList.length})`} variant="bare" testId="users-staff">
          {staff === null ? (
            <Loading />
          ) : !staff.ok ? (
            <ErrorNote>{staff.message}</ErrorNote>
          ) : staffList.length === 0 ? (
            <Muted>Nobody holds a staff role.</Muted>
          ) : (
            <ul className="grid gap-4">
              {staffList.map((u) => (
                <li key={u.userId} className={`p-4 ${cardCls}`}>
                  <UserRoles user={u} staff={staffList} busy={flow.step === "applying"} onChange={(p) => void apply(p)} />
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}

function UserRoles({ user, staff, busy, onChange }: { user: UserCard; staff: readonly UserCard[]; busy: boolean; onChange: (p: Pending) => void }) {
  const [picked, setRole] = useState<GrantableRole | "">("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const active = user.roles.filter((r) => r.active);
  const missing = GRANTABLE_ROLES.filter((r) => !active.some((a) => a.role === r));
  // A role just granted is no longer on offer, so the choice falls back to "Choose…".
  const role = picked && missing.includes(picked) ? picked : "";
  const tid = user.userId.replace(/[^\w-]/g, "");

  const go = (change: "grant" | "revoke", which: Role) => {
    setError("");
    if (reason.trim().length < 3) return setError("Give a reason (at least 3 characters).");
    if (wouldRemoveLastAdmin(staff, user.userId, which, change)) return setError("This is the last admin; grant admin to someone else first.");
    onChange({ userId: user.userId, name: user.name, role: which, change, reason: reason.trim() });
  };

  return (
    <div className="grid gap-2" data-testid={`user-${tid}`}>
      <p className="text-sm">
        <span className="font-semibold">{user.name}</span>
        {user.email ? <span className="text-ink-2 dark:text-night-ink-2"> · {user.email}</span> : null}
        {user.self ? (
          <span className="ml-2">
            <Chip>You</Chip>
          </span>
        ) : null}
        {user.suspended ? (
          <span className="ml-2">
            <Chip tone="error">Suspended</Chip>
          </span>
        ) : null}
      </p>
      <ul className="grid gap-1 text-sm">
        {active.map((r) => (
          <li key={r.role} className="flex flex-wrap items-center gap-2">
            <Chip tone="ok">{ROLE_LABELS[r.role]}</Chip>
            <span className="adm-meta text-ink-2 dark:text-night-ink-2">
              since {when(r.grantedAt)}
              {r.grantedBy ? ` by ${r.grantedBy}` : ""} – {r.reason}
            </span>
            {!user.self && r.role !== "commuter" ? (
              <button type="button" className={`${btnRowDanger} ml-auto`} disabled={busy} onClick={() => go("revoke", r.role)} data-testid={`revoke-${tid}-${r.role}`}>
                Revoke
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {user.self ? (
        <Muted>You cannot change your own roles. Ask another admin.</Muted>
      ) : (
        <div className="flex flex-wrap items-end gap-2">
          <div className="w-56">
            <Field label="Role to grant">
              <select className={inputCls} value={role} onChange={(e) => setRole(e.target.value as GrantableRole)} data-testid={`grant-role-${tid}`}>
                <option value="">Choose…</option>
                {missing.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="w-80">
            <Field label="Reason (recorded)">
              <input className={inputCls} value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} data-testid={`reason-${tid}`} />
            </Field>
          </div>
          <button type="button" className={btnSecondary} disabled={!role || busy} onClick={() => role && go("grant", role)} data-testid={`grant-${tid}`}>
            Grant
          </button>
        </div>
      )}
      {error ? <ErrorNote testId={`user-error-${tid}`}>{error}</ErrorNote> : null}
    </div>
  );
}
