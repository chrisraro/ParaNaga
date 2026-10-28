"use client";

import { useCallback, useEffect, useState } from "react";
import { changeRole, fetchStaff, findUser, type AdminResult } from "@/client/admin/api";
import { GRANTABLE_ROLES, ROLE_LABELS, wouldRemoveLastAdmin, type FoundUser, type GrantableRole, type StaffList, type UserCard } from "@/domain/admin/system";
import type { Role } from "@/domain/auth/permissions";
import { btnDanger, btnPrimary, btnSecondary, Chip, ErrorNote, Field, inputCls, Muted, OkNote, PageTitle, Panel, when } from "./parts";
import { AdminStepUp } from "./step-up";

// A18 Users & roles (N7, C12), admins only. Find an account by its full email address (no list of
// all users, no partial search), then grant or revoke a role with a reason. Every change needs a
// fresh code, is audited with its reason, and the database refuses changes to your own roles and
// removing the last admin. Roles are read from the database on every request, so a revoked role
// stops working on the person's next request.

type Pending = { userId: string; name: string; role: Role; change: "grant" | "revoke"; reason: string };

export function UsersScreen() {
  const [staff, setStaff] = useState<AdminResult<StaffList> | null>(null);
  const [email, setEmail] = useState("");
  const [found, setFound] = useState<FoundUser | null | undefined>(undefined);
  const [lookupError, setLookupError] = useState("");
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [stepUp, setStepUp] = useState<Pending | null>(null);

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
    setFound(undefined);
    const r = await findUser(email.trim());
    if (!r.ok) return setLookupError(r.message);
    setFound(r.data.user);
  };

  const apply = async (p: Pending) => {
    setNotice(null);
    const r = await changeRole({ userId: p.userId, role: p.role as GrantableRole, change: p.change, reason: p.reason });
    if (!r.ok && r.code === "step_up_required") return setStepUp(p);
    setStepUp(null);
    if (!r.ok) return setNotice({ ok: false, text: r.message });
    setNotice({ ok: true, text: `${p.change === "grant" ? "Granted" : "Revoked"} ${ROLE_LABELS[p.role]} ${p.change === "grant" ? "to" : "from"} ${p.name}.` });
    await loadStaff();
    if (found && found.userId === p.userId) {
      const again = await findUser(email.trim());
      if (again.ok) setFound(again.data.user);
    }
  };

  const staffList = staff?.ok ? staff.data.staff : [];

  return (
    <div data-testid="admin-users">
      <PageTitle lead="Find a person by their full email address, then grant or revoke a role with a reason. Each change needs a fresh code and is recorded in the audit log. You cannot change your own roles, and the last admin cannot be removed.">
        Users and roles
      </PageTitle>
      {notice ? <div className="mb-4">{notice.ok ? <OkNote testId="users-notice">{notice.text}</OkNote> : <ErrorNote testId="users-notice">{notice.text}</ErrorNote>}</div> : null}
      {stepUp ? <AdminStepUp action={`${stepUp.change} a role`} onVerified={() => void apply(stepUp)} onCancel={() => setStepUp(null)} /> : null}

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
          {found === null ? <div className="mt-3"><Muted>No account uses that address. They need to sign in to ParaNaga once first.</Muted></div> : null}
          {found ? (
            <div className="mt-4">
              {!found.hasProfile ? (
                <Muted>This account has not opened ParaNaga yet; roles can be given after their first sign-in.</Muted>
              ) : (
                <UserRoles user={found} staff={staffList} onChange={(p) => void apply(p)} />
              )}
            </div>
          ) : null}
        </Panel>

        <Panel title={`Staff (${staffList.length})`} variant="bare" testId="users-staff">
          {staff === null ? (
            <Muted>Loading…</Muted>
          ) : !staff.ok ? (
            <ErrorNote>{staff.message}</ErrorNote>
          ) : staffList.length === 0 ? (
            <Muted>Nobody holds a staff role.</Muted>
          ) : (
            <ul className="grid gap-4">
              {staffList.map((u) => (
                <li key={u.userId} className="rounded-lg border border-ink-3/25 p-3 dark:border-navy-raised">
                  <UserRoles user={u} staff={staffList} onChange={(p) => void apply(p)} />
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}

function UserRoles({ user, staff, onChange }: { user: UserCard; staff: readonly UserCard[]; onChange: (p: Pending) => void }) {
  const [role, setRole] = useState<GrantableRole | "">("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const active = user.roles.filter((r) => r.active);
  const missing = GRANTABLE_ROLES.filter((r) => !active.some((a) => a.role === r));
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
        {user.email ? <span className="text-ink-2 dark:text-slate-300"> · {user.email}</span> : null}
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
            <span className="text-xs text-ink-2 dark:text-slate-300">
              since {when(r.grantedAt)}
              {r.grantedBy ? ` by ${r.grantedBy}` : ""} – {r.reason}
            </span>
            {!user.self && r.role !== "commuter" ? (
              <button type="button" className={btnDanger} onClick={() => go("revoke", r.role)} data-testid={`revoke-${tid}-${r.role}`}>
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
          <button type="button" className={btnSecondary} disabled={!role} onClick={() => role && go("grant", role)} data-testid={`grant-${tid}`}>
            Grant
          </button>
        </div>
      )}
      {error ? <ErrorNote testId={`user-error-${tid}`}>{error}</ErrorNote> : null}
    </div>
  );
}
